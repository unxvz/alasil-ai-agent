import { config } from '../config.js';
import { logger } from '../logger.js';

const API_BASE = (token) => `https://api.telegram.org/bot${token}`;

async function tg(method, token, params) {
  const url = `${API_BASE(token)}/${method}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    const msg = data.description || `HTTP ${resp.status}`;
    throw new Error(`Telegram ${method} failed: ${msg}`);
  }
  return data.result;
}

export function hasTelegram() {
  return Boolean(config.TELEGRAM_BOT_TOKEN);
}

export async function sendMessage(chatId, text, { threadId, replyToMessageId, parseMode } = {}) {
  if (!hasTelegram()) throw new Error('Telegram not configured');
  const params = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (threadId !== undefined && threadId !== null) params.message_thread_id = threadId;
  if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
  if (parseMode) params.parse_mode = parseMode;
  return tg('sendMessage', config.TELEGRAM_BOT_TOKEN, params);
}

// Delete a single message the bot previously sent. Only works within 48h
// in private chats (Telegram limitation). Returns true on success, false
// on any failure — never throws.
export async function deleteMessage(chatId, messageId) {
  if (!hasTelegram()) return false;
  try {
    await tg('deleteMessage', config.TELEGRAM_BOT_TOKEN, { chat_id: chatId, message_id: messageId });
    return true;
  } catch (err) {
    logger.debug({ err: String(err?.message || err), chatId, messageId }, 'deleteMessage failed');
    return false;
  }
}

// Bulk delete. Telegram's deleteMessages method accepts up to 100 ids.
// Silently ignores failures (messages older than 48h, already deleted, etc.)
export async function deleteMessages(chatId, messageIds) {
  if (!hasTelegram() || !messageIds?.length) return { deleted: 0, failed: 0 };
  const ids = messageIds.filter((id) => Number.isFinite(id));
  let deleted = 0;
  let failed = 0;
  // Telegram's batched method:
  try {
    await tg('deleteMessages', config.TELEGRAM_BOT_TOKEN, {
      chat_id: chatId,
      message_ids: ids.slice(0, 100),
    });
    deleted = Math.min(ids.length, 100);
  } catch (err) {
    // Fallback — individual deletes.
    logger.debug({ err: String(err?.message || err) }, 'deleteMessages batch failed, trying per-message');
    for (const id of ids) {
      const ok = await deleteMessage(chatId, id);
      if (ok) deleted++;
      else failed++;
    }
  }
  return { deleted, failed };
}

export async function sendChatAction(chatId, action = 'typing', { threadId } = {}) {
  if (!hasTelegram()) return;
  try {
    const params = { chat_id: chatId, action };
    if (threadId !== undefined && threadId !== null) params.message_thread_id = threadId;
    await tg('sendChatAction', config.TELEGRAM_BOT_TOKEN, params);
  } catch (err) {
    logger.debug({ err }, 'sendChatAction failed (non-fatal)');
  }
}

export async function setWebhook(publicUrl, { secret } = {}) {
  if (!hasTelegram()) throw new Error('Telegram not configured');
  const webhookUrl = buildWebhookUrl(publicUrl, secret);
  return tg('setWebhook', config.TELEGRAM_BOT_TOKEN, {
    url: webhookUrl,
    drop_pending_updates: true,
    allowed_updates: [
      'message', 'edited_message', 'channel_post',
      'callback_query',
    ],
  });
}

export async function deleteWebhook() {
  if (!hasTelegram()) return;
  await tg('deleteWebhook', config.TELEGRAM_BOT_TOKEN, { drop_pending_updates: true });
}

export async function getMe() {
  if (!hasTelegram()) return null;
  return tg('getMe', config.TELEGRAM_BOT_TOKEN, {});
}

export function buildWebhookUrl(publicUrl, secret) {
  if (!publicUrl) throw new Error('publicUrl required');
  const trimmed = String(publicUrl).replace(/\/+$/, '');
  const s = secret || config.TELEGRAM_WEBHOOK_SECRET || 'default';
  return `${trimmed}/webhook/telegram/${encodeURIComponent(s)}`;
}
