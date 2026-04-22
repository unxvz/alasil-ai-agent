// Concurrency limiter + retry-with-backoff for OpenAI calls.
//
// Problem: under load (20+ concurrent Telegram users), the app was firing
// OpenAI requests in parallel with no throttling. OpenAI's gpt-4o-mini has
// a ~500 RPM / 200k TPM limit per key; busy minutes hit 429 and the agent
// fell back to the escalation reply, giving customers a "check with our team"
// message instead of an actual answer.
//
// Fix: queue requests through a concurrency gate (default max 10 in flight),
// and on 429 or 5xx, retry 3 times with exponential backoff. The retry-after
// header is honored when present.

import { logger } from '../logger.js';

// ─── Concurrency limiter ───
// Simple in-memory gate. Callers wait their turn before their fn() runs.
// When `max` simultaneous calls are already active, new callers are queued.
export function createLimiter(max) {
  let active = 0;
  const queue = [];

  const acquire = () =>
    new Promise((resolve) => {
      if (active < max) {
        active++;
        resolve();
      } else {
        queue.push(resolve);
      }
    });

  const release = () => {
    active--;
    const next = queue.shift();
    if (next) {
      active++;
      next();
    }
  };

  const run = async (fn) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };

  run.stats = () => ({ active, queued: queue.length, max });
  return run;
}

// ─── Retry wrapper ───
// Retries the fn up to `retries` times on retryable errors (429, 5xx, network).
// Uses Retry-After header when present, otherwise exponential backoff.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_WAIT_MS = 45_000; // cap any single retry wait at 45s

// Try several places where OpenAI / providers stash the "wait this long" hint.
function extractRetryAfterMs(err) {
  const headers = err?.headers || err?.response?.headers || {};
  const get = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k]);
  const hdrSec = Number(get('retry-after'));
  if (Number.isFinite(hdrSec) && hdrSec > 0) return hdrSec * 1000;
  const hdrResetTpm = Number(get('x-ratelimit-reset-tokens'));
  if (Number.isFinite(hdrResetTpm) && hdrResetTpm > 0) return hdrResetTpm * 1000;
  const hdrResetRpm = Number(get('x-ratelimit-reset-requests'));
  if (Number.isFinite(hdrResetRpm) && hdrResetRpm > 0) return hdrResetRpm * 1000;
  // Parse "Please try again in 1.831s" or "try again in 500ms" from the message.
  const msg = String(err?.message || '');
  const secMatch = msg.match(/try again in\s+([\d.]+)\s*s/i);
  if (secMatch) return Math.round(parseFloat(secMatch[1]) * 1000);
  const msMatch = msg.match(/try again in\s+(\d+)\s*ms/i);
  if (msMatch) return parseInt(msMatch[1], 10);
  return null;
}

export async function withRetry(fn, { retries = 5, baseDelayMs = 1000, label = 'openai' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      const isRetryable =
        RETRYABLE_STATUS.has(status) ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'EAI_AGAIN' ||
        /network|timeout|fetch failed/i.test(String(err?.message || ''));
      if (!isRetryable || attempt === retries) {
        break;
      }
      // Delay: honor Retry-After / provider hint if present; else exponential
      // backoff with jitter. TPM limit resets every 60s — we add padding so we
      // arrive AFTER the window slides, not right at the boundary.
      const hintMs = extractRetryAfterMs(err);
      const backoff = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
      const waitMs = hintMs != null
        ? Math.min(hintMs + 500, MAX_WAIT_MS) // +500ms safety padding on provider hints
        : Math.min(backoff, MAX_WAIT_MS);
      logger.warn(
        { label, attempt: attempt + 1, of: retries + 1, status, hintMs, waitMs, err: String(err?.message || err).slice(0, 140) },
        'retryable error, backing off'
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ─── Combined: gate + retry ───
// Single helper the callers use. Keeps us from forgetting either piece.
export function limitedRetry(limiter, fn, retryOpts) {
  return limiter(() => withRetry(fn, retryOpts));
}
