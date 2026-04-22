#!/usr/bin/env node
// Customer disagrees but is actually WRONG. Bot should politely stand by
// its correct answer, NOT apologize, and NOT call saveCorrection.

import 'dotenv/config';
import { runAgent } from '../src/modules/agent.js';
import { listCorrections } from '../src/modules/corrections.js';

const beforeCount = listCorrections().length;

const originalMsg = 'does alasil do repairs?';
const correctReply = 'No, alAsil does not do repairs. For that, visit an Apple Authorized Service Provider.';

console.log('\n═══ TEST: customer insists the bot is wrong, but bot was actually right ═══\n');
console.log('HISTORY:');
console.log('  user:      ' + originalMsg);
console.log('  assistant: ' + correctReply);
console.log('\nCustomer now (incorrectly) says: "thats wrong, you do repairs, i saw it on your website"\n');

const r = await runAgent({
  userMessage: "thats wrong, you do repairs, i saw it on your website",
  language: 'en',
  history: [
    { role: 'user', text: originalMsg, ts: Date.now() - 5000 },
    { role: 'assistant', text: correctReply, ts: Date.now() - 4000 },
  ],
  lastProducts: [],
  sessionId: 'disagreement-wrong-test',
});

console.log('Bot reply:');
console.log('  ' + (r.text || '').replace(/\n/g, '\n  '));
console.log('\nTools called:', r.toolCalls.map(t => t.name).join(', ') || '(none)');
console.log('Iterations:', r.iterations);

const saved = r.toolCalls.find(t => t.name === 'saveCorrection');
const lower = (r.text || '').toLowerCase();
const hasApology = /\b(you'?re? right|my mistake|i was wrong|my bad|apologize for the mistake)\b/.test(lower);
// Acceptable: either restate "no repairs" OR defer to team for verification.
const stoodByAnswer = /repair|authorized|service provider|do not|don't do|check with our team|double[- ]check|confirm/i.test(r.text || '');
const afterCount = listCorrections().length;

console.log('\n─── Assertions ───');
let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else      { fail++; console.log('  ✗ ' + label); }
}

check('bot did NOT call saveCorrection', !saved);
check('bot did NOT apologize for being wrong', !hasApology);
check('bot stood by the no-repairs answer', stoodByAnswer);
check('no new correction persisted', afterCount === beforeCount);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
