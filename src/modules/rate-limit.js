// Per-session rate limiting.
//
// The duplicate-message check in telegram.js catches identical retries but
// lets an attacker / runaway loop flood OpenAI with many DIFFERENT messages.
// A single abusive user could spike our bill significantly before anyone
// noticed. This module applies a sliding-window cap per session.
//
// Default: 20 messages / 60 seconds. Configurable via env.

import { config } from '../config.js';
import { logger } from '../logger.js';

const WINDOW_MS = Math.max(5_000, Number(config.RATE_LIMIT_WINDOW_MS) || 60_000);
const MAX_MSGS = Math.max(3, Number(config.RATE_LIMIT_MAX_MSGS) || 20);

// sessionId → array of message timestamps within the window.
const _history = new Map();

function prune(timestamps, now) {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < timestamps.length && timestamps[i] < cutoff) i++;
  return i === 0 ? timestamps : timestamps.slice(i);
}

// Record a message and return whether it exceeds the cap. When exceeded,
// returns {allowed: false, retry_after_ms, current, limit}.
export function recordMessage(sessionId) {
  const now = Date.now();
  const prior = _history.get(sessionId) || [];
  const kept = prune(prior, now);
  kept.push(now);
  _history.set(sessionId, kept);
  const count = kept.length;
  if (count > MAX_MSGS) {
    const oldest = kept[0];
    const retry_after_ms = Math.max(0, WINDOW_MS - (now - oldest));
    logger.warn(
      { sessionId, count, limit: MAX_MSGS, window_ms: WINDOW_MS, retry_after_ms },
      'rate limit exceeded'
    );
    return { allowed: false, current: count, limit: MAX_MSGS, retry_after_ms };
  }
  return { allowed: true, current: count, limit: MAX_MSGS };
}

// Soft peek — check without recording.
export function peek(sessionId) {
  const now = Date.now();
  const kept = prune(_history.get(sessionId) || [], now);
  return { current: kept.length, limit: MAX_MSGS, window_ms: WINDOW_MS };
}

// Periodically clean up stale entries so the Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [sid, ts] of _history.entries()) {
    const kept = prune(ts, now);
    if (kept.length === 0) _history.delete(sid);
    else _history.set(sid, kept);
  }
}, WINDOW_MS).unref?.();
