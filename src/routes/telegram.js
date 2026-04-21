import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { sendMessage, sendChatAction, getMe } from '../channels/telegram.js';
import { normalize } from '../modules/normalize.js';
import { detectIntent } from '../modules/intent.js';
import { extractEntities } from '../modules/entities.js';
import { getSession, saveSession, resetSession, mergeProfile, appendHistory } from '../modules/context.js';
import { buildResponse } from '../modules/response.js';
import { resolveOptionPick, smartSpecFallback } from '../modules/option-match.js';
import { reloadKnowledge } from '../modules/knowledge.js';
import { selfCorrectAnswer } from '../modules/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEEDBACK_LOG = path.resolve(__dirname, '..', '..', 'logs', 'feedback.jsonl');

function ensureFeedbackDir() {
  try { fs.mkdirSync(path.dirname(FEEDBACK_LOG), { recursive: true }); } catch {}
}

function recordFeedback(entry) {
  ensureFeedbackDir();
  try {
    fs.appendFileSync(FEEDBACK_LOG, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'feedback append failed');
  }
}

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

  // /check /c /t /wrong /no — re-analyze khod-kar + generate javab-e jadid
  // /no continues the correction loop: also marks the LAST attempt as wrong
  const isCheckCmd = /^\/check\b/i.test(userText) || /^\/c\b/i.test(userText) || /^\/t\b/i.test(userText) || /^\/repeat\b/i.test(userText) || /^\/wrong\b/i.test(userText) || /^\/ghalat\b/i.test(userText) || /^\/eshtebah\b/i.test(userText) || /^\/bug\b/i.test(userText) || /^\/error\b/i.test(userText);
  const isNoCmd = /^\/no?\b/i.test(userText) || /^\/nope\b/i.test(userText) || /^\/na\b/i.test(userText);
  if (isCheckCmd || isNoCmd) {
    const s = await getSession(sessionId);
    const lastAssistant = [...(s.history || [])].reverse().find((h) => h.role === 'assistant');
    const lastUser = [...(s.history || [])].reverse().filter((h) => h.role === 'user').slice(0, 2)[1];
    if (!lastUser?.text || !lastAssistant?.text) {
      await sendMessage(chatId, 'Hanuz hichi nis. Aval ye chizi beporsid.', { threadId });
      return;
    }

    // Build list of previously-wrong attempts:
    // - the original (wrong) bot reply
    // - plus any previous pending_teach answers that the user said /no to
    const pt = s.pending_teach;
    const previousAttempts = [];
    if (pt && pt.question === lastUser.text) {
      previousAttempts.push(...(pt.previous_attempts || []));
      if (pt.answer) previousAttempts.push(pt.answer);
    }

    const attemptNum = previousAttempts.length + 1;
    recordFeedback({
      ts: new Date().toISOString(), tag: isNoCmd ? 'still_wrong' : 'flagged_wrong',
      attempt: attemptNum,
      chatId, sessionId, from: msg.from?.username || msg.from?.first_name || msg.from?.id,
      user_query: lastUser.text, bot_reply: lastAssistant.text,
      previous_attempts: previousAttempts,
      profile: s.profile || {}, last_products: (s.last_products || []).map((p) => ({ title: p.title, sku: p.sku })),
    });

    if (attemptNum > 4) {
      await sendMessage(chatId, "⚠️ 4 bar emtehan kardam va natoonestam javab-e dorost bedam. Lotfan shoma ba /b <javab-e dorost> be man yad bedid. Ya man ba tim-e shoma (@alasilAi_support) tamas migiram.", { threadId });
      return;
    }

    await sendChatAction(chatId, 'typing', { threadId });
    try {
      const corrected = await selfCorrectAnswer({
        userMessage: lastUser.text,
        previousReply: lastAssistant.text,
        previousAttempts,
        profile: s.profile || {},
        products: s.last_products || [],
        language: s.language || 'en',
        history: s.history || [],
        lastProducts: s.last_products || [],
      });
      s.pending_teach = {
        question: lastUser.text,
        answer: corrected,
        previous_attempts: previousAttempts,
        ts: new Date().toISOString(),
        auto_generated: true,
        attempt: attemptNum,
      };
      await saveSession(sessionId, s);
      const hint = attemptNum === 1
        ? '\n\n— — —\nAge in javab dorost ast, /ok bezan ta hamishe save beshe. Age ghalat ast, /no bezan ta dobare emtehan konam.'
        : `\n\n— — —\nAttempt #${attemptNum} — age hanuz ghalat, /no bezan. Age dorost, /ok.`;
      await sendMessage(chatId, corrected + hint, { threadId });
    } catch (err) {
      logger.error({ err }, 'self-correct failed');
      await sendMessage(chatId, '📝 Flag gerefit vali nemitounam khodam correct-esh konam alan. Log save shod baraye barresi.', { threadId });
    }
    return;
  }

  // /b <correct answer> — teach (bot-e javab-e dorost-e tu ra az alan estefade mikoneh)
  const teachMatch = userText.match(/^\/b\b\s*(.*)$/i) || userText.match(/^\/teach\b\s*(.*)$/i);
  if (teachMatch) {
    const correct = (teachMatch[1] || '').trim();
    if (!correct) {
      await sendMessage(chatId, 'Chi javab dorost-e? Masalan: `/b iPhone Air has MagSafe 20W`', { threadId });
      return;
    }
    const s = await getSession(sessionId);
    const lastUser = [...(s.history || [])].reverse().filter((h) => h.role === 'user').slice(0, 2)[1];
    s.pending_teach = {
      question: lastUser?.text || '(no previous query)',
      answer: correct,
      ts: new Date().toISOString(),
    };
    await saveSession(sessionId, s);
    recordFeedback({
      ts: new Date().toISOString(), tag: 'teach_pending',
      chatId, sessionId, from: msg.from?.username || msg.from?.first_name || msg.from?.id,
      user_query: lastUser?.text || null, teach_answer: correct,
    });
    await sendMessage(chatId, `✏️ Teach pending:\n\nQ: ${s.pending_teach.question}\nA: ${correct}\n\nBa /ok tayid kon → knowledge base permanent save mishe.`, { threadId });
    return;
  }

  // /ok — confirm pending teach → permanent save
  if (/^\/ok\b/i.test(userText) || /^\/confirm\b/i.test(userText) || /^\/save\b/i.test(userText)) {
    const s = await getSession(sessionId);
    const pt = s.pending_teach;
    if (!pt) {
      await sendMessage(chatId, 'Hichi baraye save nist. Aval ba /b <javab-e dorost> teach kon.', { threadId });
      return;
    }
    try {
      const cfgPath = path.resolve(__dirname, '..', '..', 'config', 'custom_answers.md');
      const block = `\n\n### Q: ${pt.question}\n### A: ${pt.answer}\n<!-- taught ${pt.ts} via /b /ok -->\n`;
      fs.appendFileSync(cfgPath, block);
      reloadKnowledge();
      recordFeedback({
        ts: new Date().toISOString(), tag: 'teach_confirmed',
        chatId, sessionId, from: msg.from?.username || msg.from?.first_name || msg.from?.id,
        user_query: pt.question, teach_answer: pt.answer,
      });
      s.pending_teach = null;
      await saveSession(sessionId, s);
      await sendMessage(chatId, `✅ Saved permanently to knowledge base.\n\n"${pt.question}" → "${pt.answer.slice(0, 120)}${pt.answer.length > 120 ? '…' : ''}"\n\nHar moshtari dige hamin ra beporse, hamoon javab mide.`, { threadId });
    } catch (err) {
      logger.error({ err }, 'teach save failed');
      await sendMessage(chatId, '❌ Save failed — ' + String(err?.message || err).slice(0, 200), { threadId });
    }
    return;
  }

  // /s — re-run last query with fresh references (refresh catalog + knowledge)
  if (/^\/s\b/i.test(userText) || /^\/search\b/i.test(userText)) {
    const s = await getSession(sessionId);
    const lastUser = [...(s.history || [])].reverse().filter((h) => h.role === 'user').slice(0, 2)[1];
    if (!lastUser?.text) {
      await sendMessage(chatId, 'Hichi gabli nis — aval ye chizi beporsid, ba\'d /s bezanid.', { threadId });
      return;
    }
    try {
      const { refreshCatalog } = await import('../modules/catalog.js');
      reloadKnowledge();
      await refreshCatalog();
      await sendMessage(chatId, `🔄 Refreshed catalog + knowledge. Dobare check konam ba "${lastUser.text.slice(0, 80)}"...`, { threadId });
      // Re-run the last query as if user sent it fresh
      const fakeMsg = { ...msg, text: lastUser.text, message_id: msg.message_id + 1 };
      await handleIncoming(fakeMsg);
    } catch (err) {
      logger.error({ err }, 's command failed');
      await sendMessage(chatId, '❌ Refresh failed — ' + String(err?.message || err).slice(0, 200), { threadId });
    }
    return;
  }


  const session = await getSession(sessionId);
  if (session.muted) return;
  session.turns = (session.turns || 0) + 1;

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

  const outText = formatReplyForTelegram(resp);

  try {
    await sendMessage(chatId, outText, { threadId });
  } catch (err) {
    logger.error({ err, chatId, threadId }, 'sendMessage failed');
  }

  logger.info({ sessionId, chatId, threadId, intent, confidence, responseType: resp.type }, 'telegram reply');
}

function formatReplyForTelegram(resp) {
  return (resp.text || '').trim();
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
