import { describe, it, expect } from 'vitest';
import { isPivotPhrase } from '../../src/utils/pivot-phrase.js';
import { decideStateReset, applyResetDecision } from '../../src/utils/state-reset.js';

// Integration test: exercises the full chain handleAgent uses for state
// reset — isPivotPhrase(userText) → decideStateReset(...) → applyResetDecision(session, decision).
//
// Per Issue #3 STEP 2 Decision 1 (test boundary): test at the boundary
// where Issue #3 actually composes its three pieces. Mocking OpenAI to
// drive runAgent end-to-end would test the mock plumbing more than the
// new behavior. Same approach as Issue #2's postProcessReply tests.

// ──── helpers ────

function focus(overrides = {}) {
  return {
    category: 'iPhone',
    family: 'iPhone 15',
    model_key: 'iPhone 15',
    variant: 'Standard',
    ts: 1700000000000,
    ...overrides,
  };
}

function product(overrides = {}) {
  return {
    id: 'gid://shopify/Product/1',
    title: 'iPhone 15 256GB Black',
    price_aed: 3500,
    category: 'iPhone',
    family: 'iPhone 15',
    model_key: 'iPhone 15',
    variant: 'Standard',
    storage_gb: 256,
    color: 'Black',
    handle: 'iphone-15-256gb-black',
    url: 'https://alasil.ae/products/iphone-15-256gb-black',
    in_stock: true,
    ...overrides,
  };
}

// Simulates the focus-update merge that handleAgent performs after runAgent
// returns. Mirrors src/routes/telegram.js handleAgent lines ~213-241 exactly.
function simulateHandleAgentFocusMerge(focusBefore, productFromTool) {
  if (!productFromTool) return focusBefore ? { ...focusBefore } : null;
  const merged = {
    ...(focusBefore || {}),
    category: productFromTool.category || focusBefore?.category,
    model_key: productFromTool.model_key || focusBefore?.model_key,
    family: productFromTool.family || focusBefore?.family,
    variant: productFromTool.variant || focusBefore?.variant,
    ts: 1700000000999,
  };
  return merged;
}

// Drives the full chain that handleAgent performs around runAgent.
function runFullResetChain({ session, userText, productFromThisTurn }) {
  const focusBefore = session.focus ? { ...session.focus } : null;
  const pivotDetected = isPivotPhrase(userText);

  // Simulate the focus-update merge that handleAgent does post-runAgent.
  session.focus = simulateHandleAgentFocusMerge(focusBefore, productFromThisTurn);

  // Simulate session.last_products update on successful tool result.
  if (productFromThisTurn) {
    session.last_products = [productFromThisTurn];
  }

  const focusAfter = session.focus ? { ...session.focus } : null;
  const decision = decideStateReset({ pivotDetected, focusBefore, focusAfter });
  applyResetDecision(session, decision);

  return { decision, focusBefore, focusAfter };
}

// ──── scenarios mapped to acceptance criteria ────

describe('Issue #3 family-transition-flow integration', () => {
  it('SAME-CATEGORY family transition, NO pivot → keep focus + last_products (refinement / comparison)', () => {
    const session = {
      focus: focus({ family: 'iPhone 15' }),
      last_products: [product({ family: 'iPhone 15' })],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'iphone 16 specs',
      productFromThisTurn: product({
        family: 'iPhone 16',
        model_key: 'iPhone 16',
        title: 'iPhone 16 256GB',
      }),
    });

    expect(decision.focusAction).toBe('keep');
    expect(decision.clearLastProducts).toBe(false);
    expect(session.focus.family).toBe('iPhone 16');
    expect(session.focus.category).toBe('iPhone');
    expect(session.last_products).toHaveLength(1);
  });

  it('SAME-CATEGORY family transition WITH pivot → keep focus, clear last_products', () => {
    const session = {
      focus: focus({ family: 'iPhone 15' }),
      last_products: [product({ family: 'iPhone 15' })],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'actually show me iPhone 16',
      productFromThisTurn: product({
        family: 'iPhone 16',
        model_key: 'iPhone 16',
      }),
    });

    expect(decision.focusAction).toBe('keep');
    expect(decision.clearLastProducts).toBe(true);
    expect(session.focus.family).toBe('iPhone 16');
    expect(session.last_products).toEqual([]);
  });

  it('CROSS-CATEGORY transition WITHOUT pivot → keep merged focus, clear last_products (fresh search)', () => {
    const session = {
      focus: focus({ category: 'iPhone', family: 'iPhone 15' }),
      last_products: [product()],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'show me MacBook Air',
      productFromThisTurn: product({
        category: 'Mac',
        family: 'MacBook Air',
        model_key: 'MacBook Air 13" (M5)',
        variant: null, // typical Mac products have no variant
      }),
    });

    expect(decision.focusAction).toBe('keep');
    expect(decision.clearLastProducts).toBe(true);
    expect(session.focus.category).toBe('Mac');
    expect(session.last_products).toEqual([]);
    // Note: focus.variant may still hold "Standard" from old iPhone since
    // the merge preserves null-incoming fields. This is the focus-pollution
    // bug the next case (cross-cat WITH pivot) explicitly fixes.
  });

  it('CROSS-CATEGORY transition WITH pivot → reset_to_category (drop family/model_key/variant), clear last_products', () => {
    const session = {
      focus: focus({ category: 'iPhone', family: 'iPhone 15', variant: 'Standard' }),
      last_products: [product()],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'actually I want a MacBook',
      productFromThisTurn: product({
        category: 'Mac',
        family: 'MacBook Air',
        model_key: 'MacBook Air 13" (M5)',
        variant: null,
      }),
    });

    expect(decision.focusAction).toBe('reset_to_category');
    expect(decision.clearLastProducts).toBe(true);
    expect(session.focus.category).toBe('Mac');
    // Critically: family/model_key/variant from old iPhone context are
    // DROPPED (the bug fix this test is asserting).
    expect(session.focus.family).toBe(null);
    expect(session.focus.model_key).toBe(null);
    expect(session.focus.variant).toBe(null);
    expect(session.last_products).toEqual([]);
  });

  it('PIVOT phrase with no category/family change → reset_full (user backing out)', () => {
    const session = {
      focus: focus({ family: 'iPhone 15' }),
      last_products: [product()],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'actually never mind',
      productFromThisTurn: null, // no new tool result this turn
    });

    expect(decision.focusAction).toBe('reset_full');
    expect(decision.clearLastProducts).toBe(true);
    expect(session.focus).toBe(null);
    expect(session.last_products).toEqual([]);
  });

  it('NO pivot, no transition (continued narrowing) → keep everything', () => {
    const session = {
      focus: focus({ family: 'iPhone 15' }),
      last_products: [product()],
    };
    const { decision } = runFullResetChain({
      session,
      userText: '256gb please',
      productFromThisTurn: product({ family: 'iPhone 15', model_key: 'iPhone 15', storage_gb: 256 }),
    });

    expect(decision.focusAction).toBe('keep');
    expect(decision.clearLastProducts).toBe(false);
    expect(session.focus.family).toBe('iPhone 15');
    expect(session.last_products).toHaveLength(1);
  });

  it('Persian pivot phrase ("vali macbook mikham") triggers same reset behavior as English', () => {
    const session = {
      focus: focus({ category: 'iPhone', family: 'iPhone 15' }),
      last_products: [product()],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'vali macbook mikham',
      productFromThisTurn: product({
        category: 'Mac',
        family: 'MacBook Air',
        model_key: 'MacBook Air 13" (M5)',
        variant: null,
      }),
    });

    expect(decision.focusAction).toBe('reset_to_category');
    expect(decision.clearLastProducts).toBe(true);
    expect(session.focus.family).toBe(null);
  });

  it('Arabic pivot phrase ("بدلا macbook") triggers same reset behavior', () => {
    const session = {
      focus: focus({ category: 'iPhone', family: 'iPhone 15' }),
      last_products: [product()],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'بدلا macbook',
      productFromThisTurn: product({
        category: 'Mac',
        family: 'MacBook Air',
        model_key: 'MacBook Air 13" (M5)',
        variant: null,
      }),
    });

    expect(decision.focusAction).toBe('reset_to_category');
    expect(decision.clearLastProducts).toBe(true);
  });

  it('First-turn (focusBefore null) with no pivot → keep, no clear', () => {
    const session = {
      focus: null,
      last_products: [],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'iphone 17 pro max',
      productFromThisTurn: product({ family: 'iPhone 17 Pro Max' }),
    });

    expect(decision.focusAction).toBe('keep');
    expect(decision.clearLastProducts).toBe(false);
    expect(session.focus.family).toBe('iPhone 17 Pro Max');
    expect(session.last_products).toHaveLength(1);
  });

  it('First-turn with pivot phrase ("actually show me iPhone 16") → reset_full', () => {
    // Edge case: customer leads with a pivot phrase even on first turn.
    // No prior state to pivot away from, but pivot detection still fires.
    // Result: pivotDetected=true, no category/family change → Case 5 reset_full.
    // Outcome: session stays empty (was already empty). Mostly a no-op,
    // but the decision matrix handles it predictably.
    const session = {
      focus: null,
      last_products: [],
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'actually show me iPhone 16',
      productFromThisTurn: null,
    });

    expect(decision.focusAction).toBe('reset_full');
    expect(decision.clearLastProducts).toBe(true);
    expect(session.focus).toBe(null);
    expect(session.last_products).toEqual([]);
  });

  it('Coordination with Issue #1: clearPendingAction returned but NOT applied on this branch', () => {
    // pending_action lives on Issue #1's branch only. This test asserts that
    // even when decideStateReset returns clearPendingAction: true, applyResetDecision
    // does NOT touch session.pending_action — that mutation happens at Tier A
    // merge in handleAgent's calling code, not in applyResetDecision itself.
    const session = {
      focus: focus({ category: 'iPhone' }),
      last_products: [product()],
      pending_action: 'awaiting_confirmation',
      pending_product_id: 'gid://shopify/Product/123',
      pending_action_ts: 1700000000000,
      pending_action_category: 'iPhone',
    };
    const { decision } = runFullResetChain({
      session,
      userText: 'actually I want a MacBook',
      productFromThisTurn: product({
        category: 'Mac',
        family: 'MacBook Air',
        model_key: 'MacBook Air 13" (M5)',
        variant: null,
      }),
    });

    // decideStateReset says yes:
    expect(decision.clearPendingAction).toBe(true);
    // applyResetDecision DOES NOT touch pending_action fields:
    expect(session.pending_action).toBe('awaiting_confirmation');
    expect(session.pending_product_id).toBe('gid://shopify/Product/123');
    // (At Tier A merge with Issue #1, handleAgent's caller code WILL clear
    // pending_action when decision.clearPendingAction is true, via Issue #1's
    // clearPendingAction(session) helper.)
  });
});
