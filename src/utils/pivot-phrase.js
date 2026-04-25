// Pivot-phrase detection for the agent reply pipeline.
//
// Recognizes user pivot intent across the languages alAsil customers
// actually use: English, Persian (Latin transliteration + Persian script),
// and Arabic. A "pivot phrase" signals "I changed direction / I want
// something else", e.g. "instead", "actually", "scratch that", "vali",
// "بدلا".
//
// Detection is paired downstream with focus/category/family transitions
// (see src/utils/state-reset.js decideStateReset) to decide whether to
// clear session.last_products, reset session.focus, or both.
//
// Exported as both a flat token map (introspectable for tests / future
// tuning) and the `isPivotPhrase` predicate. Mirrors the shape of
// src/utils/affirmative.js exactly.
//
// Matching semantics:
//   - First-token-of-message wins for single-word tokens.
//     "actually show me macbook" → matches via "actually" (first token)
//     "show me macbook actually" → does NOT match (first token "show")
//   - Multi-word tokens match if the message starts with them.
//     "no actually iphone 16" → matches "no actually"
//     "scratch that one"      → matches "scratch that"
//
// This matches user intent: a pivot is what someone says LEADING into a
// course-correction, not buried mid-sentence. Symmetric with affirmative.

export const PIVOT_TOKENS = {
  en: [
    'instead',
    'actually',
    'no actually',
    'forget that',
    'scratch that',
    'different one',
    'different model',
    'different product',
    'change my mind',
    'never mind',
    'not that',
    'wait no',
  ],
  fa_latin: [
    'vali',
    'na',
    'na ye chize dige',
    'baraye',
    'bezar ye chize dige',
    'bezar yek chize dige',
  ],
  fa_script: ['عوضش', 'نه', 'بدلا', 'بجای', 'یه چیز دیگه'],
  ar: ['بدلا', 'بدل ذلك', 'لا', 'غير', 'شي ثاني', 'شيء آخر'],
};

const _allTokens = Object.values(PIVOT_TOKENS).flat().map((t) => t.toLowerCase());
const _singleWord = new Set(_allTokens.filter((t) => !t.includes(' ')));
const _multiWord = _allTokens.filter((t) => t.includes(' '));

export function isPivotPhrase(message) {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return false;

  // Multi-word: message must START with the token, optionally followed by
  // a word boundary (whitespace, punctuation, or end-of-string).
  for (const mw of _multiWord) {
    if (trimmed === mw) return true;
    if (trimmed.startsWith(mw)) {
      const next = trimmed.charAt(mw.length);
      if (/[\s,.!?]/.test(next)) return true;
    }
  }

  // Single-word: split message into Unicode-aware tokens and check the FIRST.
  // Splitting on whitespace + punctuation works for Arabic/Persian script
  // because they share the same whitespace/punctuation conventions.
  const parts = trimmed.split(/[\s\p{P}]+/u).filter(Boolean);
  if (parts.length === 0) return false;
  return _singleWord.has(parts[0]);
}
