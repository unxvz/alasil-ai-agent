import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { sendMessage, sendChatAction, getMe } from '../channels/telegram.js';
import { normalize } from '../modules/normalize.js';
import { detectIntent } from '../modules/intent.js';
import { extractEntities } from '../modules/entities.js';
import { getSession, saveSession, resetSession, mergeProfile, appendHistory } from '../modules/context.js';
import { buildResponse } from '../modules/response.js';
import { runAgent } from '../modules/agent.js';
import { resolveOptionPick, smartSpecFallback } from '../modules/option-match.js';

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

// ────────────────────────────────────────────────────────────────────────────
// Handler — LLM tool-calling agent
// ────────────────────────────────────────────────────────────────────────────
async function handleAgent(msg, session, sessionId, userText) {
  const chatId = msg.chat?.id;
  const threadId = msg.message_thread_id;

  const { normalized, language } = normalize(userText);
  session.language = language === 'mixed' ? (session.language || 'en') : language;

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
  // Agent path doesn't use structured options flow — clear stale state.
  session.last_question = null;
  session.last_options = [];
  session.turns = (session.turns || 0) + 1;

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
// Router
// ────────────────────────────────────────────────────────────────────────────
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

  if (/^\/(start|reset|restart)\b/i.test(userText)) {
    await resetSession(sessionId);
    const welcome = "Hey! 👋 Great to hear from you — I'm the alAsil AI agent, here to help you find the perfect Apple product. What are you looking for today? (iPhone / iPad / Mac / AirPods / Apple Watch)";
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

  const session = await getSession(sessionId);
  if (session.muted) return;
  session.turns = (session.turns || 0) + 1;

  if (config.USE_AGENT) {
    try {
      await handleAgent(msg, session, sessionId, userText);
      return;
    } catch (err) {
      logger.error({ err: String(err?.message || err), sessionId }, 'agent path threw — falling back to legacy');
      // Fall through to legacy pipeline for robustness.
    }
  }

  await handleLegacy(msg, session, sessionId, userText);
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
