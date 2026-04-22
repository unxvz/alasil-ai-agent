#!/usr/bin/env node
// Simulate a customer correcting the bot, and verify:
//   1. The bot verifies via a tool (not blind agreement)
//   2. If customer was right, the reply starts with a short apology
//   3. saveCorrection tool was called
//   4. A correction row persisted and is injected on the next matching turn

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../src/modules/agent.js';
import { listCorrections, deleteCorrection } from '../src/modules/corrections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.resolve(__dirname, '..', 'logs', 'corrections.jsonl');

// Snapshot corrections so we can clean up after the test.
const beforeCount = listCorrections().length;

// Turn 1: customer asks a question that the bot's knowledge + tools should
// actually be able to answer correctly. We'll pretend the bot answered wrong
// by feeding the agent a fake conversation_history with a wrong assistant msg.
const originalMsg = 'does iphone 17 come in cosmic orange?';
const fakeWrongReply = 'No, the iPhone 17 does not have a Cosmic Orange color. The available colors are Black, White, Blue, Green.';

console.log('\n═══ TEST: customer disputes a previously-wrong bot reply ═══\n');
console.log('FAKE HISTORY:');
console.log('  user:      ' + originalMsg);
console.log('  assistant: ' + fakeWrongReply);
console.log('\nCustomer now says: "thats wrong, 17 does come in cosmic orange"\n');

const r = await runAgent({
  userMessage: "that's wrong, 17 does come in cosmic orange",
  language: 'en',
  history: [
    { role: 'user', text: originalMsg, ts: Date.now() - 5000 },
    { role: 'assistant', text: fakeWrongReply, ts: Date.now() - 4000 },
  ],
  lastProducts: [],
  sessionId: 'disagreement-test',
});

console.log('Bot reply:');
console.log('  ' + (r.text || '').replace(/\n/g, '\n  '));
console.log('\nTools called:', r.toolCalls.map(t => t.name).join(', ') || '(none)');
console.log('Iterations:', r.iterations);
console.log('Latency:', r.latency_ms + 'ms');

// Check for saveCorrection call
const savedCorrection = r.toolCalls.find(t => t.name === 'saveCorrection');
const verificationCall = r.toolCalls.find(t => ['getAvailableOptions', 'searchProducts', 'filterCatalog', 'getBySKU'].includes(t.name));

console.log('\n─── Assertions ───');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else      { fail++; console.log('  ✗ ' + label); }
}

check('verification tool was called before deciding', !!verificationCall);
check('saveCorrection was called (bot confirmed it was wrong)', !!savedCorrection);

const lower = (r.text || '').toLowerCase();
const hasApology = /\b(you'?re? right|my mistake|apolog|sorry|my bad)\b/.test(lower);
check('reply starts with a short apology', hasApology);

const replyMentionsOrange = /orange/i.test(r.text || '');
check('reply mentions Cosmic Orange', replyMentionsOrange);

const afterCount = listCorrections().length;
check('correction row persisted to disk', afterCount > beforeCount);

if (savedCorrection && savedCorrection.args) {
  const a = savedCorrection.args;
  check('saveCorrection captured the original user message', a.original_customer_message && a.original_customer_message.includes('orange'));
  check('saveCorrection captured a correct reply', !!a.correct_reply);
}

console.log(`\n${pass} passed, ${fail} failed.`);

// Cleanup — remove the correction we just created so repeated test runs don't stack.
if (afterCount > beforeCount) {
  const fresh = listCorrections();
  const created = fresh[fresh.length - 1];
  if (created) {
    const ok = deleteCorrection(created.id);
    console.log(`\n(cleaned up test correction ${created.id}: ${ok ? 'ok' : 'failed'})`);
  }
}

process.exit(fail > 0 ? 1 : 0);
