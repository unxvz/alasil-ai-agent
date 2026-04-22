// Owner feedback store — flags wrong agent replies and records the owner's
// preferred reply. These get injected into every future agent system prompt
// so the model learns the store's tone and corrects past mistakes.
//
// Format: one JSON line per entry in logs/corrections.jsonl
//   { id, ts, user_msg, wrong_reply, correct_reply, note }
//
// Hot-reloaded: cache is flushed on any write so the agent's next turn sees
// the update without needing a server restart.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'corrections.jsonl');

// Cap so the prompt doesn't balloon. We pick the MOST RECENT N corrections.
const MAX_INJECTED = 15;

let _cache = null;
let _cacheAt = 0;

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'could not create logs/ dir');
  }
}

function loadAll() {
  if (_cache) return _cache;
  try {
    if (!fs.existsSync(LOG_FILE)) {
      _cache = [];
      _cacheAt = Date.now();
      return _cache;
    }
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    _cache = raw
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    _cacheAt = Date.now();
    return _cache;
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'loadAll corrections failed');
    _cache = [];
    return _cache;
  }
}

function invalidate() {
  _cache = null;
}

export function listCorrections({ includeDeleted = false } = {}) {
  const all = loadAll();
  return includeDeleted ? all : all.filter((r) => !r.deleted);
}

export function addCorrection({ user_msg, wrong_reply, correct_reply, note }) {
  ensureLogDir();
  const row = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    user_msg: String(user_msg || '').slice(0, 800),
    wrong_reply: String(wrong_reply || '').slice(0, 2000),
    correct_reply: String(correct_reply || '').slice(0, 2000),
    note: String(note || '').slice(0, 400),
    deleted: false,
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(row) + '\n');
    invalidate();
    return row;
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'addCorrection failed');
    throw err;
  }
}

// Soft-delete by id — append a tombstone row. Keeps the audit trail intact.
export function deleteCorrection(id) {
  ensureLogDir();
  const all = loadAll();
  const target = all.find((r) => r.id === id);
  if (!target) return false;
  const tombstone = { ...target, deleted: true, deleted_ts: new Date().toISOString() };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(tombstone) + '\n');
    invalidate();
    return true;
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'deleteCorrection failed');
    return false;
  }
}

// Build the prompt block injected into every agent call. We keep the newest
// MAX_INJECTED corrections only.
export function correctionsBlock() {
  const rows = listCorrections();
  if (rows.length === 0) return '';
  // Keep latest version per id (tombstones would have been filtered; keep only
  // the last non-deleted occurrence per id).
  const byId = new Map();
  for (const r of rows) byId.set(r.id, r);
  const unique = Array.from(byId.values()).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const recent = unique.slice(0, MAX_INJECTED);

  const lines = ['# CORRECTIONS FROM STORE OWNER (highest priority — follow these patterns)'];
  lines.push(
    'The store owner has flagged these past replies as wrong. For similar future questions, follow the CORRECT pattern, not the WRONG one.'
  );
  for (const r of recent) {
    lines.push('');
    lines.push('---');
    lines.push(`CUSTOMER ASKED: ${r.user_msg || '(no message captured)'}`);
    if (r.wrong_reply) lines.push(`WRONG REPLY (do not repeat this): ${r.wrong_reply}`);
    if (r.correct_reply) lines.push(`CORRECT REPLY: ${r.correct_reply}`);
    if (r.note) lines.push(`OWNER NOTE: ${r.note}`);
  }
  return lines.join('\n');
}
