import { describe, it, expect } from 'vitest';
import { validateUrls, extractHandleFromUrl } from '../../src/utils/url-validation.js';

describe('extractHandleFromUrl', () => {
  it('extracts handle from a bare alasil URL', () => {
    expect(extractHandleFromUrl('https://alasil.ae/products/iphone-15-pro')).toBe('iphone-15-pro');
  });

  it('strips UTM params before returning handle', () => {
    expect(
      extractHandleFromUrl(
        'https://alasil.ae/products/iphone-15-pro?utm_source=alasil_ai_bot&utm_medium=chat'
      )
    ).toBe('iphone-15-pro');
  });

  it('strips fragment before returning handle', () => {
    expect(
      extractHandleFromUrl('https://alasil.ae/products/iphone-15-pro#variant-12345')
    ).toBe('iphone-15-pro');
  });

  it('strips combined UTM + fragment', () => {
    expect(
      extractHandleFromUrl('https://alasil.ae/products/iphone-15-pro?utm=x#variant-1')
    ).toBe('iphone-15-pro');
  });

  it('extracts handle regardless of domain (membership in allowedHandles is the gate, not domain)', () => {
    expect(extractHandleFromUrl('https://example.com/products/foo')).toBe('foo');
  });

  it('returns null for non-/products/ paths', () => {
    expect(extractHandleFromUrl('https://alasil.ae/collections/iphones')).toBe(null);
    expect(extractHandleFromUrl('https://alasil.ae/')).toBe(null);
    expect(extractHandleFromUrl('https://alasil.ae/products/')).toBe(null);
  });

  it('returns null for malformed URLs', () => {
    expect(extractHandleFromUrl('https://broken[)')).toBe(null);
    expect(extractHandleFromUrl('not a url')).toBe(null);
    expect(extractHandleFromUrl('://missing-scheme/products/foo')).toBe(null);
  });

  it('returns null for empty / non-string inputs', () => {
    expect(extractHandleFromUrl('')).toBe(null);
    expect(extractHandleFromUrl(null)).toBe(null);
    expect(extractHandleFromUrl(undefined)).toBe(null);
    expect(extractHandleFromUrl(42)).toBe(null);
    expect(extractHandleFromUrl({})).toBe(null);
  });

  it('strips trailing sentence punctuation before parsing', () => {
    expect(extractHandleFromUrl('https://alasil.ae/products/iphone-15-pro.')).toBe('iphone-15-pro');
    expect(extractHandleFromUrl('https://alasil.ae/products/iphone-15-pro,')).toBe('iphone-15-pro');
    expect(extractHandleFromUrl('https://alasil.ae/products/iphone-15-pro!')).toBe('iphone-15-pro');
  });
});

describe('validateUrls', () => {
  const allow = (...handles) => new Set(handles);

  describe('match behavior', () => {
    it('keeps an exact-match URL verbatim, no fallback appended', () => {
      const text = 'Confirmed — iPhone 15 Pro. https://alasil.ae/products/iphone-15-pro';
      const result = validateUrls(text, allow('iphone-15-pro'));
      expect(result.text).toContain('https://alasil.ae/products/iphone-15-pro');
      expect(result.text).not.toContain('WhatsApp');
      expect(result.stripped).toEqual([]);
    });

    it('preserves UTM params on a valid URL (handle matches via path-only check)', () => {
      const text = 'Here: https://alasil.ae/products/iphone-15-pro?utm_source=alasil_ai_bot';
      const result = validateUrls(text, allow('iphone-15-pro'));
      expect(result.text).toContain(
        'https://alasil.ae/products/iphone-15-pro?utm_source=alasil_ai_bot'
      );
      expect(result.stripped).toEqual([]);
    });

    it('keeps multiple valid URLs, no fallback', () => {
      const text = 'A: https://alasil.ae/products/foo and B: https://alasil.ae/products/bar';
      const result = validateUrls(text, allow('foo', 'bar'));
      expect(result.text).toContain('https://alasil.ae/products/foo');
      expect(result.text).toContain('https://alasil.ae/products/bar');
      expect(result.text).not.toContain('WhatsApp');
      expect(result.stripped).toEqual([]);
    });
  });

  describe('miss behavior', () => {
    it('strips a URL with a different handle (no fuzzy match)', () => {
      // Critical: never substitute "iphone-15-pro" for "iphone-15-pro-max" or similar.
      const text = 'Here: https://alasil.ae/products/iphone-15-pro';
      const result = validateUrls(text, allow('iphone-15-pro-max'));
      expect(result.text).not.toContain('iphone-15-pro');
      expect(result.text).toContain('Please contact us on WhatsApp +971 4 288 5680 for the link.');
      expect(result.stripped).toContain('https://alasil.ae/products/iphone-15-pro');
    });

    it('strips a hallucinated URL with handle not in any allowed set', () => {
      const text = 'Try: https://alasil.ae/products/iphone-99-fictional';
      const result = validateUrls(text, allow('iphone-15-pro', 'macbook-air'));
      expect(result.text).not.toContain('iphone-99-fictional');
      expect(result.text).toContain('WhatsApp +971 4 288 5680');
      expect(result.stripped).toEqual(['https://alasil.ae/products/iphone-99-fictional']);
    });

    it('appends fallback only ONCE when multiple URLs are stripped', () => {
      const text =
        'Two URLs: https://alasil.ae/products/bad-one and https://alasil.ae/products/bad-two';
      const result = validateUrls(text, allow('iphone-15-pro'));
      const fallbackOccurrences = (result.text.match(/WhatsApp \+971 4 288 5680/g) || []).length;
      expect(fallbackOccurrences).toBe(1);
      expect(result.stripped).toHaveLength(2);
    });

    it('mixed valid+invalid: keeps valid, strips invalid, appends fallback once', () => {
      const text =
        'Good: https://alasil.ae/products/iphone-15-pro and bad: https://alasil.ae/products/fake';
      const result = validateUrls(text, allow('iphone-15-pro'));
      expect(result.text).toContain('https://alasil.ae/products/iphone-15-pro');
      expect(result.text).not.toContain('products/fake');
      expect(result.text).toContain('WhatsApp');
      expect(result.stripped).toEqual(['https://alasil.ae/products/fake']);
    });

    it('with empty allowedHandles, every URL is stripped + single fallback', () => {
      const text = 'A: https://alasil.ae/products/foo, B: https://alasil.ae/products/bar';
      const result = validateUrls(text, new Set());
      expect(result.text).not.toContain('alasil.ae/products');
      const fallbackOccurrences = (result.text.match(/WhatsApp/g) || []).length;
      expect(fallbackOccurrences).toBe(1);
      expect(result.stripped).toHaveLength(2);
    });

    it('non-Set allowedHandles is treated as empty (defensive)', () => {
      const text = 'Here: https://alasil.ae/products/foo';
      const result = validateUrls(text, null);
      expect(result.stripped).toHaveLength(1);
      expect(result.text).toContain('WhatsApp');
    });
  });

  describe('edge cases', () => {
    it('returns text unchanged when no URLs are present', () => {
      const text = 'This is a plain text reply with no links.';
      const result = validateUrls(text, allow('iphone-15-pro'));
      expect(result.text).toBe(text);
      expect(result.stripped).toEqual([]);
    });

    it('returns empty for empty / non-string text', () => {
      expect(validateUrls('', allow('foo')).text).toBe('');
      expect(validateUrls(null, allow('foo')).text).toBe('');
      expect(validateUrls(undefined, allow('foo')).text).toBe('');
      expect(validateUrls(42, allow('foo')).text).toBe('');
    });

    it('handles trailing punctuation correctly: URL kept, period preserved in surrounding text', () => {
      // Critical: don't include the period as part of the URL when validating, but
      // also don't lose the period from the sentence.
      const text = 'See it here: https://alasil.ae/products/iphone-15-pro.';
      const result = validateUrls(text, allow('iphone-15-pro'));
      expect(result.text).toContain('https://alasil.ae/products/iphone-15-pro.');
      expect(result.stripped).toEqual([]);
    });

    it('strips a URL whose path is /products/ but with empty handle', () => {
      const text = 'Bad: https://alasil.ae/products/';
      const result = validateUrls(text, allow('iphone-15-pro'));
      // extractHandleFromUrl returns null for empty handle → URL is stripped.
      expect(result.stripped).toContain('https://alasil.ae/products/');
    });

    it('respects custom fallbackMessage option', () => {
      const text = 'Bad: https://alasil.ae/products/fake';
      const result = validateUrls(text, allow('real'), {
        fallbackMessage: 'Custom fallback message.',
      });
      expect(result.text).toContain('Custom fallback message.');
      expect(result.text).not.toContain('WhatsApp');
    });

    it('handles malformed URL within text gracefully', () => {
      const text = 'Broken: https://broken[) — try again.';
      const result = validateUrls(text, allow('iphone-15-pro'));
      // Regex captures up to the `[`, then URL constructor fails → stripped.
      expect(result.stripped.length).toBeGreaterThan(0);
      expect(result.text).toContain('WhatsApp');
    });

    it('returns the stripped URL list verbatim for telemetry', () => {
      const text = 'A: https://alasil.ae/products/bad-1 B: https://alasil.ae/products/bad-2';
      const result = validateUrls(text, allow('good'));
      expect(result.stripped).toEqual([
        'https://alasil.ae/products/bad-1',
        'https://alasil.ae/products/bad-2',
      ]);
    });

    it('handles markdown-converted text from stripFormatting (text URL pattern)', () => {
      // After stripFormatting runs first, [text](url) → "text url" with space.
      const text = 'View Product https://alasil.ae/products/iphone-15-pro and more.';
      const result = validateUrls(text, allow('iphone-15-pro'));
      expect(result.text).toContain('https://alasil.ae/products/iphone-15-pro');
      expect(result.stripped).toEqual([]);
    });
  });
});
