#!/usr/bin/env node
// Show recent feedback entries (wrong/fix/bug reports from Telegram)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.resolve(__dirname, '..', 'logs', 'feedback.jsonl');

const N = parseInt(process.argv[2] || '20', 10);

if (!fs.existsSync(LOG)) {
  console.log('No feedback yet — logs/feedback.jsonl does not exist.');
  process.exit(0);
}

const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
const recent = lines.slice(-N);

console.log(`Showing last ${recent.length} feedback entries (of ${lines.length} total):\n`);

for (const raw of recent) {
  try {
    const e = JSON.parse(raw);
    console.log('─'.repeat(60));
    console.log(`${e.ts}  from: ${e.from}  session: ${e.sessionId}`);
    if (e.note)       console.log(`NOTE:   ${e.note}`);
    if (e.user_query) console.log(`USER:   ${e.user_query}`);
    if (e.bot_reply)  console.log(`BOT:    ${e.bot_reply.slice(0, 240)}${e.bot_reply.length > 240 ? '…' : ''}`);
    if (e.profile && Object.keys(e.profile).length) console.log(`CTX:    ${JSON.stringify(e.profile)}`);
    console.log('');
  } catch (err) {
    console.log('(malformed line)', raw.slice(0, 100));
  }
}
