import { describe, it, expect } from 'vitest';
import { isPivotPhrase, PIVOT_TOKENS } from '../../src/utils/pivot-phrase.js';

describe('isPivotPhrase', () => {
  describe('English single-word tokens', () => {
    for (const token of PIVOT_TOKENS.en.filter((t) => !t.includes(' '))) {
      it(`matches "${token}"`, () => {
        expect(isPivotPhrase(token)).toBe(true);
      });
    }
    it('matches "actually show me MacBook" (first token wins)', () => {
      expect(isPivotPhrase('actually show me MacBook')).toBe(true);
    });
    it('matches "instead I want iPhone 16"', () => {
      expect(isPivotPhrase('instead I want iPhone 16')).toBe(true);
    });
    it('is case-insensitive: "Actually", "ACTUALLY", "Instead"', () => {
      expect(isPivotPhrase('Actually')).toBe(true);
      expect(isPivotPhrase('ACTUALLY')).toBe(true);
      expect(isPivotPhrase('Instead')).toBe(true);
    });
    it('matches with trailing punctuation: "actually!", "instead."', () => {
      expect(isPivotPhrase('actually!')).toBe(true);
      expect(isPivotPhrase('instead.')).toBe(true);
      expect(isPivotPhrase('instead?')).toBe(true);
    });
  });

  describe('English multi-word tokens', () => {
    it('matches "no actually" + suffix', () => {
      expect(isPivotPhrase('no actually')).toBe(true);
      expect(isPivotPhrase('no actually iPhone 16')).toBe(true);
    });
    it('matches "scratch that" + suffix', () => {
      expect(isPivotPhrase('scratch that')).toBe(true);
      expect(isPivotPhrase('scratch that one')).toBe(true);
    });
    it('matches "forget that"', () => {
      expect(isPivotPhrase('forget that')).toBe(true);
    });
    it('matches "different one" / "different model"', () => {
      expect(isPivotPhrase('different one')).toBe(true);
      expect(isPivotPhrase('different model please')).toBe(true);
    });
    it('matches "change my mind" / "never mind" / "wait no"', () => {
      expect(isPivotPhrase('change my mind')).toBe(true);
      expect(isPivotPhrase('never mind')).toBe(true);
      expect(isPivotPhrase('wait no')).toBe(true);
    });
    it('does NOT match "scratch" alone (multi-word "scratch that" requires "that")', () => {
      // "scratch" alone is not a pivot — only "scratch that" is whitelisted.
      expect(isPivotPhrase('scratch')).toBe(false);
    });
  });

  describe('Persian/Finglish (Latin transliteration)', () => {
    for (const token of PIVOT_TOKENS.fa_latin.filter((t) => !t.includes(' '))) {
      it(`matches "${token}"`, () => {
        expect(isPivotPhrase(token)).toBe(true);
      });
    }
    it('matches "na" + suffix ("na bezarid macbook")', () => {
      expect(isPivotPhrase('na bezarid macbook')).toBe(true);
    });
    it('matches "vali" + suffix', () => {
      expect(isPivotPhrase('vali macbook mikham')).toBe(true);
    });
    it('matches "bezar ye chize dige" multi-word', () => {
      expect(isPivotPhrase('bezar ye chize dige')).toBe(true);
    });
  });

  describe('Persian (script)', () => {
    for (const token of PIVOT_TOKENS.fa_script) {
      it(`matches "${token}"`, () => {
        // Note: "یه چیز دیگه" is multi-word and matches via startsWith.
        expect(isPivotPhrase(token)).toBe(true);
      });
    }
    it('matches "نه ماک‌بوک می‌خوام" (first token "نه")', () => {
      expect(isPivotPhrase('نه ماک‌بوک می‌خوام')).toBe(true);
    });
    it('matches "بدلا macbook"', () => {
      expect(isPivotPhrase('بدلا macbook')).toBe(true);
    });
  });

  describe('Arabic', () => {
    for (const token of PIVOT_TOKENS.ar.filter((t) => !t.includes(' '))) {
      it(`matches "${token}"`, () => {
        expect(isPivotPhrase(token)).toBe(true);
      });
    }
    it('matches "بدل ذلك" multi-word', () => {
      expect(isPivotPhrase('بدل ذلك')).toBe(true);
    });
    it('matches "شي ثاني" multi-word', () => {
      expect(isPivotPhrase('شي ثاني')).toBe(true);
    });
    it('matches "لا، اريد macbook" (first token "لا")', () => {
      expect(isPivotPhrase('لا، اريد macbook')).toBe(true);
    });
  });

  describe('negative cases', () => {
    it('rejects empty / whitespace / null / non-string', () => {
      expect(isPivotPhrase('')).toBe(false);
      expect(isPivotPhrase('   ')).toBe(false);
      expect(isPivotPhrase(null)).toBe(false);
      expect(isPivotPhrase(undefined)).toBe(false);
      expect(isPivotPhrase(42)).toBe(false);
      expect(isPivotPhrase({})).toBe(false);
    });

    it('rejects non-pivot phrases ("today", "yes", "iphone")', () => {
      expect(isPivotPhrase('today')).toBe(false);
      expect(isPivotPhrase('yes')).toBe(false);
      expect(isPivotPhrase('iphone 16 pro max')).toBe(false);
    });

    it('does NOT match pivot tokens buried mid-sentence ("show me macbook actually")', () => {
      // First-token-wins semantics: "show" leads, "actually" buried at end is ignored.
      expect(isPivotPhrase('show me macbook actually')).toBe(false);
    });

    it('does not false-match "actually" inside "actuallymacbook" (no space)', () => {
      // Tokenization splits on whitespace+punctuation, so "actuallymacbook"
      // is one token. Not in single-word whitelist (which has "actually" only).
      expect(isPivotPhrase('actuallymacbook')).toBe(false);
    });
  });

  describe('PIVOT_TOKENS export', () => {
    it('exposes all four language buckets', () => {
      expect(PIVOT_TOKENS).toHaveProperty('en');
      expect(PIVOT_TOKENS).toHaveProperty('fa_latin');
      expect(PIVOT_TOKENS).toHaveProperty('fa_script');
      expect(PIVOT_TOKENS).toHaveProperty('ar');
    });
    it('en bucket includes spec-required pivot phrases', () => {
      const required = ['instead', 'actually', 'forget that', 'scratch that', 'never mind'];
      for (const t of required) expect(PIVOT_TOKENS.en).toContain(t);
    });
    it('ar bucket includes spec-required pivot phrases', () => {
      const required = ['بدلا', 'بدل ذلك', 'لا', 'غير'];
      for (const t of required) expect(PIVOT_TOKENS.ar).toContain(t);
    });
    it('fa_script bucket includes spec-required pivot phrases', () => {
      const required = ['عوضش', 'نه', 'بدلا', 'بجای'];
      for (const t of required) expect(PIVOT_TOKENS.fa_script).toContain(t);
    });
  });
});
