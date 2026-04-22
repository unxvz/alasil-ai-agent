#!/usr/bin/env node
// Verify replies are broken into short lines / paragraphs instead of
// run-on sentences with inline comma lists.

import 'dotenv/config';
import { runAgent } from '../src/modules/agent.js';

const cases = [
  { input: 'iphone air', tag: 'multiple storage options' },
  { input: 'what colors do you have for iphone 17 pro?', tag: 'color list' },
  { input: 'cheapest macbook', tag: 'product list' },
  { input: 'which airpods do you have?', tag: 'variant list' },
];

function assess(reply) {
  const lines = reply.split('\n');
  const nonEmpty = lines.filter(l => l.trim());
  const longSentences = reply.split(/[.?!]\s/).filter(s => s.split(/\s+/).length > 25);
  const inlineCommaList = /\b\w+,\s*\w+,?\s*(and|or)\s+\w+\b/i.test(reply); // "A, B, and C"
  const bulletCount = (reply.match(/^\s*[-0-9]\.?\s/gm) || []).length;
  return {
    totalChars: reply.length,
    totalLines: lines.length,
    nonEmptyLines: nonEmpty.length,
    blankLineBreaks: (reply.match(/\n\n/g) || []).length,
    longSentences: longSentences.length,
    inlineCommaList,
    bulletCount,
  };
}

for (const c of cases) {
  const r = await runAgent({
    userMessage: c.input,
    language: 'en',
    history: [],
    lastProducts: [],
    sessionId: 'fmt-' + c.input.replace(/\W+/g, '-'),
  });
  const m = assess(r.text || '');
  console.log('\n─────────────────────────────────');
  console.log(`Input:  ${c.input}`);
  console.log(`(${c.tag})`);
  console.log(`\nReply:\n${r.text}`);
  console.log('\nMetrics:', JSON.stringify(m));
  const pass = m.longSentences === 0 && !m.inlineCommaList && m.blankLineBreaks >= 1;
  console.log('Formatting:', pass ? 'OK' : 'NEEDS REVIEW');
  await new Promise(r => setTimeout(r, 800));
}
