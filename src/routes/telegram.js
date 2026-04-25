import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { sendMessage, sendChatAction, getMe, deleteMessages } from '../channels/telegram.js';
import { normalize } from '../modules/normalize.js';
import { detectIntent } from '../modules/intent.js';
import { extractEntities } from '../modules/entities.js';
import { getSession, saveSession, resetSession, mergeProfile, appendHistory } from '../modules/context.js';
import { buildResponse } from '../modules/response.js';
import { runAgent } from '../modules/agent.js';
import { resolveOptionPick, smartSpecFallback } from '../modules/option-match.js';
import { recordMessage as rateLimitRecord } from '../modules/rate-limit.js';

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
async function handleAgent(msg, session, sessionId, userText) {
  const chatId = msg.chat?.id;
  const threadId = msg.message_thread_id;

  const { normalized, language } = normalize(userText);
  session.language = agentLanguage(language, userText);

  appendHistory(session, 'user', userText);
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

  const outText = (agentResult.text || '').trim();

  // FIX #1 — race condition. Previous order was:
  //   appendHistory(assistant) → saveSession → sendMessage
  // If sendMessage threw (rate limit, network), the session recorded a reply
  // the customer never saw. Next turn, the bot referenced that ghost reply.
  // New order: sendMessage FIRST; only on success do we persist the turn.
  // On failure we DO persist the user message (they did send it) but mark
  // the bot reply as UN-SENT so the next turn can retry or surface the error.
  try {
    const sent = await sendMessage(chatId, outText, { threadId });
    appendHistory(session, 'assistant', agentResult.text);
    // Track IDs so a later `reset` can clean up the chat.
    if (!Array.isArray(session.message_ids)) session.message_ids = [];
    if (sent?.message_id) session.message_ids.push(sent.message_id);
    if (msg?.message_id) session.message_ids.push(msg.message_id);
    // Keep the tracked list bounded (Telegram allows batch delete up to 100).
    if (session.message_ids.length > 200) {
      session.message_ids = session.message_ids.slice(-200);
    }
    await saveSession(sessionId, session);
  } catch (err) {
    // Send failed. Do NOT append the assistant reply to history — the
    // customer didn't get it. Persist only the user turn so we don't lose
    // it, and log loud so the operator sees the failure.
    logger.error(
      { err: String(err?.message || err), chatId, threadId, sessionId, reply_preview: outText.slice(0, 200) },
      'sendMessage failed — bot reply not delivered, NOT persisted to history'
    );
    try {
      await saveSession(sessionId, session);
    } catch (saveErr) {
      logger.error({ saveErr, sessionId }, 'saveSession also failed after send failure');
    }
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

  // FIX #10 — per-session sliding-window rate limit. Stops a single abusive
  // user / runaway loop from hitting OpenAI dozens of times per minute with
  // different messages (the duplicate-check alone only blocks identical
  // retries). On overflow we reply once with a polite wait message and skip
  // the LLM call for this turn.
  const rl = rateLimitRecord(sessionId);
  if (!rl.allowed) {
    const waitSec = Math.ceil((rl.retry_after_ms || 30_000) / 1000);
    try {
      await sendMessage(
        chatId,
        `You're sending messages a bit too fast. Please wait ${waitSec}s and try again.`,
        { threadId }
      );
    } catch (err) {
      logger.error({ err, sessionId }, 'rate-limit notice send failed');
    }
    return;
  }

  // Commands are processed IMMEDIATELY and flush any pending buffer so we
  // don't end up replaying stale text right after a /reset. Accept both
  // slash-prefixed forms (/reset, /start, /restart) and bare words
  // ("reset", "Reset", "RESET", "restart") — Mohammad types "reset"
  // directly during testing.
  const isResetCmd =
    /^\/(start|reset|restart)\b/i.test(userText) ||
    /^\s*(reset|restart)\s*$/i.test(userText);
  const isPauseCmd = /^\/pause\b/i.test(userText);
  const isResumeCmd = /^\/resume\b/i.test(userText);
  const isCommand = isResetCmd || isPauseCmd || isResumeCmd;
  if (isCommand) {
    const pending = _pending.get(sessionId);
    if (pending) { clearTimeout(pending.timer); _pending.delete(sessionId); }
  }

  if (isResetCmd) {
    // Silent reset: wipe session history + memory, send NO welcome text.
    // The bot's first reply in the chat should be its response to the
    // customer's first REAL message AFTER the reset.
    //
    // Also clear the Telegram chat by deleting every message we (the bot)
    // sent, plus any user-message IDs we tracked. Telegram only allows
    // deletion of messages <48h old and forbids bots from deleting user
    // messages outside of groups where they're admin — so this is
    // best-effort. Anything older than 48h stays visible.
    try {
      const s = await getSession(sessionId);
      const ids = Array.isArray(s.message_ids) ? s.message_ids.slice() : [];
      // Also include the reset-command message itself so the chat truly
      // looks empty after.
      if (msg?.message_id) ids.push(msg.message_id);
      if (ids.length > 0) {
        await deleteMessages(chatId, ids);
      }
    } catch (err) {
      logger.warn({ err: String(err?.message || err), sessionId }, 'reset chat-cleanup failed (continuing)');
    }
    await resetSession(sessionId);
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
