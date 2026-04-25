import { describe, it, expect } from 'vitest';
import { isAffirmative, AFFIRMATIVE_TOKENS } from '../../src/utils/affirmative.js';

describe('isAffirmative', () => {
  describe('English single-word tokens', () => {
    for (const token of AFFIRMATIVE_TOKENS.en.filter((t) => !t.includes(' '))) {
      it(`matches "${token}"`, () => {
        expect(isAffirmative(token)).toBe(true);
      });
    }
    it('matches "yes please send the link" (first token wins)', () => {
      expect(isAffirmative('yes please send the link')).toBe(true);
    });
    it('matches "ok send it now"', () => {
      expect(isAffirmative('ok send it now')).toBe(true);
    });
    it('is case-insensitive: "Yes", "YES", "OK"', () => {
      expect(isAffirmative('Yes')).toBe(true);
      expect(isAffirmative('YES')).toBe(true);
      expect(isAffirmative('OK')).toBe(true);
    });
    it('matches with trailing punctuation: "yes!", "ok."', () => {
      expect(isAffirmative('yes!')).toBe(true);
      expect(isAffirmative('ok.')).toBe(true);
      expect(isAffirmative('sure?')).toBe(true);
    });
  });

  describe('English multi-word tokens', () => {
    it('matches "send it"', () => {
      expect(isAffirmative('send it')).toBe(true);
    });
    it('matches "send it please"', () => {
      expect(isAffirmative('send it please')).toBe(true);
    });
    it('matches "send it!"', () => {
      expect(isAffirmative('send it!')).toBe(true);
    });
    it('does NOT match bare "send" (without "it")', () => {
      // "send" alone is ambiguous; spec lists "send it" specifically
      expect(isAffirmative('send')).toBe(false);
      expect(isAffirmative('send the link')).toBe(false);
    });
  });

  describe('Persian/Finglish (Latin transliteration)', () => {
    for (const token of AFFIRMATIVE_TOKENS.fa_latin) {
      it(`matches "${token}"`, () => {
        expect(isAffirmative(token)).toBe(true);
      });
    }
    it('matches "are bezarid besham" (first token "are")', () => {
      expect(isAffirmative('are bezarid besham')).toBe(true);
    });
  });

  describe('Persian (script)', () => {
    for (const token of AFFIRMATIVE_TOKENS.fa_script) {
      it(`matches "${token}"`, () => {
        expect(isAffirmative(token)).toBe(true);
      });
    }
    it('matches "بله لطفا" (first token "بله")', () => {
      expect(isAffirmative('بله لطفا')).toBe(true);
    });
    it('matches "آره حتما"', () => {
      expect(isAffirmative('آره حتما')).toBe(true);
    });
  });

  describe('Arabic', () => {
    for (const token of AFFIRMATIVE_TOKENS.ar) {
      it(`matches "${token}"`, () => {
        expect(isAffirmative(token)).toBe(true);
      });
    }
    it('matches "نعم تمام" (first token wins)', () => {
      expect(isAffirmative('نعم تمام')).toBe(true);
    });
  });

  describe('negative cases', () => {
    it('rejects empty / whitespace / null / non-string', () => {
      expect(isAffirmative('')).toBe(false);
      expect(isAffirmative('   ')).toBe(false);
      expect(isAffirmative(null)).toBe(false);
      expect(isAffirmative(undefined)).toBe(false);
      expect(isAffirmative(42)).toBe(false);
      expect(isAffirmative({})).toBe(false);
    });

    it('rejects "no", "maybe", "later", "I\'ll think about it"', () => {
      expect(isAffirmative('no')).toBe(false);
      expect(isAffirmative('maybe')).toBe(false);
      expect(isAffirmative('later')).toBe(false);
      expect(isAffirmative("I'll think about it")).toBe(false);
      expect(isAffirmative('not now')).toBe(false);
    });

    it('rejects "no but yes I want it" (negation leads, "yes" buried)', () => {
      // Critical false-positive guard: leading "no" must dominate even if
      // "yes" appears later in the message.
      expect(isAffirmative('no but yes I want it')).toBe(false);
    });

    it('does not false-match "okay" inside "okayyy"', () => {
      // We only match exact tokens, not substrings of longer words.
      expect(isAffirmative('okayyy')).toBe(false);
    });

    it('does not false-match Arabic "اه" inside "اهلاً"', () => {
      expect(isAffirmative('اهلاً')).toBe(false);
    });

    it('rejects shopping queries that happen to start with non-affirmative words', () => {
      expect(isAffirmative('iphone 17 pro max')).toBe(false);
      expect(isAffirmative('what colors does it come in')).toBe(false);
    });
  });

  describe('AFFIRMATIVE_TOKENS export', () => {
    it('exposes all four language buckets', () => {
      expect(AFFIRMATIVE_TOKENS).toHaveProperty('en');
      expect(AFFIRMATIVE_TOKENS).toHaveProperty('fa_latin');
      expect(AFFIRMATIVE_TOKENS).toHaveProperty('fa_script');
      expect(AFFIRMATIVE_TOKENS).toHaveProperty('ar');
    });
    it('en bucket includes the spec-required tokens', () => {
      const required = ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'alright', 'please', 'send it'];
      for (const t of required) expect(AFFIRMATIVE_TOKENS.en).toContain(t);
    });
    it('ar bucket includes the spec-required tokens', () => {
      const required = ['نعم', 'ايوه', 'اه', 'اوكي', 'تمام', 'طيب'];
      for (const t of required) expect(AFFIRMATIVE_TOKENS.ar).toContain(t);
    });
  });
});
