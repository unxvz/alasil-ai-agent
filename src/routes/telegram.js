import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { sendMessage, sendChatAction, getMe } from '../channels/telegram.js';
import { normalize } from '../modules/normalize.js';
import { detectIntent } from '../modules/intent.js';
import { extractEntities } from '../modules/entities.js';
import { getSession, saveSession, resetSession, mergeProfile, appendHistory, clearPendingAction } from '../modules/context.js';
import { buildResponse } from '../modules/response.js';
import { runAgent } from '../modules/agent.js';
import { resolveOptionPick, smartSpecFallback } from '../modules/option-match.js';
import { isAffirmative } from '../utils/affirmative.js';

// Issue #1: stale-pending-action TTL. Past this many ms since SET, the flag
// is considered stale (user moved on) and is cleared on the next turn before
// the SC fast-path runs.
const PENDING_ACTION_STALE_MS = 60_000;

export const telegramRouter = Router();

let botInfo = null;
async function ensureBotInfo() {
  if (botInfo) return botInfo;
  try { botInfo = await getMe(); } catch (err) { logger.error({ err }, 'getMe failed'); }
  return botInfo;
}

function sessionIdFor(chatId, threadId) {
  return `tg:${chatId}:${threadId ?? 'general'}`;
}

const _dedup = new Map();
const DEDUP_WINDOW_MS = 5_000;

function isDuplicate(sessionId, text) {
  const now = Date.now();
  for (const [k, v] of _dedup) {
    if (now - v.ts > DEDUP_WINDOW_MS) _dedup.delete(k);
  }
  const key = `${sessionId}::${String(text).trim().toLowerCase()}`;
  const prev = _dedup.get(key);
  if (prev && now - prev.ts < DEDUP_WINDOW_MS) {
    prev.ts = now;
    return true;
  }
  _dedup.set(key, { ts: now });
  return false;
}

// ─── Debouncer: merge rapid-fire messages into one turn ───
// Customers often type a thought in 2-3 separate Telegram messages
// ("hello" / "i need Apple Pencil Pro" / "do you have?"). Without debouncing,
// the bot replies to each fragment separately and the conversation becomes
// disjointed. This buffers messages per session and processes them as ONE
// turn after a quiet window, so the bot sees the full thought.
const DEBOUNCE_MS = Math.max(
  500,
  Math.min(10_000, parseInt(process.env.TELEGRAM_DEBOUNCE_MS || '2500', 10))
);
const _pending = new Map(); // sessionId -> { texts, lastMsg, timer }

function scheduleFlush(sessionId, onFlush) {
  const state = _pending.get(sessionId);
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    _pending.delete(sessionId);
    onFlush(state);
  }, DEBOUNCE_MS);
}

function bufferMessage(sessionId, msg, text, onFlush) {
  let state = _pending.get(sessionId);
  if (state) {
    state.texts.push(text);
    state.lastMsg = msg;
  } else {
    state = { texts: [text], lastMsg: msg, timer: null };
    _pending.set(sessionId, state);
  }
  scheduleFlush(sessionId, onFlush);
}

function shouldIgnoreMessage(msg, me) {
  if (!msg) return true;
  if (!msg.text || typeof msg.text !== 'string') return true;
  if (msg.from?.is_bot) return true;
  if (me && msg.from?.id === me.id) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Handler — legacy pipeline (regex + response.js)
// ────────────────────────────────────────────────────────────────────────────
async function handleLegacy(msg, session, sessionId, userText) {
  const chatId = msg.chat?.id;
  const threadId = msg.message_thread_id;

  let effectiveText = userText;
  if (Array.isArray(session.last_options) && session.last_options.length) {
    const picked = resolveOptionPick(userText, session.last_options);
    if (picked) effectiveText = picked;
    else {
      const fallback = smartSpecFallback(userText);
      if (fallback) effectiveText = fallback;
    }
  }

  const { normalized, language } = normalize(effectiveText);
  session.language = language === 'mixed' ? (session.language || 'en') : language;

  const { intent, confidence } = detectIntent(normalized);
  const entities = extractEntities(normalized);
  session.profile = mergeProfile(session.profile || {}, entities, normalized);
  if (!session.profile.category && entities.category) session.profile.category = entities.category;
  session.intent = intent;

  appendHistory(session, 'user', userText);

  await sendChatAction(chatId, 'typing', { threadId });

  const resp = await buildResponse({
    intent,
    profile: session.profile,
    language: session.language,
    userMessage: normalized,
    history: session.history || [],
    lastProducts: session.last_products || [],
  });

  if (resp.type === 'question') {
    session.last_question = resp.field;
    session.asked_fields = Array.from(new Set([...(session.asked_fields || []), resp.field]));
    session.last_options = (resp.options || []).map((o) => {
      if (typeof o === 'number') {
        if (resp.field === 'storage_gb') return o >= 1024 ? `${Math.round(o / 1024)}TB` : `${o}GB`;
        if (resp.field === 'ram_gb') return `${o}GB`;
        if (resp.field === 'screen_inch') return `${o} inch`;
      }
      return String(o);
    });
  } else {
    session.last_question = null;
    session.last_options = [];
  }
  if (Array.isArray(resp.products) && resp.products.length > 0) {
    session.last_products = resp.products.slice(0, 4);
  }
  appendHistory(session, 'assistant', resp.text);
  await saveSession(sessionId, session);

  const outText = (resp.text || '').trim();
  try {
    await sendMessage(chatId, outText, { threadId });
  } catch (err) {
    logger.error({ err, chatId, threadId }, 'sendMessage failed');
  }

  logger.info({ sessionId, chatId, threadId, intent, confidence, responseType: resp.type, path: 'legacy' }, 'telegram reply');
}

// Map normalize.js language labels → agent language labels.
// Agent speaks Arabic or English only; Persian/Finglish map to English.
function agentLanguage(raw, text) {
  // Arabic script in the message → reply Arabic
  if (/[\u0600-\u06FF]/.test(String(text || ''))) return 'ar';
  return 'en';
}

// Pull category / model_key / family / variant out of any tool call arguments
// the LLM made this turn. This is how we keep the faceted focus stable across
// turns even when the tool returned only options (browseMenu narrowing),
// not products.
function extractFocusFromToolCalls(toolCalls) {
  const focus = {};
  for (const tc of toolCalls || []) {
    const a = tc.args || {};
    if (a.category) focus.category = a.category;
    if (a.model_key) focus.model_key = a.model_key;
    if (a.family) focus.family = a.family;
    if (a.variant) focus.variant = a.variant;
    // Tools that take a `filters` object (getAvailableOptions)
    if (a.filters && typeof a.filters === 'object') {
      if (a.filters.category) focus.category = a.filters.category;
      if (a.filters.model_key) focus.model_key = a.filters.model_key;
      if (a.filters.family) focus.family = a.filters.family;
      if (a.filters.variant) focus.variant = a.filters.variant;
    }
  }
  return Object.keys(focus).length > 0 ? focus : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Handler — LLM tool-calling agent
// ────────────────────────────────────────────────────────────────────────────
// Exported for integration testing — see tests/integration/sc-confirmation-flow.test.js
export async function handleAgent(msg, session, sessionId, userText) {
  const chatId = msg.chat?.id;
  const threadId = msg.message_thread_id;

  const { normalized, language } = normalize(userText);
  session.language = agentLanguage(language, userText);

  appendHistory(session, 'user', userText);

  // ── Issue #1: SC#2 / SC#3 fast-path (state-flag-driven) ──
  // 1. Lazy staleness check: clear pending state if older than 60s.
  if (isPendingActionStale(session)) {
    clearPendingAction(session);
  }

  // 2. Fast-path: if a pending_action is set AND user said yes → consume,
  //    emit URL+closing, return WITHOUT invoking runAgent.
  if (session.pending_action && isAffirmative(userText)) {
    const fired = await fireShortCircuit({
      session,
      sessionId,
      chatId,
      threadId,
    });
    if (fired) return;
    // Fail-open: pending product not in last_products, fall through to runAgent.
  }

  await sendChatAction(chatId, 'typing', { threadId });

  const agentResult = await runAgent({
    userMessage: userText,
    language: session.language,
    history: session.history || [],
    lastProducts: session.last_products || [],
    sessionId,
  });

  if (Array.isArray(agentResult.products) && agentResult.products.length > 0) {
    session.last_products = agentResult.products.slice(0, 4);
  }

  // Track the "focus hint" — the category / model_key / family the LLM
  // narrowed to via browseMenu / filterCatalog / searchProducts. This keeps
  // the anchor stable across turns even when the tool returned only options
  // (not products), so short follow-ups ("which colors?", "256?") stay
  // locked on the same device the customer was narrowing.
  const focusFromTools = extractFocusFromToolCalls(agentResult.toolCalls || []);
  if (focusFromTools) {
    session.focus = { ...(session.focus || {}), ...focusFromTools, ts: Date.now() };
  }
  // If an explicit product list was returned, override focus from those too
  // (strongest signal).
  if (Array.isArray(agentResult.products) && agentResult.products.length > 0) {
    const p0 = agentResult.products[0];
    session.focus = {
      ...(session.focus || {}),
      category: p0.category || session.focus?.category,
      model_key: p0.model_key || session.focus?.model_key,
      family: p0.family || session.focus?.family,
      variant: p0.variant || session.focus?.variant,
      ts: Date.now(),
    };
  }

  // Agent path doesn't use structured options flow — clear stale state.
  session.last_question = null;
  session.last_options = [];
  session.turns = (session.turns || 0) + 1;

  // ── Issue #1: SET pending_action heuristically ──
  // If runAgent returned exactly 1 product AND the reply contains no URL,
  // the bot is asking the customer to confirm. SET awaiting_confirmation so
  // the next turn's "yes" fires SC#2 instead of paying full LLM cost.
  maybeSetPendingAction(session, agentResult);

  // ── Issue #1: category-change-clear (naive — Issue #3 will refine) ──
  // TODO: Issue #3 will refine this with explicit pivot detection.
  // For now: any category change clears pending state.
  if (shouldClearForCategoryChange(session)) {
    clearPendingAction(session);
  }

  appendHistory(session, 'assistant', agentResult.text);
  await saveSession(sessionId, session);

  const outText = (agentResult.text || '').trim();
  try {
    await sendMessage(chatId, outText, { threadId });
  } catch (err) {
    logger.error({ err, chatId, threadId }, 'sendMessage failed');
  }

  logger.info(
    {
      sessionId,
      chatId,
      threadId,
      path: 'agent',
      iterations: agentResult.iterations,
      tool_calls: (agentResult.toolCalls || []).map((t) => ({ name: t.name, count: t.count })),
      latency_ms: agentResult.latency_ms,
      maxed_out: Boolean(agentResult.maxed_out),
      error: agentResult.error || null,
    },
    'telegram reply'
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Issue #1 — agent-path short-circuit helpers
// ────────────────────────────────────────────────────────────────────────────

// fireShortCircuit handles SC#2 (post-confirmation) and SC#3 (link-permission,
// inert in Issue #1 — see "Discovered During Refactor" in REFACTOR_PLAN.md).
// On success: emits URL+closing line, saves session, sends Telegram message,
// returns true. The caller MUST NOT proceed to runAgent.
// On failure (pending_product_id not in last_products — e.g., session was
// reset between turns): clears the pending state, returns false. The caller
// then falls through to runAgent so the customer still gets a normal reply.
async function fireShortCircuit({ session, sessionId, chatId, threadId }) {
  const t0 = Date.now();
  const product = (session.last_products || []).find(
    (p) => p && p.id === session.pending_product_id
  );
  if (!product) {
    logger.warn(
      { sessionId, pending_product_id: session.pending_product_id },
      'SC fired but pending_product_id not found in last_products — falling through to runAgent'
    );
    clearPendingAction(session);
    return false;
  }

  const kind =
    session.pending_action === 'awaiting_confirmation'
      ? 'sc2_post_confirmation'
      : 'sc3_link_permission';
  const text = buildSCReply(product, session.language);

  // CONSUME-AND-CLEAR — atomic with the reply emission.
  clearPendingAction(session);
  appendHistory(session, 'assistant', text);
  session.turns = (session.turns || 0) + 1;
  await saveSession(sessionId, session);

  try {
    await sendMessage(chatId, text, { threadId });
  } catch (err) {
    logger.error({ err, chatId, threadId }, 'sendMessage failed (SC path)');
  }

  logger.info(
    { sessionId, kind, latency_ms: Date.now() - t0 },
    'agent short-circuited via state flag'
  );
  return true;
}

// True if pending_action is set AND older than PENDING_ACTION_STALE_MS.
// Pure predicate — exported for unit testing.
export function isPendingActionStale(session, now = Date.now()) {
  if (!session?.pending_action) return false;
  return now - (session.pending_action_ts ?? 0) > PENDING_ACTION_STALE_MS;
}

// True if pending_action_category is set AND session.focus.category exists
// AND they differ. Pure predicate — exported for unit testing.
// Issue #3 will refine this with explicit pivot detection.
export function shouldClearForCategoryChange(session) {
  return Boolean(
    session?.pending_action_category &&
      session?.focus?.category &&
      session.focus.category !== session.pending_action_category
  );
}

// SC reply: title + price on the first line, URL on its own line, closing
// question on its own line. Localized for Arabic if session.language === 'ar'.
// Exported for unit testing.
export function buildSCReply(product, language) {
  const priceStr = Number.isFinite(product.price_aed)
    ? `AED ${Number(product.price_aed).toLocaleString('en-US')}`
    : null;

  if (language === 'ar') {
    const head = priceStr
      ? `ممتاز — ${product.title} بسعر ${priceStr}.`
      : `ممتاز — ${product.title}.`;
    return [head, '', product.url || '', '', 'هل تحتاج شيئًا آخر؟']
      .filter((line) => line !== '' || product.url) // keep blank lines around URL only when URL exists
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const head = priceStr
    ? `Confirmed — ${product.title} for ${priceStr}.`
    : `Confirmed — ${product.title}.`;
  return [head, '', product.url || '', '', 'Anything else?']
    .filter((line) => line !== '' || product.url)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// SET pending_action heuristically AFTER runAgent returns:
// - exactly 1 product AND no URL in reply → bot is asking for confirmation
//   → SET awaiting_confirmation
// - any other shape → no SET
// The awaiting_link_permission flag is built but inert — see Issue #1
// "Discovered During Refactor" entry. Exported for unit testing.
export function maybeSetPendingAction(session, agentResult) {
  const products = agentResult?.products || [];
  if (products.length !== 1) return;
  const product = products[0];
  if (!product || !product.id) return;

  const text = String(agentResult?.text || '');
  if (/https?:\/\/\S+/.test(text)) {
    // URL already delivered — nothing pending.
    return;
  }

  session.pending_action = 'awaiting_confirmation';
  session.pending_product_id = product.id;
  session.pending_action_ts = Date.now();
  session.pending_action_category = product.category || null;
}

// ────────────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────────────
// Runs after the debounce window closes. Fetches the latest session state and
// routes through agent or legacy pipeline.
async function processBufferedTurn(sessionId, msg, combinedText) {
  const session = await getSession(sessionId);
  if (session.muted) return;

  if (config.USE_AGENT) {
    try {
      await handleAgent(msg, session, sessionId, combinedText);
      return;
    } catch (err) {
      logger.error({ err: String(err?.message || err), sessionId }, 'agent path threw — falling back to legacy');
      // Fall through to legacy pipeline for robustness.
    }
  }

  await handleLegacy(msg, session, sessionId, combinedText);
}

async function handleIncoming(msg) {
  const chatId = msg.chat?.id;
  const threadId = msg.message_thread_id;
  const userText = msg.text;
  if (!chatId || !userText) return;

  const sessionId = sessionIdFor(chatId, threadId);

  if (isDuplicate(sessionId, userText)) {
    logger.info({ sessionId, chatId, threadId }, 'telegram duplicate skipped');
    return;
  }

  // Commands are processed IMMEDIATELY and flush any pending buffer so we
  // don't end up replaying stale text right after a /reset.
  const isCommand = /^\/(start|reset|restart|pause|resume)\b/i.test(userText);
  if (isCommand) {
    const pending = _pending.get(sessionId);
    if (pending) { clearTimeout(pending.timer); _pending.delete(sessionId); }
  }

  if (/^\/(start|reset|restart)\b/i.test(userText)) {
    await resetSession(sessionId);
    const welcome =
      "Hey — I'm the alAsil AI assistant.\n" +
      "\n" +
      "I can help you with Apple products and accessories.\n" +
      "\n" +
      "What are you looking for?\n" +
      "\n" +
      "- iPhone\n" +
      "- iPad\n" +
      "- Mac\n" +
      "- AirPods\n" +
      "- Apple Watch";
    await sendMessage(chatId, welcome, { threadId });
    return;
  }
  if (/^\/pause\b/i.test(userText)) {
    const s = await getSession(sessionId); s.muted = true; await saveSession(sessionId, s);
    await sendMessage(chatId, 'Bot paused in this topic. Send /resume to re-enable.', { threadId });
    return;
  }
  if (/^\/resume\b/i.test(userText)) {
    const s = await getSession(sessionId); s.muted = false; await saveSession(sessionId, s);
    await sendMessage(chatId, 'Bot resumed.', { threadId });
    return;
  }

  // Buffer non-command messages. More messages within DEBOUNCE_MS get merged.
  bufferMessage(sessionId, msg, userText, async (state) => {
    const combined = state.texts.join('\n');
    if (state.texts.length > 1) {
      logger.info({ sessionId, fragments: state.texts.length }, 'merged debounced fragments');
    }
    try {
      await processBufferedTurn(sessionId, state.lastMsg, combined);
    } catch (err) {
      logger.error({ err: String(err?.message || err), sessionId, fragments: state.texts.length }, 'debounced flush failed');
    }
  });
}

telegramRouter.post('/:secret', async (req, res) => {
  const secret = req.params.secret;
  const expected = config.TELEGRAM_WEBHOOK_SECRET || 'default';
  if (secret !== expected) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid webhook secret' } });
  }

  res.json({ ok: true });

  try {
    const update = req.body || {};
    const me = await ensureBotInfo();
    const msg = update.message || update.edited_message || update.channel_post;
    if (shouldIgnoreMessage(msg, me)) return;
    await handleIncoming(msg);
  } catch (err) {
    logger.error({ err }, 'telegram update handler failed');
  }
});
