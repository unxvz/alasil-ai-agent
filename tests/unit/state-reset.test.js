import { describe, it, expect } from 'vitest';
import { decideStateReset, applyResetDecision } from '../../src/utils/state-reset.js';

// Test factories
function focus(overrides = {}) {
  return { category: 'iPhone', family: 'iPhone 15', model_key: 'iPhone 15', variant: 'Standard', ts: 1, ...overrides };
}

describe('decideStateReset — decision matrix', () => {
  describe('pivot=true', () => {
    it('Case 1: pivot + category change → reset_to_category, clearLP, clearPA', () => {
      const result = decideStateReset({
        pivotDetected: true,
        focusBefore: focus({ category: 'iPhone', family: 'iPhone 15' }),
        focusAfter: focus({ category: 'Mac', family: 'MacBook Air' }),
      });
      expect(result).toEqual({
        focusAction: 'reset_to_category',
        clearLastProducts: true,
        clearPendingAction: true,
      });
    });

    it('Case 2: pivot + family change in same category → keep, clearLP, clearPA', () => {
      const result = decideStateReset({
        pivotDetected: true,
        focusBefore: focus({ category: 'iPhone', family: 'iPhone 15' }),
        focusAfter: focus({ category: 'iPhone', family: 'iPhone 16' }),
      });
      expect(result).toEqual({
        focusAction: 'keep',
        clearLastProducts: true,
        clearPendingAction: true,
      });
    });

    it('Case 5: pivot + no change → reset_full, clearLP, clearPA (user backing out)', () => {
      const result = decideStateReset({
        pivotDetected: true,
        focusBefore: focus({ category: 'iPhone', family: 'iPhone 15' }),
        focusAfter: focus({ category: 'iPhone', family: 'iPhone 15' }),
      });
      expect(result).toEqual({
        focusAction: 'reset_full',
        clearLastProducts: true,
        clearPendingAction: true,
      });
    });
  });

  describe('pivot=false', () => {
    it('Case 3: no pivot + category change → keep, clearLP, clearPA', () => {
      const result = decideStateReset({
        pivotDetected: false,
        focusBefore: focus({ category: 'iPhone', family: 'iPhone 15' }),
        focusAfter: focus({ category: 'Mac', family: 'MacBook Air' }),
      });
      expect(result).toEqual({
        focusAction: 'keep',
        clearLastProducts: true,
        clearPendingAction: true,
      });
    });

    it('Case 4: no pivot + family change in same category → keep everything (comparison/refinement)', () => {
      const result = decideStateReset({
        pivotDetected: false,
        focusBefore: focus({ category: 'iPhone', family: 'iPhone 15' }),
        focusAfter: focus({ category: 'iPhone', family: 'iPhone 16' }),
      });
      expect(result).toEqual({
        focusAction: 'keep',
        clearLastProducts: false,
        clearPendingAction: false,
      });
    });

    it('Case 6: no pivot + no change → keep everything', () => {
      const result = decideStateReset({
        pivotDetected: false,
        focusBefore: focus(),
        focusAfter: focus(),
      });
      expect(result).toEqual({
        focusAction: 'keep',
        clearLastProducts: false,
        clearPendingAction: false,
      });
    });
  });

  describe('edge cases', () => {
    it('focusBefore null (first turn) → keep regardless of pivot', () => {
      const noPivot = decideStateReset({
        pivotDetected: false,
        focusBefore: null,
        focusAfter: focus(),
      });
      expect(noPivot.focusAction).toBe('keep');
      expect(noPivot.clearLastProducts).toBe(false);

      const withPivot = decideStateReset({
        pivotDetected: true,
        focusBefore: null,
        focusAfter: focus(),
      });
      // No prior state → no category/family change → falls into Case 5
      // (pivot + no change → reset_full)
      expect(withPivot.focusAction).toBe('reset_full');
    });

    it('focusAfter null (post-runAgent focus is empty) → no change detected', () => {
      const result = decideStateReset({
        pivotDetected: false,
        focusBefore: focus(),
        focusAfter: null,
      });
      // No detectable change → keep
      expect(result.focusAction).toBe('keep');
      expect(result.clearLastProducts).toBe(false);
    });

    it('identical focusBefore and focusAfter → no change → falls into Case 6 or Case 5', () => {
      const f = focus();
      const noPivot = decideStateReset({
        pivotDetected: false,
        focusBefore: f,
        focusAfter: f,
      });
      expect(noPivot.focusAction).toBe('keep');
      expect(noPivot.clearLastProducts).toBe(false);

      const withPivot = decideStateReset({
        pivotDetected: true,
        focusBefore: f,
        focusAfter: f,
      });
      // Pivot + no change = Case 5 reset_full
      expect(withPivot.focusAction).toBe('reset_full');
    });

    it('only category set on both sides (family null) — pivot triggers reset_full not reset_to_category when category equal', () => {
      const result = decideStateReset({
        pivotDetected: true,
        focusBefore: { category: 'iPhone', family: null, ts: 1 },
        focusAfter: { category: 'iPhone', family: null, ts: 2 },
      });
      // Same category, both families null → no change → Case 5 reset_full
      expect(result.focusAction).toBe('reset_full');
    });

    it('handles missing args gracefully (no throw, default to no-action)', () => {
      expect(() => decideStateReset()).not.toThrow();
      expect(decideStateReset()).toEqual({
        focusAction: 'keep',
        clearLastProducts: false,
        clearPendingAction: false,
      });
    });
  });
});

describe('applyResetDecision — session mutation', () => {
  it('focusAction=keep does not modify session.focus', () => {
    const session = { focus: focus(), last_products: [{ id: 'p1' }] };
    applyResetDecision(session, {
      focusAction: 'keep',
      clearLastProducts: false,
      clearPendingAction: false,
    });
    expect(session.focus).toEqual(focus());
    expect(session.last_products).toEqual([{ id: 'p1' }]);
  });

  it('focusAction=reset_full nullifies session.focus', () => {
    const session = { focus: focus(), last_products: [] };
    applyResetDecision(session, {
      focusAction: 'reset_full',
      clearLastProducts: true,
      clearPendingAction: true,
    });
    expect(session.focus).toBe(null);
  });

  it('focusAction=reset_to_category drops family/model_key/variant, keeps category + ts', () => {
    const session = { focus: focus({ category: 'Mac', family: 'iPhone 15' }), last_products: [] };
    applyResetDecision(session, {
      focusAction: 'reset_to_category',
      clearLastProducts: true,
      clearPendingAction: true,
    });
    expect(session.focus.category).toBe('Mac');
    expect(session.focus.family).toBe(null);
    expect(session.focus.model_key).toBe(null);
    expect(session.focus.variant).toBe(null);
    expect(session.focus.ts).toBe(1);
  });

  it('clearLastProducts=true empties session.last_products', () => {
    const session = {
      focus: focus(),
      last_products: [{ id: 'p1' }, { id: 'p2' }],
    };
    applyResetDecision(session, {
      focusAction: 'keep',
      clearLastProducts: true,
      clearPendingAction: false,
    });
    expect(session.last_products).toEqual([]);
  });

  it('does NOT touch pending_action state on this branch (Tier A merge concern)', () => {
    // pending_action lives on Issue #1's branch only. applyResetDecision must
    // NOT touch session.pending_action even when clearPendingAction=true,
    // because handleAgent integration with Issue #1's clearPendingAction()
    // happens at Tier A merge, not on this branch.
    const session = {
      focus: focus(),
      last_products: [],
      pending_action: 'awaiting_confirmation',
      pending_product_id: 'gid://shopify/Product/123',
    };
    applyResetDecision(session, {
      focusAction: 'keep',
      clearLastProducts: false,
      clearPendingAction: true,
    });
    expect(session.pending_action).toBe('awaiting_confirmation');
    expect(session.pending_product_id).toBe('gid://shopify/Product/123');
  });

  it('handles null/undefined session gracefully', () => {
    expect(() => applyResetDecision(null, { focusAction: 'reset_full' })).not.toThrow();
    expect(() =>
      applyResetDecision(undefined, { focusAction: 'reset_to_category' })
    ).not.toThrow();
  });

  it('handles null/undefined decision gracefully', () => {
    const session = { focus: focus(), last_products: [{ id: 'p1' }] };
    expect(() => applyResetDecision(session, null)).not.toThrow();
    expect(session.focus).toEqual(focus()); // unchanged
    expect(session.last_products).toEqual([{ id: 'p1' }]);
  });

  it('handles session with null focus + reset_to_category gracefully (no throw)', () => {
    const session = { focus: null, last_products: [] };
    expect(() =>
      applyResetDecision(session, {
        focusAction: 'reset_to_category',
        clearLastProducts: true,
      })
    ).not.toThrow();
    expect(session.focus).toBe(null);
  });
});
