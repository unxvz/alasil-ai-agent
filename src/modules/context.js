import { createClient } from 'redis';
import { config } from '../config.js';
import { logger } from '../logger.js';

const KEY_PREFIX = 'ai-support:session:';

// In-memory fallback when Redis is unavailable (single-process, small-scale OK)
const _memStore = new Map();
const memGet = (k) => {
  const entry = _memStore.get(k);
  if (!entry) return null;
  if (entry.expireAt && Date.now() > entry.expireAt) { _memStore.delete(k); return null; }
  return entry.value;
};
const memSet = (k, v, ttlSec) => {
  _memStore.set(k, { value: v, expireAt: ttlSec ? Date.now() + ttlSec * 1000 : null });
};
const memDel = (k) => _memStore.delete(k);

let client = null;
let redisDisabled = false;

function shouldUseRedis() {
  if (redisDisabled) return false;
  const url = String(config.REDIS_URL || '').trim();
  if (!url || url === 'redis://localhost:6379') {
    if (!redisDisabled) {
      logger.info('Redis URL empty/default — using in-memory session store');
      redisDisabled = true;
    }
    return false;
  }
  return true;
}

async function ensureClient() {
  if (!shouldUseRedis()) return null;
  if (client && client.isOpen) return client;
  try {
    client = createClient({ url: config.REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: false } });
    client.on('error', (err) => logger.warn({ err: String(err?.message || err) }, 'Redis error (falling back to memory)'));
    await client.connect();
    return client;
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'Redis connect failed — disabling and using in-memory store');
    redisDisabled = true;
    client = null;
    return null;
  }
}

function key(sessionId) {
  return `${KEY_PREFIX}${sessionId}`;
}

function emptyState() {
  return {
    turns: 0,
    intent: null,
    language: 'en',
    profile: {},
    missing: [],
    last_question: null,
    asked_fields: [],
    history: [],
    updated_at: Date.now(),
    // Issue #1 — agent-path short-circuit state
    pending_action: null,            // 'awaiting_confirmation' | 'awaiting_link_permission' | null
    pending_product_id: null,        // Shopify GID, e.g. "gid://shopify/Product/123"
    pending_action_ts: null,         // Date.now() at SET time, for 60s staleness
    pending_action_category: null,   // category at SET time, for category-change-clear
  };
}

// Clear all four pending-action fields atomically.
// Use this on: SC fire (consume), 60s staleness, category change, /reset.
// Existing sessions in Redis predating Issue #1 will have these fields
// undefined; this still works because the SC checks use truthy checks.
export function clearPendingAction(state) {
  state.pending_action = null;
  state.pending_product_id = null;
  state.pending_action_ts = null;
  state.pending_action_category = null;
}

export async function getSession(sessionId) {
  const k = key(sessionId);
  const c = await ensureClient();
  let raw;
  if (c) {
    try { raw = await c.get(k); }
    catch (err) { logger.warn({ err: String(err?.message || err) }, 'Redis get failed — using memory'); raw = memGet(k); }
  } else {
    raw = memGet(k);
  }
  if (!raw) return emptyState();
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    logger.warn({ err, sessionId }, 'Corrupt session, resetting');
    return emptyState();
  }
}

export async function saveSession(sessionId, state) {
  const k = key(sessionId);
  state.updated_at = Date.now();
  const c = await ensureClient();
  if (c) {
    try { await c.set(k, JSON.stringify(state), { EX: config.SESSION_TTL_SECONDS }); return; }
    catch (err) { logger.warn({ err: String(err?.message || err) }, 'Redis set failed — using memory'); }
  }
  memSet(k, state, config.SESSION_TTL_SECONDS);
}

export async function resetSession(sessionId) {
  const k = key(sessionId);
  const c = await ensureClient();
  if (c) {
    try { await c.del(k); } catch (err) { logger.warn({ err }, 'Redis del failed'); }
  }
  memDel(k);
}

const NEW_SEARCH_PHRASE = /\b(looking\s*for|show\s*me|find\s*me|i\s*need(\s*a|n)?|i\s*want(\s*to\s*buy|\s*a|\s*an)?|i'?m\s*looking|can\s*you\s*(find|show|recommend))\b/i;

export function mergeProfile(profile, newEntities, rawText = '') {
  const newCategory = newEntities?.category;
  const isNewSearch = NEW_SEARCH_PHRASE.test(String(rawText || ''));

  const chipIsM = newEntities?.chip && /^M\d/i.test(String(newEntities.chip));
  const iphoneProfile = profile.category === 'iPhone';
  const conflictingChip = chipIsM && iphoneProfile;

  let next;
  if (isNewSearch && newCategory) {
    next = { ...newEntities };
  } else if (newCategory && profile.category && newCategory !== profile.category) {
    next = { ...newEntities };
  } else if (conflictingChip) {
    next = { ...newEntities, category: newEntities.category || 'Mac' };
  } else {
    next = { ...profile };
    for (const [k, v] of Object.entries(newEntities || {})) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (k === 'features') {
        const prev = Array.isArray(next.features) ? next.features : [];
        next.features = Array.from(new Set([...prev, ...v]));
        continue;
      }
      next[k] = v;
    }
  }
  return next;
}

export function appendHistory(state, role, text) {
  state.history = state.history || [];
  state.history.push({ role, text: String(text).slice(0, 400), ts: Date.now() });
  if (state.history.length > 20) state.history = state.history.slice(-20);
}

export async function closeRedis() {
  if (client && client.isOpen) await client.quit();
  client = null;
}
