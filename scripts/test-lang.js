import 'dotenv/config';
import { runAgent } from '../src/modules/agent.js';

const tests = [
  { input: 'iphone 17 pro max 256', lang: 'en', expect: 'english' },
  { input: 'salam, iphone 17 pro max mikham', lang: 'en', expect: 'english (finglish input)' },
  { input: 'ايفون 17 برو', lang: 'ar', expect: 'arabic' },
  { input: 'هل لديكم ماك بوك اير؟', lang: 'ar', expect: 'arabic' },
];

for (const t of tests) {
  const r = await runAgent({
    userMessage: t.input,
    language: t.lang,
    history: [],
    lastProducts: [],
    sessionId: 'lang-test',
  });
  const isArabic = /[\u0600-\u06FF]/.test(r.text);
  const isLatin = /[A-Za-z]/.test(r.text);
  const detected = isArabic ? 'Arabic' : (isLatin ? 'English/Latin' : 'other');
  console.log(`\nInput: "${t.input}"`);
  console.log(`Lang: ${t.lang}  Expect: ${t.expect}  Got: ${detected}`);
  console.log(`Reply: ${r.text.slice(0, 160)}`);
  await new Promise((r) => setTimeout(r, 500));
}
process.exit(0);
