#!/usr/bin/env node
// Simulate N concurrent Telegram messages hitting the agent. Verifies the
// limiter funnels them through the OpenAI gate and NONE fall into the
// escalation fallback path (which is what users saw under 429s before).
//
// Usage: node scripts/test-load.js 20

import 'dotenv/config';
import { runAgent, openaiLimiter } from '../src/modules/agent.js';

const N = parseInt(process.argv[2], 10) || 20;

const queries = [
  'iphone 17 pro max 256',
  'do you have iphone Air?',
  'ipad pro m4 11 inch',
  'does apple pencil 1 work with ipad air m4?',
  'macbook air m4 15 inch',
  'airpods 4 with anc',
  'apple watch ultra mojoude?',
  'JBL speaker',
  'warranty?',
  'can I pay with tabby?',
  'cheapest iphone',
  'i want an iphone',
  'mac studio m4 max 64gb ram',
  "what's the latest macbook?",
  'how much is airpods pro 3?',
];

console.log(`Firing ${N} concurrent agent calls (limiter gate visible as it fills)\n`);

let started = 0;
let done = 0;
let errs = 0;
let escalations = 0;
let totalMs = 0;

const reportInterval = setInterval(() => {
  const s = openaiLimiter.stats();
  console.log(`[t+${Math.round((Date.now() - t0) / 1000)}s] started=${started} done=${done} errs=${errs} escal=${escalations} gate=${s.active}/${s.max} queued=${s.queued}`);
}, 2000);

const t0 = Date.now();

const tasks = Array.from({ length: N }, (_, i) => {
  const q = queries[i % queries.length];
  started++;
  const start = Date.now();
  return runAgent({
    userMessage: q,
    language: 'en',
    history: [],
    lastProducts: [],
    sessionId: `load-${i}`,
  }).then(
    (r) => {
      done++;
      const ms = Date.now() - start;
      totalMs += ms;
      // If the reply is the escalation template, the retry loop gave up.
      const isEscalation = /check with our team|WhatsApp us at \+971/i.test(r.text || '');
      if (isEscalation) escalations++;
      return { i, q, ms, toolCalls: r.toolCalls?.length || 0, escalated: isEscalation };
    },
    (err) => {
      errs++;
      done++;
      return { i, q, err: String(err?.message || err) };
    }
  );
});

const results = await Promise.all(tasks);
clearInterval(reportInterval);
const total = Date.now() - t0;

console.log('\n──────────── RESULTS ────────────');
console.log(`Total wall time:     ${total}ms`);
console.log(`Avg per-turn time:   ${Math.round(totalMs / N)}ms`);
console.log(`Throughput:          ${(N / (total / 1000)).toFixed(1)} turns/sec`);
console.log(`Errors thrown:       ${errs}`);
console.log(`Escalation replies:  ${escalations} / ${N}`);

if (errs || escalations) {
  console.log('\nFailures:');
  for (const r of results.filter((x) => x.err || x.escalated)) {
    console.log(`  #${r.i} "${r.q}" — ${r.err || 'escalated (retry exhausted)'}`);
  }
}

process.exit(errs + escalations > 0 ? 1 : 0);
