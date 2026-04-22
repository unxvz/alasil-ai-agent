// Lightweight in-memory + append-log metrics for the agent.
// Writes one JSON line per turn to logs/agent.jsonl so we can tail / grep /
// summarize outside the running process.
//
// In-memory rolling counters let scripts/agent-stats.js print a live summary.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'agent.jsonl');

let counters = {
  total_turns: 0,
  total_errors: 0,
  total_max_iter: 0,
  total_latency_ms: 0,
  by_tool: {}, // { toolName: { calls, zero_results } }
  started_at: Date.now(),
};

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'could not create logs/ dir');
  }
}

export function recordAgentTurn({
  sessionId,
  userMessage,
  language,
  responseText,
  products,
  toolCalls,
  iterations,
  latency_ms,
  maxed_out,
  error,
}) {
  counters.total_turns++;
  counters.total_latency_ms += Number(latency_ms) || 0;
  if (error) counters.total_errors++;
  if (maxed_out) counters.total_max_iter++;

  for (const tc of toolCalls || []) {
    const name = tc.name || 'unknown';
    if (!counters.by_tool[name]) counters.by_tool[name] = { calls: 0, zero_results: 0 };
    counters.by_tool[name].calls++;
    if ((tc.count || 0) === 0) counters.by_tool[name].zero_results++;
  }

  ensureLogDir();
  try {
    const row = {
      ts: new Date().toISOString(),
      sessionId,
      msg: String(userMessage || '').slice(0, 400),
      language,
      reply: String(responseText || '').slice(0, 400),
      products_count: (products || []).length,
      tool_calls: (toolCalls || []).map((t) => ({ name: t.name, args: t.args, count: t.count })),
      iterations,
      latency_ms,
      maxed_out: Boolean(maxed_out),
      error: error || null,
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(row) + '\n');
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'could not append to logs/agent.jsonl');
  }
}

export function snapshotMetrics() {
  const uptime_ms = Date.now() - counters.started_at;
  const avg_latency_ms = counters.total_turns ? Math.round(counters.total_latency_ms / counters.total_turns) : 0;
  const error_rate = counters.total_turns ? (counters.total_errors / counters.total_turns) : 0;
  const maxed_rate = counters.total_turns ? (counters.total_max_iter / counters.total_turns) : 0;
  return {
    uptime_ms,
    total_turns: counters.total_turns,
    total_errors: counters.total_errors,
    total_max_iter: counters.total_max_iter,
    avg_latency_ms,
    error_rate,
    maxed_rate,
    by_tool: counters.by_tool,
  };
}

export function resetMetrics() {
  counters = {
    total_turns: 0,
    total_errors: 0,
    total_max_iter: 0,
    total_latency_ms: 0,
    by_tool: {},
    started_at: Date.now(),
  };
}
