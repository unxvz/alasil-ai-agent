#!/usr/bin/env node
// Agent telemetry summarizer — reads logs/agent.jsonl and prints a daily rollup.
//
// Usage:
//   node scripts/agent-stats.js             # summary of last 24h
//   node scripts/agent-stats.js 7           # last 7 days
//   node scripts/agent-stats.js --today     # just today
//   node scripts/agent-stats.js --worst=20  # show 20 worst turns (no tool found, or very long)
//   node scripts/agent-stats.js --tail      # print last 20 entries

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.resolve(__dirname, '..', 'logs', 'agent.jsonl');

function argFlag(name) {
  const pfx = `--${name}`;
  const hit = process.argv.find((a) => a === pfx || a.startsWith(pfx + '='));
  if (!hit) return null;
  if (hit === pfx) return true;
  return hit.slice(pfx.length + 1);
}

function readLines() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`No agent log yet — ${LOG_FILE} does not exist.`);
    process.exit(0);
  }
  return fs
    .readFileSync(LOG_FILE, 'utf8')
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
}

function filterByAge(rows, days) {
  const cutoff = Date.now() - days * 86400000;
  return rows.filter((r) => new Date(r.ts).getTime() >= cutoff);
}

function filterByToday(rows) {
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter((r) => String(r.ts).startsWith(today));
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(rows) {
  const total = rows.length;
  if (total === 0) {
    console.log('No turns in this window.');
    return;
  }

  const errors = rows.filter((r) => r.error).length;
  const maxed = rows.filter((r) => r.maxed_out).length;
  const noTools = rows.filter((r) => !r.tool_calls || r.tool_calls.length === 0).length;
  const latencies = rows.map((r) => Number(r.latency_ms) || 0);
  const iters = rows.map((r) => Number(r.iterations) || 0);
  const avgLat = Math.round(latencies.reduce((a, b) => a + b, 0) / total);
  const p50Lat = percentile(latencies, 50);
  const p95Lat = percentile(latencies, 95);
  const avgIter = (iters.reduce((a, b) => a + b, 0) / total).toFixed(2);

  const byTool = {};
  for (const r of rows) {
    for (const tc of r.tool_calls || []) {
      const n = tc.name || 'unknown';
      if (!byTool[n]) byTool[n] = { calls: 0, zero_results: 0 };
      byTool[n].calls++;
      if ((tc.count || 0) === 0) byTool[n].zero_results++;
    }
  }
  const langs = {};
  for (const r of rows) {
    const l = r.language || 'unk';
    langs[l] = (langs[l] || 0) + 1;
  }

  console.log('\n──────────── AGENT STATS ────────────');
  console.log(`Turns:          ${total}`);
  console.log(`Errors:         ${errors} (${((errors / total) * 100).toFixed(1)}%)`);
  console.log(`Max iter hit:   ${maxed} (${((maxed / total) * 100).toFixed(1)}%)`);
  console.log(`No tool called: ${noTools} (${((noTools / total) * 100).toFixed(1)}%)`);
  console.log(`Avg iterations: ${avgIter}`);
  console.log(`Latency:        avg ${avgLat}ms  p50 ${p50Lat}ms  p95 ${p95Lat}ms`);

  console.log('\nBy tool:');
  for (const [name, s] of Object.entries(byTool).sort((a, b) => b[1].calls - a[1].calls)) {
    const zPct = s.calls ? ((s.zero_results / s.calls) * 100).toFixed(1) : '0.0';
    console.log(`  ${name.padEnd(20)} ${String(s.calls).padStart(5)} calls  ${String(s.zero_results).padStart(4)} empty (${zPct}%)`);
  }

  console.log('\nBy language:');
  for (const [l, c] of Object.entries(langs).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${l.padEnd(8)} ${c}`);
  }

  // Alerts
  const alerts = [];
  if (errors / total > 0.05) alerts.push(`!! Error rate ${(100 * errors / total).toFixed(1)}% (threshold 5%)`);
  if (maxed / total > 0.08) alerts.push(`!! Max-iter rate ${(100 * maxed / total).toFixed(1)}% (threshold 8%)`);
  if (p95Lat > 20000) alerts.push(`!! p95 latency ${p95Lat}ms (threshold 20s)`);
  const zeroTotal = Object.values(byTool).reduce((a, b) => a + b.zero_results, 0);
  const callsTotal = Object.values(byTool).reduce((a, b) => a + b.calls, 0);
  if (callsTotal > 10 && zeroTotal / callsTotal > 0.3) {
    alerts.push(`!! ${((zeroTotal / callsTotal) * 100).toFixed(1)}% of tool calls returned 0 products (threshold 30%)`);
  }
  if (alerts.length) {
    console.log('\nALERTS:');
    alerts.forEach((a) => console.log('  ' + a));
  } else {
    console.log('\nHealth: OK');
  }
}

function showWorst(rows, n) {
  const worst = [...rows]
    .sort((a, b) => {
      if (a.error && !b.error) return -1;
      if (b.error && !a.error) return 1;
      return (b.latency_ms || 0) - (a.latency_ms || 0);
    })
    .slice(0, n);
  console.log(`\nTop ${n} slow/failed turns:`);
  for (const r of worst) {
    const status = r.error ? 'ERR' : r.maxed_out ? 'MAX' : 'OK';
    console.log(`${r.ts}  [${status}]  ${r.latency_ms}ms  iter=${r.iterations}`);
    console.log(`  user: ${(r.msg || '').slice(0, 80)}`);
    console.log(`  tools: ${(r.tool_calls || []).map((t) => t.name + '(' + t.count + ')').join(', ') || 'none'}`);
    if (r.error) console.log(`  error: ${r.error}`);
    console.log(`  reply: ${(r.reply || '').slice(0, 140)}`);
  }
}

function showTail(rows, n) {
  const tail = rows.slice(-n);
  console.log(`\nLast ${tail.length} turns:`);
  for (const r of tail) {
    const status = r.error ? 'ERR' : r.maxed_out ? 'MAX' : 'OK';
    console.log(`${r.ts}  [${status}]  ${r.latency_ms}ms  ${(r.msg || '').slice(0, 60)}`);
    console.log(`  tools: ${(r.tool_calls || []).map((t) => t.name + '(' + t.count + ')').join(', ') || 'none'}`);
    console.log(`  reply: ${(r.reply || '').slice(0, 140)}`);
  }
}

function main() {
  const all = readLines();
  let rows;
  if (argFlag('today')) {
    rows = filterByToday(all);
  } else {
    const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const days = positional[0] ? parseInt(positional[0], 10) : 1;
    rows = filterByAge(all, days);
  }

  const tailFlag = argFlag('tail');
  if (tailFlag) {
    const n = typeof tailFlag === 'string' ? parseInt(tailFlag, 10) || 20 : 20;
    showTail(rows, n);
    return;
  }

  summarize(rows);

  const worstFlag = argFlag('worst');
  if (worstFlag) {
    const n = typeof worstFlag === 'string' ? parseInt(worstFlag, 10) || 10 : 10;
    showWorst(rows, n);
  }
}

main();
