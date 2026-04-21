import { createClient } from 'redis';
import { config } from '../config.js';
import { logger } from '../logger.js';

const KEY_PREFIX = 'ai-support:session:';

let client = null;

async function ensureClient() {
  if (client && client.isOpen) return client;
  client = createClient({ url: config.REDIS_URL });
  client.on('error', (err) => logger.error({ err }, 'Redis error'));
  await client.connect();
  return client;
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
  };
}

export async function getSession(sessionId) {
  const c = await ensureClient();
  const raw = await c.get(key(sessionId));
  if (!raw) return emptyState();
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, sessionId }, 'Corrupt session, resetting');
    return emptyState();
  }
}

export async function saveSession(sessionId, state) {
  const c = await ensureClient();
  state.updated_at = Date.now();
  await c.set(key(sessionId), JSON.stringify(state), { EX: config.SESSION_TTL_SECONDS });
}

export async function resetSession(sessionId) {
  const c = await ensureClient();
  await c.del(key(sessionId));
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
