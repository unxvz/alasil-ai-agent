import { describe, it, expect } from 'vitest';
import {
  postProcessReply,
  deriveHandle,
  accumulateSurfacedHandles,
} from '../../src/modules/agent.js';

// These tests exercise the full agent post-process pipeline:
//   stripFormatting → validateUrls → enforceParagraphBreaks
// plus the deriveHandle helper that powers the surfacedHandles set.
//
// We test postProcessReply directly (rather than driving runAgent end-to-end
// with mocked OpenAI) because the OpenAI call is just a black box that
// produces text — what Issue #2 changes is the post-processing of that
// text. Mocking OpenAI to feed text in is equivalent to calling
// postProcessReply with the same text directly, but with less plumbing.

function set(...handles) {
  return new Set(handles);
}

describe('postProcessReply — end-to-end pipeline', () => {
  it('keeps a URL when its handle is in surfacedHandles', () => {
    const text = 'Confirmed — iPhone 15 Pro for AED 4,999.\n\nhttps://alasil.ae/products/iphone-15-pro\n\nAnything else?';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro'),
      sessionId: 'tg:test:1',
    });
    expect(result).toContain('https://alasil.ae/products/iphone-15-pro');
    expect(result).not.toContain('WhatsApp');
  });

  it('strips a URL when its handle is NOT in surfacedHandles, appends fallback', () => {
    const text = 'Try: https://alasil.ae/products/iphone-99-fictional';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro'),
      sessionId: 'tg:test:2',
    });
    expect(result).not.toContain('iphone-99-fictional');
    expect(result).toContain('Please contact us on WhatsApp +971 4 288 5680 for the link.');
  });

  it('strips ONLY the hallucinated URL when reply has both valid and invalid', () => {
    const text =
      'Both options:\n1. iPhone 15 Pro https://alasil.ae/products/iphone-15-pro\n2. Fake product https://alasil.ae/products/fictional-x';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro'),
      sessionId: 'tg:test:3',
    });
    expect(result).toContain('https://alasil.ae/products/iphone-15-pro');
    expect(result).not.toContain('fictional-x');
    // Fallback appears once even though both/either could have triggered it
    const fallbackCount = (result.match(/WhatsApp \+971 4 288 5680/g) || []).length;
    expect(fallbackCount).toBe(1);
  });

  it('does NOT substitute URLs (similar handle iphone-15-pro vs iphone-15-pro-max)', () => {
    // The critical safety guarantee from the spec: never silently swap a
    // similar product. Better to strip and ask customer to WhatsApp than
    // to send them to the wrong product.
    const text = 'Here you go: https://alasil.ae/products/iphone-15-pro';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro-max'),
      sessionId: 'tg:test:4',
    });
    expect(result).not.toContain('iphone-15-pro');
    expect(result).not.toContain('iphone-15-pro-max'); // never substituted
    expect(result).toContain('WhatsApp');
  });

  it('preserves UTM params on a valid URL', () => {
    // UTM is implicit-stripped during HANDLE extraction (URL.pathname only),
    // but the original URL with UTM flows through to the user verbatim.
    const text = 'Link: https://alasil.ae/products/iphone-15-pro?utm_source=alasil_ai_bot&utm_medium=chat';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro'),
      sessionId: 'tg:test:5',
    });
    expect(result).toContain('?utm_source=alasil_ai_bot&utm_medium=chat');
  });

  it('handles markdown link syntax (stripFormatting converts to "text URL", then validates)', () => {
    // Markdown like [iPhone 15 Pro](https://alasil.ae/products/iphone-15-pro)
    // is converted by stripFormatting to "iPhone 15 Pro https://...".
    const text = 'View: [iPhone 15 Pro](https://alasil.ae/products/iphone-15-pro)';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro'),
      sessionId: 'tg:test:6',
    });
    expect(result).toContain('iPhone 15 Pro');
    expect(result).toContain('https://alasil.ae/products/iphone-15-pro');
    expect(result).not.toContain('](');
  });

  it('strips markdown emphasis but preserves valid URL', () => {
    const text = 'Confirmed — **iPhone 15 Pro** for *AED 4,999*. https://alasil.ae/products/iphone-15-pro';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro'),
      sessionId: 'tg:test:7',
    });
    expect(result).not.toContain('**');
    expect(result).not.toContain(' *AED'); // strip italics around AED
    expect(result).toContain('iPhone 15 Pro');
    expect(result).toContain('https://alasil.ae/products/iphone-15-pro');
  });

  it('multi-product reply with two valid URLs: keeps BOTH (regression vs old stripUrlsForMultiProduct)', () => {
    // This is the key regression-safety case for replacing stripUrlsForMultiProduct.
    // Old behavior: 2-product reply → ALL URLs stripped (blunt heuristic).
    // New behavior: 2-product reply → URLs kept if they match surfacedHandles.
    const text =
      '1. iPhone 15 Pro — AED 4,999\nhttps://alasil.ae/products/iphone-15-pro\n\n2. iPhone 15 Pro Max — AED 5,499\nhttps://alasil.ae/products/iphone-15-pro-max';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro', 'iphone-15-pro-max'),
      sessionId: 'tg:test:8',
    });
    expect(result).toContain('https://alasil.ae/products/iphone-15-pro');
    expect(result).toContain('https://alasil.ae/products/iphone-15-pro-max');
    expect(result).not.toContain('WhatsApp');
  });

  it('empty surfacedHandles strips all URLs and appends single fallback', () => {
    const text = 'A: https://alasil.ae/products/foo, B: https://alasil.ae/products/bar';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set(),
      sessionId: 'tg:test:9',
    });
    expect(result).not.toContain('alasil.ae/products');
    const fallbackCount = (result.match(/WhatsApp/g) || []).length;
    expect(fallbackCount).toBe(1);
  });

  it('returns empty string for empty rawText', () => {
    const result = postProcessReply({
      rawText: '',
      surfacedHandles: set('foo'),
      sessionId: 'tg:test:10',
    });
    expect(result).toBe('');
  });

  it('handles missing/null inputs gracefully', () => {
    expect(() =>
      postProcessReply({ rawText: null, surfacedHandles: null, sessionId: 'tg:test:11' })
    ).not.toThrow();
  });

  it('preserves paragraph breaks when validation passes', () => {
    const text = 'Confirmed.\n\nhttps://alasil.ae/products/iphone-15-pro\n\nAnything else?';
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set('iphone-15-pro'),
      sessionId: 'tg:test:12',
    });
    // enforceParagraphBreaks shouldn't add extra breaks since text is already multi-paragraph
    expect(result.split('\n\n').length).toBeGreaterThanOrEqual(3);
  });
});

describe('deriveHandle — surfacedHandles seed/accumulation logic', () => {
  it('returns the handle field directly when present', () => {
    expect(deriveHandle({ handle: 'iphone-15-pro' })).toBe('iphone-15-pro');
  });

  it('falls back to extractHandleFromUrl when handle is missing (legacy session shape)', () => {
    expect(deriveHandle({ url: 'https://alasil.ae/products/iphone-15-pro' })).toBe('iphone-15-pro');
  });

  it('returns null for empty/null/undefined input', () => {
    expect(deriveHandle(null)).toBe(null);
    expect(deriveHandle(undefined)).toBe(null);
    expect(deriveHandle({})).toBe(null);
  });

  it('returns null when handle is non-string (defensive)', () => {
    expect(deriveHandle({ handle: 42 })).toBe(null);
    expect(deriveHandle({ handle: null, url: '' })).toBe(null);
  });

  it('correctly accumulates handles across the seed + tool-call pattern (overwrite-bug-fix proof)', () => {
    // Simulates the runAgent surfacedHandles construction:
    //   1. Seed from session.last_products
    //   2. Tool call #1 surfaces 4 products
    //   3. Tool call #2 surfaces 1 product (which would overwrite collectedProducts)
    // All products from all sources should be in surfacedHandles.
    const surfacedHandles = new Set();

    // Step 1: seed from lastProducts (with mixed shapes — pre-Issue-2 sessions
    // may have URL only, post-Issue-2 sessions have handle directly)
    const lastProducts = [
      { handle: 'macbook-air-m4' },
      { url: 'https://alasil.ae/products/airpods-pro-3' }, // legacy shape
    ];
    for (const p of lastProducts) {
      const h = deriveHandle(p);
      if (h) surfacedHandles.add(h);
    }

    // Step 2: tool call #1 surfaces 4 products
    const tool1Products = [
      { handle: 'iphone-15-pro' },
      { handle: 'iphone-15-pro-max' },
      { handle: 'iphone-15-plus' },
      { handle: 'iphone-15' },
    ];
    for (const p of tool1Products) {
      const h = deriveHandle(p);
      if (h) surfacedHandles.add(h);
    }

    // Step 3: tool call #2 surfaces 1 product. With the overwrite bug,
    // collectedProducts would ONLY contain this product; surfacedHandles
    // accumulates separately so the previous 4 from tool#1 survive.
    const tool2Products = [{ handle: 'apple-watch-ultra-3' }];
    for (const p of tool2Products) {
      const h = deriveHandle(p);
      if (h) surfacedHandles.add(h);
    }

    // All 7 handles should be in the set.
    expect(surfacedHandles.size).toBe(7);
    expect(surfacedHandles.has('macbook-air-m4')).toBe(true);
    expect(surfacedHandles.has('airpods-pro-3')).toBe(true);
    expect(surfacedHandles.has('iphone-15-pro')).toBe(true);
    expect(surfacedHandles.has('iphone-15-pro-max')).toBe(true);
    expect(surfacedHandles.has('iphone-15-plus')).toBe(true);
    expect(surfacedHandles.has('iphone-15')).toBe(true);
    expect(surfacedHandles.has('apple-watch-ultra-3')).toBe(true);
  });
});

// Issue #2 follow-up (corrections): findProduct returns its products in
// result.candidates, not result.products. Before this fix, every URL the
// LLM derived from findProduct results was stripped by the validator.
// See "Discovered During Refactor" entry on the field-name mismatch.
describe('accumulateSurfacedHandles — supports both products and candidates', () => {
  it('accumulates handles from result.products (browseMenu / searchProducts / filterCatalog)', () => {
    const set = new Set();
    accumulateSurfacedHandles(
      { products: [{ handle: 'iphone-15-pro' }, { handle: 'iphone-15-plus' }] },
      set
    );
    expect(set.size).toBe(2);
    expect(set.has('iphone-15-pro')).toBe(true);
    expect(set.has('iphone-15-plus')).toBe(true);
  });

  it('accumulates handles from result.candidates (findProduct — root-cause fix)', () => {
    const set = new Set();
    // Mohammad's exact case: catalog has this handle, findProduct returns
    // it as a candidate, but pre-fix surfacedHandles never knew about it.
    accumulateSurfacedHandles(
      {
        step: 'candidates',
        category: 'iPhone',
        candidates: [
          {
            handle:
              'apple-iphone-17-pro-max-256gb-deep-blue-titanium-middle-east-version-dual-esim',
          },
          {
            handle:
              'apple-iphone-17-pro-max-256gb-deep-blue-titanium-with-facetime-international-version-dual-esim',
          },
        ],
      },
      set
    );
    expect(set.size).toBe(2);
    expect(
      set.has('apple-iphone-17-pro-max-256gb-deep-blue-titanium-middle-east-version-dual-esim')
    ).toBe(true);
  });

  it('accumulates handles from BOTH products and candidates (defensive: tools may evolve)', () => {
    const set = new Set();
    accumulateSurfacedHandles(
      { products: [{ handle: 'a' }], candidates: [{ handle: 'b' }] },
      set
    );
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
  });

  it('end-to-end: candidate-derived URL survives postProcessReply (the bug fix in action)', () => {
    const handle =
      'apple-iphone-17-pro-max-256gb-deep-blue-titanium-middle-east-version-dual-esim';
    const set = new Set();
    // Simulate the agent's tool-call loop encountering findProduct's result.
    accumulateSurfacedHandles({ candidates: [{ handle }] }, set);
    // Then the LLM's reply containing that URL goes through postProcessReply.
    const text = `Confirmed — iPhone 17 Pro Max for AED 5,545.\n\nhttps://alasil.ae/products/${handle}`;
    const result = postProcessReply({
      rawText: text,
      surfacedHandles: set,
      sessionId: 'tg:test:candidate-flow',
    });
    expect(result).toContain(handle);
    expect(result).not.toContain('WhatsApp');
  });

  it('handles malformed input gracefully (null result, missing arrays, non-Set surfacedHandles)', () => {
    // Should not throw on any of these
    expect(() => accumulateSurfacedHandles(null, new Set())).not.toThrow();
    expect(() => accumulateSurfacedHandles({}, new Set())).not.toThrow();
    expect(() =>
      accumulateSurfacedHandles({ products: 'not-an-array' }, new Set())
    ).not.toThrow();
    // Non-Set surfacedHandles → no-op (defensive guard)
    accumulateSurfacedHandles({ products: [{ handle: 'x' }] }, null);
    accumulateSurfacedHandles({ products: [{ handle: 'x' }] }, []);
    // (no assertion needed; just ensuring it doesn't throw)
  });
});
