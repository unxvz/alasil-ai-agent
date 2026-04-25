// State reset decision logic for the agent path.
//
// Issue #3 introduces explicit pivot-phrase detection + a reset decision
// matrix that handleAgent applies AFTER runAgent. The decision is based on:
//   - whether a pivot phrase was detected in the user message
//   - whether session.focus.category changed across the turn
//   - whether session.focus.family changed across the turn (when category did NOT)
//
// Three reset actions are returned:
//   - focusAction:
//       'keep'              — leave session.focus unchanged
//       'reset_full'        — clear session.focus entirely (user backing out)
//       'reset_to_category' — drop family/model_key/variant; keep category
//                             (cross-category pivot — old line-specific
//                              fields are stale relative to new category)
//   - clearLastProducts: should session.last_products be emptied?
//   - clearPendingAction: should pending_action fields be cleared?
//                         (Tier A merge alignment with Issue #1 — see comment
//                          block at the bottom of decideStateReset.)

/**
 * decideStateReset
 *
 * @param {object} args
 * @param {boolean} args.pivotDetected     - isPivotPhrase(userText) result
 * @param {object|null} args.focusBefore   - session.focus snapshot at handleAgent entry
 * @param {object|null} args.focusAfter    - session.focus snapshot AFTER runAgent's
 *                                            existing focus-update merge
 * @returns {{
 *   focusAction: 'keep' | 'reset_full' | 'reset_to_category',
 *   clearLastProducts: boolean,
 *   clearPendingAction: boolean
 * }}
 */
export function decideStateReset({ pivotDetected = false, focusBefore = null, focusAfter = null } = {}) {
  const categoryBefore = focusBefore?.category || null;
  const categoryAfter = focusAfter?.category || null;
  const familyBefore = focusBefore?.family || null;
  const familyAfter = focusAfter?.family || null;

  const categoryChanged =
    Boolean(categoryBefore) && Boolean(categoryAfter) && categoryBefore !== categoryAfter;
  // family change is only meaningful when category did NOT also change
  // (cross-category transitions are handled by the categoryChanged branch).
  const familyChanged =
    !categoryChanged &&
    Boolean(familyBefore) &&
    Boolean(familyAfter) &&
    familyBefore !== familyAfter;

  // Decision matrix (see Issue #3 acceptance in REFACTOR_PLAN.md):
  //
  //   pivot | catChg | famChg | focusAction         | clearLP | clearPA
  //   ------|--------|--------|---------------------|---------|--------
  //    yes  | yes    | (n/a)  | reset_to_category   | yes     | yes
  //    yes  | no     | yes    | keep                | yes     | yes
  //    no   | yes    | (n/a)  | keep                | yes     | yes
  //    no   | no     | yes    | keep                | no      | no
  //    yes  | no     | no     | reset_full          | yes     | yes
  //    no   | no     | no     | keep                | no      | no

  if (pivotDetected && categoryChanged) {
    return { focusAction: 'reset_to_category', clearLastProducts: true, clearPendingAction: true };
  }
  if (pivotDetected && familyChanged) {
    return { focusAction: 'keep', clearLastProducts: true, clearPendingAction: true };
  }
  if (!pivotDetected && categoryChanged) {
    return { focusAction: 'keep', clearLastProducts: true, clearPendingAction: true };
  }
  if (!pivotDetected && familyChanged) {
    return { focusAction: 'keep', clearLastProducts: false, clearPendingAction: false };
  }
  if (pivotDetected && !categoryChanged && !familyChanged) {
    // User backing out — pivot but no clear new direction.
    return { focusAction: 'reset_full', clearLastProducts: true, clearPendingAction: true };
  }
  // Default — no transition, no pivot — keep everything.
  return { focusAction: 'keep', clearLastProducts: false, clearPendingAction: false };

  // clearPendingAction is included in the return shape for Tier A merge
  // alignment. On this branch (refactor/03-family-reset), there's no
  // pending_action state to clear (Issue #1 hasn't merged yet). At Tier A
  // merge, handleAgent will call clearPendingAction(session) when this
  // boolean is true. See Issue #1's PR for the receiving end.
}

/**
 * applyResetDecision — pure mutation helper.
 *
 * Given a session and a decision object, mutates session.focus and
 * session.last_products in place per the decision. Exported separately
 * from decideStateReset so handleAgent stays a thin orchestrator and so
 * tests can verify the mutation behavior in isolation.
 *
 * Note: clearPendingAction is NOT applied here — that's a Tier A merge
 * concern (see comment in decideStateReset). The caller in handleAgent
 * decides whether to also call clearPendingAction(session) once Issue #1
 * is merged.
 *
 * @param {object} session - mutable session object
 * @param {object} decision - output of decideStateReset
 * @returns {void}
 */
export function applyResetDecision(session, decision) {
  if (!session || !decision) return;
  if (decision.focusAction === 'reset_full') {
    session.focus = null;
  } else if (decision.focusAction === 'reset_to_category') {
    if (session.focus) {
      session.focus.family = null;
      session.focus.model_key = null;
      session.focus.variant = null;
      // category and ts preserved (category just changed via the merge,
      // ts is a freshness marker we want to keep)
    }
  }
  // 'keep' → no change to session.focus
  if (decision.clearLastProducts) {
    session.last_products = [];
  }
}
