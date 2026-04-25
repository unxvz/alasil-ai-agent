import { describe, it, expect } from 'vitest';
import { clearPendingAction } from '../../src/modules/context.js';
import {
  isPendingActionStale,
  maybeSetPendingAction,
  buildSCReply,
} from '../../src/routes/telegram.js';

// Test helpers
function makeSessionWithPending(overrides = {}) {
  return {
    pending_action: 'awaiting_confirmation',
    pending_product_id: 'gid://shopify/Product/123',
    pending_action_ts: Date.now(),
    pending_action_category: 'iPhone',
    last_products: [],
    focus: null,
    language: 'en',
    history: [],
    ...overrides,
  };
}

function makeProduct(overrides = {}) {
  return {
    id: 'gid://shopify/Product/123',
    sku: 'MYMJ3AE/A',
    title: 'iPhone 17 Pro Max 256GB Deep Blue Middle East',
    price_aed: 5139,
    in_stock: true,
    category: 'iPhone',
    family: 'iPhone 17',
    model_key: 'iPhone 17 Pro Max',
    variant: 'Pro Max',
    storage_gb: 256,
    color: 'Deep Blue',
    region: 'Middle East',
    url: 'https://alasil.ae/products/iphone-17-pro-max-256gb-deep-blue',
    ...overrides,
  };
}

describe('clearPendingAction', () => {
  it('zeroes all four pending_action fields', () => {
    const s = makeSessionWithPending();
    clearPendingAction(s);
    expect(s.pending_action).toBe(null);
    expect(s.pending_product_id).toBe(null);
    expect(s.pending_action_ts).toBe(null);
    expect(s.pending_action_category).toBe(null);
  });

  it('does not touch unrelated fields', () => {
    const s = makeSessionWithPending({
      turns: 5,
      language: 'ar',
      history: [{ role: 'user', text: 'hi' }],
      last_products: [makeProduct()],
    });
    clearPendingAction(s);
    expect(s.turns).toBe(5);
    expect(s.language).toBe('ar');
    expect(s.history).toHaveLength(1);
    expect(s.last_products).toHaveLength(1);
  });

  it('is idempotent on an already-cleared session', () => {
    const s = {
      pending_action: null,
      pending_product_id: null,
      pending_action_ts: null,
      pending_action_category: null,
    };
    clearPendingAction(s);
    expect(s.pending_action).toBe(null);
  });

  it('handles undefined fields gracefully (legacy session shape)', () => {
    // Existing pre-Issue-1 sessions in Redis may lack these fields entirely.
    const legacy = { turns: 2, history: [] };
    expect(() => clearPendingAction(legacy)).not.toThrow();
    expect(legacy.pending_action).toBe(null);
  });
});

describe('isPendingActionStale', () => {
  it('returns false when pending_action is not set', () => {
    expect(isPendingActionStale({ pending_action: null })).toBe(false);
    expect(isPendingActionStale({})).toBe(false);
    expect(isPendingActionStale(null)).toBe(false);
  });

  it('returns false when pending_action_ts is recent (within 60s)', () => {
    const now = 1_700_000_000_000;
    const session = makeSessionWithPending({ pending_action_ts: now - 30_000 });
    expect(isPendingActionStale(session, now)).toBe(false);
  });

  it('returns true when pending_action_ts is older than 60s', () => {
    const now = 1_700_000_000_000;
    const session = makeSessionWithPending({ pending_action_ts: now - 60_001 });
    expect(isPendingActionStale(session, now)).toBe(true);
  });

  it('returns true exactly at 60_001ms (off-by-one guard)', () => {
    const now = 1_700_000_000_000;
    const session = makeSessionWithPending({ pending_action_ts: now - 60_001 });
    expect(isPendingActionStale(session, now)).toBe(true);
  });

  it('treats null/undefined ts as stale (defensive)', () => {
    const session = makeSessionWithPending({ pending_action_ts: null });
    expect(isPendingActionStale(session, Date.now())).toBe(true);
  });
});

describe('maybeSetPendingAction', () => {
  it('SETs awaiting_confirmation when 1 product + no URL in reply', () => {
    const s = { pending_action: null };
    const product = makeProduct();
    const agentResult = {
      products: [product],
      text: 'Is this the one — iPhone 17 Pro Max 256GB Deep Blue?',
    };
    maybeSetPendingAction(s, agentResult);
    expect(s.pending_action).toBe('awaiting_confirmation');
    expect(s.pending_product_id).toBe(product.id);
    expect(s.pending_action_category).toBe('iPhone');
    expect(typeof s.pending_action_ts).toBe('number');
  });

  it('does NOT SET when reply contains a URL (link already delivered)', () => {
    const s = { pending_action: null };
    const product = makeProduct();
    const agentResult = {
      products: [product],
      text: `Confirmed — iPhone 17 Pro Max for AED 5,139. ${product.url}`,
    };
    maybeSetPendingAction(s, agentResult);
    expect(s.pending_action).toBe(null);
  });

  it('does NOT SET when 0 products', () => {
    const s = { pending_action: null };
    maybeSetPendingAction(s, { products: [], text: 'What are you looking for?' });
    expect(s.pending_action).toBe(null);
  });

  it('does NOT SET when multiple products', () => {
    const s = { pending_action: null };
    maybeSetPendingAction(s, {
      products: [makeProduct(), makeProduct({ id: 'gid://shopify/Product/124' })],
      text: 'Two options...',
    });
    expect(s.pending_action).toBe(null);
  });

  it('does NOT SET when product has no id (defensive)', () => {
    const s = { pending_action: null };
    const product = makeProduct({ id: undefined });
    maybeSetPendingAction(s, { products: [product], text: 'Is this the one?' });
    expect(s.pending_action).toBe(null);
  });

  it('handles missing agentResult gracefully', () => {
    const s = { pending_action: null };
    expect(() => maybeSetPendingAction(s, null)).not.toThrow();
    expect(() => maybeSetPendingAction(s, {})).not.toThrow();
    expect(s.pending_action).toBe(null);
  });
});

describe('buildSCReply', () => {
  it('builds an English reply with title, price, URL, and closing line', () => {
    const text = buildSCReply(makeProduct(), 'en');
    expect(text).toContain('Confirmed');
    expect(text).toContain('iPhone 17 Pro Max 256GB Deep Blue Middle East');
    expect(text).toContain('AED 5,139');
    expect(text).toContain('https://alasil.ae/products/iphone-17-pro-max-256gb-deep-blue');
    expect(text).toContain('Anything else?');
  });

  it('builds an Arabic reply when language is "ar"', () => {
    const text = buildSCReply(makeProduct(), 'ar');
    expect(text).toContain('ممتاز');
    expect(text).toContain('iPhone 17 Pro Max 256GB Deep Blue Middle East');
    expect(text).toContain('AED 5,139');
    expect(text).toContain('هل تحتاج شيئًا آخر');
  });

  it('separates the URL on its own line for tappability', () => {
    const text = buildSCReply(makeProduct(), 'en');
    const lines = text.split('\n');
    const urlLineIdx = lines.findIndex((l) => l.startsWith('https://'));
    expect(urlLineIdx).toBeGreaterThan(0);
    expect(lines[urlLineIdx]).toBe('https://alasil.ae/products/iphone-17-pro-max-256gb-deep-blue');
  });

  it('omits price gracefully when product has no price_aed', () => {
    const text = buildSCReply(makeProduct({ price_aed: null }), 'en');
    expect(text).toContain('Confirmed');
    expect(text).not.toContain('AED');
    expect(text).toContain('Anything else?');
  });

  it('omits URL line gracefully when product has no url', () => {
    const text = buildSCReply(makeProduct({ url: null }), 'en');
    expect(text).toContain('Confirmed');
    expect(text).not.toContain('https://');
    expect(text).toContain('Anything else?');
  });
});
