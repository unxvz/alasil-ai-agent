// Affirmative-message detection for agent-path short-circuits.
//
// Recognizes "yes / sure / ok / send it / etc." across the languages alAsil
// customers actually use: English, Persian (Latin transliteration + Persian
// script), and Arabic.
//
// Exported as both a flat token map (introspectable for tests / future
// legacy unification) and the `isAffirmative` predicate.
//
// Matching semantics:
//   - First-token-of-message wins for single-word tokens.
//     "yes please send the link" → matches via "yes" (first token)
//     "no but yes I want it"     → does NOT match (first token "no")
//   - Multi-word tokens match if the message starts with them.
//     "send it now"  → matches "send it"
//     "please send"  → matches "please" (single-word, first token)
//
// This matches user intent: an affirmative reply leads with the affirmative
// word, never buries it after a negation. The legacy YES_RE (response.js:294)
// uses strict ^...$ anchoring; we relax that to allow trailing words like
// "yes please send the link" while keeping the leading-word constraint.

export const AFFIRMATIVE_TOKENS = {
  en: ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'alright', 'please', 'send it'],
  fa_latin: ['are', 'baleh', 'hatman', 'lotfan', 'ok', 'okey', 'bale'],
  fa_script: ['آره', 'اره', 'بله', 'حتما', 'لطفا'],
  ar: ['نعم', 'ايوه', 'اه', 'اوكي', 'تمام', 'طيب'],
};

// Pre-compute single-word and multi-word lists (lowercased for Latin scripts;
// non-Latin scripts have no case so .toLowerCase() is a no-op for them).
const _allTokens = Object.values(AFFIRMATIVE_TOKENS).flat().map((t) => t.toLowerCase());
const _singleWord = new Set(_allTokens.filter((t) => !t.includes(' ')));
const _multiWord = _allTokens.filter((t) => t.includes(' '));

export function isAffirmative(message) {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return false;

  // Multi-word: message must START with the token, optionally followed by a
  // word boundary (whitespace, punctuation, or end-of-string).
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
