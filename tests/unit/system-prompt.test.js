import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from '../../src/modules/agent.js';

/**
 * Regression sentinels for SYSTEM_PROMPT critical clauses.
 *
 * These tests don't validate LLM behavior — system prompt compliance is
 * empirical and tested on staging. They catch the case where someone
 * accidentally edits or reverts a critical hallucination-guard clause.
 *
 * If you intentionally reword a clause, update the assertion to match.
 * If you intentionally remove a clause, remove the assertion AND document
 * why in the commit message.
 */
describe('SYSTEM_PROMPT — critical clause sentinels', () => {
  describe('Bug A: count=0 hallucination guard', () => {
    it('contains the CRITICAL section header', () => {
      expect(SYSTEM_PROMPT).toContain(
        'CRITICAL — when findProduct returns ZERO results'
      );
    });

    it('forbids URL fabrication when findProduct returns no results', () => {
      expect(SYSTEM_PROMPT).toContain('DO NOT generate or suggest URLs');
    });

    it('blocks the "user-typed-specs ≠ catalog presence" rationalization', () => {
      expect(SYSTEM_PROMPT).toContain(
        'Specs the customer typed are NOT a substitute'
      );
    });

    it('forbids proceeding to checkout flow on count=0', () => {
      expect(SYSTEM_PROMPT).toContain('DO NOT proceed with checkout');
    });

    it('contains the customer-pressure recovery path (WhatsApp redirect)', () => {
      expect(SYSTEM_PROMPT).toContain('WhatsApp us at +971 4 288 5680');
    });

    it('contains the no-exceptions framing that makes the rule binding', () => {
      expect(SYSTEM_PROMPT).toContain('There are NO exceptions to this rule');
    });
  });

  describe('overall prompt sanity', () => {
    it('SYSTEM_PROMPT length is in expected range (sanity check against accidental truncation)', () => {
      // The prompt should be substantial — anything under ~3000 chars likely
      // means it got truncated. The current prompt (post-Bug-A fix) is well
      // above this threshold; this guard catches catastrophic edits.
      expect(SYSTEM_PROMPT.length).toBeGreaterThan(3000);
    });
  });
});
