# alAsil AI Bot Refactor — Complete Plan

═══════════════════════════════════════════════════════════════════════
REFACTOR STATUS — 2026-04-25
═══════════════════════════════════════════════════════════════════════

PHASE 0 — HOUSEKEEPING (in progress)

Q1 — Snapshot baseline:                                       ✅ COMPLETE
   - Branch:  pre-refactor-snapshot  (commit d84cabd)
   - Tag:     pre-refactor-baseline  (annotated, immutable)
   - Pushed:  origin/pre-refactor-snapshot
   - Contents: 12 files (2 docs + 10 src) — recovery baseline only

Q2 — Stray-file cleanup:                                      ✅ COMPLETE
   - Removed: src/modules/rate-limit.js  (stray copy of snapshot file)
   - Removed: src/modules/llm-extractor.js  (stray copy of snapshot file)
   - Removed: src/index.js  (legacy entrypoint)
   - Removed: src/agent.js  (legacy file)
   - Removed: src.backup-1777070495/  (entire directory)
   - Safety:  /tmp/alAsil-backup-archive-20260425-130740.tar.gz  (~30 day TTL)
   - Method:  rigorous 2-step diff verification per file (forward + reverse)

Q3 — Post-snapshot strategy (OPTION B clean reset):           ✅ COMPLETE
   - Step 4: Fast-forward main → 8b4a08e (+5 commits, legacy pipeline only)
   - Step 5: Created refactor/main from main; pushed to origin
   - Step 6: Verified state (branches, tags, src/ clean, working tree clean)
   - Step 7: Brought REFACTOR_PLAN.md + CLAUDE.md from snapshot; added this status block

ACTIVE WORK BRANCH:  refactor/main  (tracks origin/refactor/main)

PHASE 0 — REMAINING STEPS
   ✅ Vitest infrastructure  (commit 8328023, pushed)
   ⏳ Save docs/MANUAL_TESTS.md (25 manual scenarios S1–S25)
   ⏳ Resolve Incidents 1 + 2 (token + webhook secret rotation — see Incidents section)
   ⏳ Staging Environment Setup (separate bot + separate deploy target — see section below)

PHASE 1 — Codebase summary                                    ✅ COMPLETE (commit 1a1b068)
PHASE 2 — Issues (14 active; #4 and #6 obsolete per Path Y)   ⏳ PENDING

DISCOVERED DURING REFACTOR
   - 2026-04-25 (during Issue #1 reconnaissance):
     Legacy path's YES_RE (response.js:294) has narrower coverage
     than the new src/utils/affirmative.js helper introduced by
     Issue #1 (Arabic missing, most of the Persian list missing).
     Future cleanup: have legacy import `isAffirmative` from
     src/utils/affirmative.js to unify yes-detection across paths.
     NOT IN SCOPE for Issue #1 (agent-path-only scope per
     Mohammad's Decision 2). Sweep when legacy path is removed
     after USE_AGENT=true becomes permanent.

   - 2026-04-25 (Issue #1 plan, Q1):
     awaiting_link_permission flag built but inert. Current agent
     prompt emits URL inline on confirmation rather than asking
     "send the link?" first. Activating SC#3 requires either
     (i) a system prompt change to introduce the "send link?"
     question, or (ii) a UX decision that the inline URL is correct
     and SC#3 should be removed. Defer to a future issue dedicated
     to this UX/prompt question — out of scope for Issue #1.

   - 2026-04-25 (Issue #1 verify, sanity-read of handleAgent):

     ### Session-write race condition (pre-existing on refactor/main)

     When a user sends a follow-up message while the previous turn's
     runAgent is still in flight, Turn 2's processBufferedTurn may
     call getSession before Turn 1's saveSession completes. This
     causes Turn 2 to see stale session state (pending_action: null
     even when Turn 1 was about to SET it).

     - Effect: Functional correctness is preserved (no wedge, no
       double-confirmation, no data loss). The optimization is
       partially defeated — Turn 2 falls through to runAgent
       unnecessarily.
     - Affects: Not just pending_action — last_products, focus, and
       any other session field updated post-runAgent share this race.
     - Root cause: No write-locking or optimistic concurrency on the
       session store.
     - Recommended fix (future): Either (a) version field on session
       with compare-and-swap, (b) per-session mutex around handleAgent,
       or (c) Redis-backed atomic ops if the session store is ever
       migrated.
     - Scope: NOT Issue #1. This is foundational session-store work
       that warrants its own issue, possibly a Tier C addition.

   - 2026-04-25 (Issue #1 verify, vitest behavior):

     ### Coverage gating strategy needs revisiting

     Original plan was "70% per-file on changed files only". Vitest's
     per-file threshold doesn't compose this way: it measures the entire
     file regardless of which lines were actually changed by an issue.
     For Issue #1, this caused `context.js` (52%) and `telegram.js`
     (41%) to fail threshold despite the newly-added code being 100%
     tested — the failure was caused by pre-existing untested legacy
     code in those files (Redis paths, dedup, slash commands).

     **Current state:** Thresholds set to 0; coverage reported but
     not gated. Comment block in `vitest.config.js` documents this.

     **Recommended fix (post-Tier A):** Either (a) custom git-blame +
     coverage cross-reference tooling for line-level diff coverage,
     or (b) per-pattern thresholds (70% on `src/utils/**`, 0%
     elsewhere) once new helpers stabilize, or (c) live with
     report-only coverage and rely on PR review for adequacy.

     **Scope:** Not a refactor issue — it's a tooling decision.
     Revisit after Tier A merges to refactor/main, when we have a
     clearer picture of how much new test surface we've added overall.

   - 2026-04-25 (Issue #2 plan, Decision 5):

     ### UTM tagging not implemented

     Original Issue #2 spec mentioned preserving UTM-tagged URLs.
     UTM tagging itself is not implemented on refactor/main (was a
     snapshot-era feature). Issue #2's validator will strip UTM
     params before handle comparison so UTM-tagged URLs match
     correctly if/when UTM is later added. Active UTM tagging is
     deferred to a future issue dedicated to analytics/marketing
     tracking.

   - 2026-04-25 (Issue #2 reconnaissance — pre-existing bug on
     refactor/main, fixed in Issue #2 because the URL validator
     depends on it):

     ### collectedProducts overwrite bug in agent.js (FIXED in Issue #2)

     `agent.js runAgent` line ~638 currently overwrites
     `collectedProducts` on each tool call:
       `collectedProducts = result.products.slice(0, 4);`
     If tool#1 returns 4 products and tool#2 returns 2 products,
     the 4 from tool#1 are LOST. This means `agentResult.products`
     reported to telemetry and stored in `session.last_products`
     covers only the LAST tool call, not all surfaced products.

     For Issue #2's URL validator, this would cause valid URLs
     surfaced by tool#1 to fail validation in tool#2's reply.
     Fixed in Issue #2 by building a parallel `surfacedHandles`
     Set that accumulates across all tool calls (alongside keeping
     `collectedProducts` overwrite behavior for backwards
     compatibility with `session.last_products` consumers — the
     issue scope is URL validation, not session-data redesign).

   - 2026-04-25 (Issue #3 reconnaissance):

     ### mergeProfile cross-category wipe is too aggressive

     Legacy pipeline (`context.js:122`) wipes the entire
     `session.profile` on cross-category transitions
     (`newCategory && profile.category && newCategory !== profile.category`
     → `next = { ...newEntities }`). This loses budget / usage / feature
     preferences that should arguably survive a category change. Out
     of scope for Issue #3 (agent-only per Decision 1) but worth a
     future legacy-cleanup issue if/when the legacy pipeline is being
     touched.

   - 2026-04-25 (Issue #3 reconnaissance):

     ### mergeProfile silently rewrites category on M-chip detection

     Legacy `mergeProfile` at `context.js:124-126` has a
     `conflictingChip` branch — if newEntities has an M-chip but
     `profile.category` is iPhone, it silently switches to category
     'Mac'. Brittle: a customer typo like "iPhone with M3" would
     coerce them into Mac results. Pre-existing oddity. Not Issue #3
     territory.

   - 2026-04-25 (Issue #3 STEP 2 Decision 4 — parking lot):

     ### Pivot phrase false-positive monitoring (post-deploy)

     `PIVOT_TOKENS` in `src/utils/pivot-phrase.js` uses the spec's
     verbatim multi-language patterns. Some tokens (e.g., bare "no" /
     "na" / "لا" in EN/FA/AR, "actually" in EN) may match conversational
     filler that wasn't actually a pivot intent.

     The downstream effect is bounded: pivot only triggers state reset
     when paired with category/family change OR when alone (Case 5:
     pivot+nothing → reset_full). Lone false positives still cost the
     user a fresh-start session, which is recoverable but annoying.

     **Action (post-deploy):** monitor `'state reset applied'` logs in
     production for cases where `pivotDetected: true` led to
     `focusAction: 'reset_full'` unnecessarily. Tune the token list
     based on observed patterns. Consider adding stop-word gating
     ("actually fine" should not trigger).

     **Out of scope for Issue #3.** Initial regex is the spec's
     verbatim list.

═══════════════════════════════════════════════════════════════════════

## Incidents

### Incident 1 — Telegram bot token leaked (2026-04-25)
- **Found in PHASE 1 audit**: live production bot token committed in plaintext at `OPERATIONS.md` (3 sites) and `supervisor.sh:13`. A 5th occurrence was added by the PHASE 1 commit itself (`docs/CODEBASE_SUMMARY.md:148` — own-goal while documenting the leak).
- **Resolution plan**:
  1. Rotate via @BotFather (Mohammad).
  2. Deploy new token to production `.env` on cPanel (Mohammad).
  3. Redact literals from current files (Claude — Track A of pre-Issue-1 commit).
  4. Untrack `supervisor.sh` (dev-only) (Claude).
  5. Accept historical commits as compromised. **No git history rewrite** — rotation is what saves us.
- **Status**: rotation in progress; redactions queued in Track A; no production-affecting actions until Mohammad confirms "TOKEN ROTATED".

### Incident 2 — Telegram webhook secret leaked (2026-04-25)
- **Found in PHASE 1 audit**: webhook secret in `OPERATIONS.md` (URL line 7 + curl line 86) and `supervisor.sh:14`.
- **Lower stakes than Incident 1**: junk POST to webhook can't authenticate as a real Telegram update. Still a known-leaked credential — rotated as hygiene.
- **Resolution plan**: generate via `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` (Mohammad), update production `.env` (Mohammad), re-register webhook with Telegram (Mohammad), redact literals (Claude — Track A).
- **Status**: rotation in progress; redactions queued in Track A; no production-affecting actions until Mohammad confirms "WEBHOOK SECRET ROTATED".

### Process note (PHASE 1 own-goal)
The PHASE 1 `CODEBASE_SUMMARY.md` initially copied the live token verbatim while reporting the leak. The Track A commit redacts that own-goal in the same change set. Going forward, incident reports use placeholders (e.g. `<TELEGRAM_BOT_TOKEN>`) only, never literal credentials.

═══════════════════════════════════════════════════════════════════════

## Staging Environment Setup (pre-Issue-1 task)

**Acceptance criterion before Issue #1's first PR can ship**: a separate staging Telegram bot exists and is reachable from a non-production deploy target.

Steps:
1. Mohammad creates `@alasilAi_support_staging_bot` via @BotFather. Records staging token in 1Password (or equivalent secret store).
2. Mohammad chooses a staging deploy target — **decision needed**:
   - (a) same VPS, different port — cheapest, but shares disk + crash blast radius.
   - (b) separate VPS / Docker container — cleanest, slightly more setup.
   - (c) cPanel: a second Node.js app on the same panel — medium effort, isolated process but shared disk.
3. Staging `.env` reads:
   - `TELEGRAM_BOT_TOKEN` — staging token (separate from prod).
   - `TELEGRAM_WEBHOOK_SECRET` — separate.
   - `SHOPIFY_*` — same as prod (read-only catalog access).
   - `OPENAI_API_KEY` — same as prod (cost-shared, marginal).
4. Auto-deploy on push to `refactor/main` — **decision needed**: webhook-driven `git pull` + restart, OR manual deploy script. Mohammad picks based on existing infra.
5. `/health` endpoint returns staging-specific marker so we can confirm at-a-glance which env we're hitting.
6. Document staging URL + bot username in `OPERATIONS.md` when complete.

**Soak window**: 48h on staging before any prod deploy of refactored code (per Mohammad's risk tolerance).

**Status**: PENDING — Mohammad fills in (2) and (4) once dev-machine inventory is checked.

═══════════════════════════════════════════════════════════════════════

## Decision Log

Material decisions made during PHASE 0 / PHASE 1, with their rationale, so future-Claude or future-Mohammad can quickly see *why* a path was chosen.

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-25 | **OPTION B clean reset** for post-snapshot strategy (Q3) | Snapshot's 12-file refactor work was in-flight and not yet validated. Branching `refactor/main` from current `main` (post fast-forward of PR #1) gives a clean, trustworthy base. Snapshot remains on `pre-refactor-snapshot` branch + `pre-refactor-baseline` tag for reference. |
| 2026-04-25 | **PATH Y** — refactor/main is truth, no wholesale snapshot port | Confirms OPTION B's intent. Each issue rebuilds the relevant pieces issue-by-issue against current refactor/main. Snapshot used as REFERENCE only (showing how chat-session iteration evolved a feature), never copied wholesale. Direct effect: Issues #4 and #6 marked obsolete (their target artifacts only existed on snapshot). |
| 2026-04-25 | **OPTION A staging** — separate `@alasilAi_support_staging_bot` + separate deploy target | Lowest blast radius. Avoids feature-flag noise across every refactor branch and avoids deploying refactored code straight to production customers. 48h soak gate before any prod deploy. |
| 2026-04-25 | **OPTION 13-A** for Issue #13 — extract SYSTEM_PROMPT to `src/prompts/` folder | Knowledge files (`config/*.md`) are already modular at file level; the remaining monolith is the 340-line SYSTEM_PROMPT in `agent.js`. File-based prompts also unblock Issue #12 prompt caching (byte-identical prefix). Cleaner separation of copy ↔ code than option 13-B (functions inside agent.js). |
| 2026-04-25 | **NO git history rewrite** for token/webhook-secret leaks | Rotation is what saves us; history rewriting on a shared repo with collaborators creates more problems than it solves. Historical commits accepted as compromised post-rotation. |

═══════════════════════════════════════════════════════════════════════

## Recovery References
- Chat-session work: `git checkout pre-refactor-snapshot -- <file>`
  (branch + tag `pre-refactor-baseline`, both pushed to origin)
- Backup directory archive: `/tmp/alAsil-backup-archive-20260425-130740.tar.gz` (~30 day TTL)
- Local-only branch `backup-before-revert-to-24apr-20h` (commit 1075c5a, 2026-04-25 02:31):
  - Pre-existing safety capsule from before a manual revert on 24 Apr morning
  - Verified Scenario A: all unique content is older versions superseded by pre-refactor-snapshot
  - catalog_taxonomy.md content is auto-generated (regenerable via scripts/build-taxonomy.js)
  - tools/index.js content is pre-enhancement customerStorage (snapshot has the bare-number fallback)
  - **Action:** leave alone, do not delete, do not push, do not merge. Local safety reference only.

═══════════════════════════════════════════════════════════════════════

You are working on a Telegram-based AI shopping assistant for alAsil
(Apple products retailer in UAE). The system uses GPT-4.1-mini as the
main brain with Shopify catalog integration.

This is a comprehensive refactor addressing 16 identified issues.
Follow the workflow EXACTLY. Do not skip steps. Do not batch issues.

═══════════════════════════════════════════════════════════════════════
STEP 0 — IMMEDIATELY: SAVE THIS PLAN TO DISK
═══════════════════════════════════════════════════════════════════════

Before doing ANYTHING else:

1. Save this ENTIRE message verbatim to TWO files:
   - `docs/REFACTOR_PLAN.md` (create `docs/` if missing)
   - `CLAUDE.md` at repo root

2. Verify both files exist and are complete:
   - Run: `ls -la docs/REFACTOR_PLAN.md CLAUDE.md`
   - Run: `wc -l docs/REFACTOR_PLAN.md CLAUDE.md`
   - Both files should be 700+ lines

3. From this point forward, ALWAYS re-read these files at the start
   of EACH issue. Disk is source of truth, NOT your context window.

4. After saving, show me the output of `ls` and `wc` commands.

═══════════════════════════════════════════════════════════════════════
PHASE 0 — HOUSEKEEPING
═══════════════════════════════════════════════════════════════════════

After saving the plan to disk, do these steps. Show output of each.

1. **Check working tree:**
   - Run `git status` (full output)
   - Run `git diff --stat`
   - Run `git log --oneline -5`
   - WAIT for me to classify changes (commit-to-snapshot / stash /
     discard). Default policy: ALWAYS commit-to-snapshot before stash,
     ALWAYS confirm with me before discard.

2. **Sync with origin/main:**
   - Run `git fetch origin`
   - Run `git log origin/main ^main --oneline` — show me what those
     commits are first
   - WAIT for my review before pulling
   - After approval: `git pull --rebase origin main`
   - Resolve any conflicts, show resolution
   - Verify: `git log origin/main..HEAD` empty AND
     `git log HEAD..origin/main` empty

3. **Create base branch:**
   - `git checkout -b refactor/main` (from synced main)

4. **Install Vitest:**
   ```bash
   npm i -D vitest @vitest/ui @vitest/coverage-v8
   ```
   - Add to `package.json` scripts:
     ```json
     "test": "vitest run",
     "test:watch": "vitest",
     "test:ui": "vitest --ui",
     "test:coverage": "vitest run --coverage"
     ```
   - Create `vitest.config.js`:
     - Test patterns: `**/*.test.js`, `**/*.spec.js`
     - Coverage threshold: 70% for changed files only
     - Setup file: `tests/setup.js` (create empty)
   - Create folder structure:
     - `tests/unit/`
     - `tests/integration/`
     - `tests/fixtures/`
   - Add to `.gitignore`: `coverage/`, `.vitest-cache/`
   - Show me final `package.json` and `vitest.config.js` BEFORE
     committing
   - Commit as separate commit:
     `chore: add Vitest test infrastructure`

5. **Create manual test doc:**
   - Save `docs/MANUAL_TESTS.md` with the test scenarios from
     PHASE 3 below

═══════════════════════════════════════════════════════════════════════
PHASE 1 — CODEBASE UNDERSTANDING
═══════════════════════════════════════════════════════════════════════

Read these files in order. DO NOT WRITE CODE during this phase:
1. `src/telegram.js` — webhook handler, control gates
2. `src/agent.js` — main orchestration, short-circuits, post-processing
3. `src/product-state.js` — regex extraction, LLM extractor
4. `src/tools/index.js` — tool definitions and routing
5. `src/tools/findProduct.js` — Shopify search pipeline
6. `src/session.js` (or wherever session state lives — search for it)
7. `src/prompts/system.js` (or wherever SYSTEM_PROMPT lives —
   search for it)
8. `package.json` — dependencies and scripts
9. Any existing test files

If file paths differ, search the repo to find the equivalents.
Adapt the naming below to match actual files. Update
`docs/REFACTOR_PLAN.md` with actual file paths once discovered.

After reading, give me a summary covering:
- Current architecture flow (5 bullets max)
- Where session state lives (in-memory? Redis? file?)
- OpenAI SDK version
- Shopify API client used
- Existing tests (or absence)
- Any deviations from the issue list below that you noticed in code
- Whether a staging environment / staging Telegram bot exists

WAIT for my confirmation before moving to PHASE 2.

═══════════════════════════════════════════════════════════════════════
PHASE 2 — THE 16 ISSUES (refactor in this exact order)
═══════════════════════════════════════════════════════════════════════

Process them ONE AT A TIME using the workflow in PHASE 4.
Do NOT batch. Do NOT skip ahead.

────────────────────────────────────────────────────────────────────
TIER A — CRITICAL (data correctness / UX bugs) — do these first
────────────────────────────────────────────────────────────────────

ISSUE #1 — State flags instead of string matching for short-circuits
Branch: refactor/01-state-flags

PROBLEM (rewritten 2026-04-25 per PHASE 1 finding):
The agent path on refactor/main has no code-level short-circuits
for post-confirmation auto-respond or link-permission auto-respond.
These behaviors are currently delegated entirely to the LLM via
the system prompt, which means: (a) every confirmation/link turn
pays full LLM cost and latency, (b) behavior consistency depends
on prompt adherence, (c) cannot be deterministically tested. Add
code-level SC#2 and SC#3 driven by explicit session state flags
(not string matching, which would be brittle to localization).

[Original PROBLEM section retained below for traceability — it
describes snapshot-era code that does not exist on refactor/main.
See PHASE 1 reconnaissance summary in commit 1a1b068.]

ORIGINAL PROBLEM (snapshot-era, does not match refactor/main reality):
Currently SC#2 and SC#3 detect "Just to confirm…" and "Send link?"
via string matching the last bot reply. Breaks if:
- Bot replies in Arabic/Persian (different wording)
- Wording changes during prompt iteration
- Translation layer is added later

REQUIREMENTS:
Replace with explicit state flags.
- Add to session: `pending_action: 'awaiting_confirmation' |
  'awaiting_link_permission' | null`
- Add: `pending_product_id: string | null` (the Shopify GID)
- SET when bot asks the corresponding question (in agent.js, after
  emitting the message)
- CONSUME and CLEAR atomically when the SC triggers
- Clear pending_action on:
  - /reset command
  - Category change
  - 60s timeout (stale — user moved on)

SC#2 new check:
  session.pending_action === 'awaiting_confirmation'
  && userMessageIsAffirmative(msg)

SC#3 new check:
  session.pending_action === 'awaiting_link_permission'
  && userMessageIsAffirmative(msg)

Where `userMessageIsAffirmative` recognizes:
- English: yes, y, yeah, yep, sure, ok, okay, alright, please, send it
- Arabic: نعم, ايوه, اه, اوكي, تمام, طيب
- Persian/Finglish: are, آره, اره, baleh, بله, hatman, حتما, lotfan,
  لطفا, ok, okey

ACCEPTANCE:
- Manual scenarios S8, S9, S10 pass
- Unit test: pending_action correctly set/cleared
- Unit test: 60s timeout expires flag
- Unit test: /reset clears flag
- Bot replying in Arabic still triggers SC#2/SC#3 correctly

────────────────────────────────────────────────────────────────────

ISSUE #2 — URL validation hardening
Branch: refactor/02-url-validation

PROBLEM (rewritten 2026-04-25 per PHASE 1 / Issue #2 reconnaissance):
The agent path on refactor/main has NO URL validation. The closest
existing safety net is `stripUrlsForMultiProduct` in `agent.js`,
which strips ALL URLs only when product count > 1, and trusts the
LLM blindly when product count === 1. Three hallucination pathways
exist:

  (a) LLM mixes handles across multiple tool calls and emits a
      Frankenstein URL (e.g. takes "iphone-15-pro" from one call
      and "512gb-deep-blue" from another, fabricates a non-existent
      URL like /products/iphone-15-pro-512gb-deep-blue).
  (b) LLM echoes a URL from the LAST PRODUCTS context block even
      when no tool was called this turn.
  (c) LLM constructs a URL from the format pattern shown in the
      system prompt (alasil.ae/products/<handle>) using its own
      knowledge of product naming.

Add an explicit URL validator that extracts the handle from any URL
in the LLM reply, compares it against the set of handles surfaced
this turn (via tool results) PLUS handles from session.last_products
(prior turns), and either keeps the URL (exact handle match) or
strips it and appends a WhatsApp fallback. Never fuzzy-substitute.

[Original PROBLEM section retained below for traceability — it
describes snapshot-era code (`validateUrls` with 60% token-overlap)
that does not exist on refactor/main. See PHASE 1 reconnaissance
in commit 1a1b068.]

ORIGINAL PROBLEM (snapshot-era, does not match refactor/main reality):
Current `validateUrls` does 60% token-overlap substitution. Can
silently swap "iPhone 15 Pro" for "iPhone 15 Pro Max" (~83% overlap).
Customer buys wrong product. Real money lost.

REQUIREMENTS:
- Match ONLY by `product.handle` (URL slug) — exact match, no fuzzy
- When findProduct returns results, inject invisible HTML comments in
  tool result text:
  `<!--pid:gid://shopify/Product/123 handle:iphone-15-pro-->`
  for each product surfaced
- Strip these markers from final user-facing message in
  post-processing (AFTER URL validation runs)
- On URL validation:
  1. Extract URL from LLM response
  2. Extract handle from URL path (e.g.,
     /products/iphone-15-pro?utm=... → "iphone-15-pro")
  3. Look up handle in catalog cache
  4. Verify handle was surfaced in THIS turn's tool results
     (not just exists in catalog — prevents LLM hallucinating valid
     URLs from memory)
  5. If both checks pass → keep URL (with UTM params)
  6. Otherwise → STRIP the URL, append:
     "Please contact us on WhatsApp +971 4 288 5680 for the link."
- NEVER substitute URLs. Only keep or strip. No guessing.

ACCEPTANCE:
- Manual scenarios S19, S20 pass
- Unit test: exact handle match → kept
- Unit test: similar handle (iphone-15-pro vs iphone-15-pro-max) →
  stripped (not substituted)
- Unit test: hallucinated URL → stripped + WhatsApp message appended
- Unit test: valid handle but not surfaced this turn → stripped
- Unit test: UTM-tagged version of valid handle → kept with UTM intact

────────────────────────────────────────────────────────────────────

ISSUE #3 — Family-change reset is too aggressive
Branch: refactor/03-family-reset

PROBLEM (rewritten 2026-04-25 per Issue #3 reconnaissance):
The agent path on refactor/main has NO automatic family-change or
category-change reset logic. State transitions (iPhone 15 → iPhone 16
→ MacBook) flow through `session.focus` via merge-only logic in
`routes/telegram.js handleAgent`, with `session.last_products` simply
overwritten on every successful tool call. There is no pivot-phrase
detection ("instead", "actually", "vali", "بدلا").

This causes two problems on the agent path:
  (a) Stale `session.last_products` survives cross-category transitions
      (iPhone → MacBook), confusing the LLM's LAST PRODUCTS context.
  (b) `session.focus` accumulates incompatible fields across category
      transitions (e.g. category=Mac but family=iPhone 15 from prior
      turn) due to merge-only updates.

The "current reset wipes ALL family-specific specs" sentence in the
original spec describes legacy `mergeProfile` behavior in
`context.js:122` (legacy pipeline only) — not the agent path.

Issue #3 adds explicit pivot-phrase detection + a state-reset decision
function for the agent path. Legacy `mergeProfile` is out of scope
(Issue #1/#2 scope discipline: agent-path-only).

[Original PROBLEM section retained below for traceability — describes
legacy-pipeline behavior, not agent-path reality. See Issue #3
reconnaissance.]

ORIGINAL PROBLEM (legacy mergeProfile, not agent-path):
Current reset wipes ALL family-specific specs whenever a different
family is detected. Breaks comparison flows: "iPhone 16 specs?" →
"compare with 15" → context wiped, bot forgets iPhone 16 conversation.

REQUIREMENTS:
Reset specs ONLY when ONE of:

a) CATEGORY CHANGE (always reset):
   iphone → mac, mac → ipad, ipad → airpods, airpods → watch, etc.

b) EXPLICIT PIVOT PHRASE detected in user message:
   English regex:
     /\b(instead|actually|no actually|forget that|scratch that|
       different (one|model|product)|change my mind|never mind|
       not that|wait no)\b/i

   Persian/Finglish:
     /\b(vali|na|na ye chize dige|baraye|bezar (ye|yek) chize dige|
       عوضش|نه|بدلا|بجای|یه چیز دیگه)\b/i

   Arabic:
     /(بدلا|بدل ذلك|لا|غير|شي ثاني|شيء آخر)/

If neither condition met → PRESERVE compatible specs across family
changes within the same category:
- PRESERVE: storage, color, region, sim_type, connectivity
- RESET: chip_generation, ram_tier, screen_size (family-specific)

When reset triggered, log reason:
  console.log('[STATE] Specs reset:', { reason: 'category_change' |
    'pivot_phrase', from: oldFamily, to: newFamily })

ACCEPTANCE (rewritten 2026-04-25 per Decision 2 — agent-path session
shape lacks storage/color/region at session level; specs flow through
session.last_products and the LAST PRODUCTS context block):

- Manual scenarios S6, S7 pass (covered by integration test until
  MANUAL_TESTS.md is written)
- Unit test: same-category family transition (iPhone 15 → iPhone 16)
  with no pivot phrase → session.focus.family updated, session.focus
  .category preserved, session.last_products preserved
- Unit test: same-category family transition WITH pivot phrase
  ("actually show me iPhone 16") → session.focus updated,
  session.last_products cleared (signal: user changed direction)
- Unit test: cross-category transition (iPhone → MacBook) without
  pivot → session.focus.category updates, session.last_products
  cleared (cross-category implies fresh search)
- Unit test: cross-category transition WITH pivot ("actually I want
  a MacBook") → session.focus.family/model_key/variant cleared (drop
  iPhone-era stale fields), category updates, session.last_products
  cleared
- Unit test: pivot phrase with no category change ("actually never
  mind") → session.focus AND session.last_products fully cleared
  (user backing out)

DECISION MATRIX (full table — implemented in src/utils/state-reset.js
decideStateReset({pivotDetected, focusBefore, focusAfter})):

  pivot  | category change | family change | focusAction         | clearLastProducts
  -------|-----------------|---------------|---------------------|-------------------
  yes    | yes             | (n/a)         | reset_to_category   | yes
  yes    | no              | yes           | keep                | yes
  no     | yes             | (n/a)         | keep                | yes
  no     | no              | yes           | keep                | no
  yes    | no              | no            | reset_full          | yes
  no     | no              | no            | keep                | no

The `clearPendingAction` field of the decision object is informational
for Tier A merge with Issue #1 (which adds pending_action fields to
session). On refactor/03-family-reset alone, those fields don't exist
and the boolean is unused.

────────────────────────────────────────────────────────────────────
TIER B — HIGH (architecture / cost) — do these second
────────────────────────────────────────────────────────────────────

ISSUE #4 — Eliminate LLM Extractor (Marhale 2)
Branch: refactor/04-eliminate-extractor
Status: ✅ DONE — N/A on refactor/main (Path Y, snapshot strategy)

WHY OBSOLETE (2026-04-25):
The chat-session snapshot introduced `src/modules/llm-extractor.js`
(a gpt-4o-mini extractor module). After OPTION B clean reset (Q3
STEP 4), refactor/main does NOT carry that module — verified by
PHASE 1 audit: `ls src/modules/` returns no llm-extractor.js, and
the snapshot's enhancements are not being ported wholesale (Path Y
decision).

The user-language-note pattern from this issue's original step 4 is
still valuable copy. It will resurface when SYSTEM_PROMPT is
decomposed into prompts/ in Issue #13 (re-scoped) — preserved verbatim
in the original spec below.

[Original spec preserved below for reference]

PROBLEM:
gpt-4o-mini extractor + gpt-4.1-mini main = redundant. GPT-4.1-mini
handles typos/non-Latin natively. Adds 2-3s latency + extra cost for
~30% of turns.

REQUIREMENTS:
1. Remove the LLM extractor call entirely from product-state.js
2. Keep regex extraction (deterministic, fast, free) — this still runs
3. In Marhale 5 context build, inject regex result as a system hint:
   ```
   [PRE-EXTRACTED STATE FROM REGEX — may be incomplete or wrong;
    treat user message as ground truth]
   category: <value or "unknown">
   family: <value or "unknown — possible typo in user message">
   color: <value or "unknown">
   storage: <value or "unknown">
   region: <value or "unknown">
   sim: <value or "unknown">
   ```
4. Update SYSTEM_PROMPT — add this section near the top:
   ```
   USER LANGUAGE NOTE:
   Users may write in English, Arabic, Persian (Finglish or script),
   or mix scripts within a single message. Common patterns:
   - Typos: "iphon" / "ifon" = iPhone, "makbook" / "mecbook" = MacBook
   - Persian Finglish: "ای فون" = iPhone, "آیپد" = iPad,
     "مکبوک" = MacBook
   - Color terms:
     "meshki" / "siah" / "اسود" / "أسود" = black
     "sefid" / "abyad" / "ابيض" / "أبيض" = white
     "talayi" / "ذهبی" / "ذهبي" = gold
     "noghreyi" / "fizzi" / "فضي" = silver
     "abi" / "ازرق" / "أزرق" = blue
   - Storage: "256" / "256 giga" / "256 جیگ" = 256GB
   Resolve these silently. Do NOT ask the user to repeat or clarify
   unless genuinely ambiguous (e.g., user said "phone" with no model).
   ```
5. Remove gpt-4o-mini import/dependency if no longer used elsewhere
   (check ALL files)
6. Update README cost section:
   - Remove "$0.0003/turn extractor"
   - Update average-case from $0.0018 → ~$0.0015

ACCEPTANCE:
- Manual scenarios S4, S5 pass (typo + mixed script handled by main LLM)
- No regression on S1-S3 (greetings still work)
- Unit test: regex result correctly formatted as system hint
- Cost log shows reduced spend on typo-heavy turns
- Latency reduced by 2-3s on previously-extracted turns

────────────────────────────────────────────────────────────────────

ISSUE #5 — Wire intent.js into the agent pipeline
Branch: refactor/05-intent-classifier
Status: PENDING (RE-SCOPED 2026-04-25 per PHASE 1 finding)

RE-SCOPE NOTE (2026-04-25):
PHASE 1 audit found that `src/modules/intent.js` already exists on
refactor/main as a working regex-based intent classifier
(PRODUCT_INQUIRY / COMPARISON / GENERAL_QUESTION / SUPPORT). It is
wired into the legacy pipeline only (`response.js` + `chat.js`); the
agent path bypasses it. Issue #5 is therefore reduced from "create
new file" to "reuse existing module + wire into agent path + fill
gaps".

UPDATED REQUIREMENTS:
1. Read `src/modules/intent.js` (existing). Map current 4 intents to
   the 6 the agent path needs:
     shopping / policy / support / greeting / meta / unknown
2. Identify gaps and add what's missing:
   - greeting: not currently a legacy intent (handled inline in
     `response.js` via GREETING_PATTERN). Extract or reference.
   - meta: missing — add MET_PATTERNS for "who are you / are you a
     bot / are you AI" (EN/AR/FA).
   - shopping: closely matches existing PRODUCT_INQUIRY.
   - policy: closely matches existing GENERAL_QUESTION (filtered by
     STRONG_GENERAL_OVERRIDE).
3. Refactor `intent.js` so the agent pipeline can call it without
   pulling in legacy-pipeline-only logic. Likely cleanest: add
   `classifyForAgent(message): { intent, confidence }` exported
   alongside the existing `detectIntent`.
4. In `agent.js`: import `classifyForAgent`, run it BEFORE Marhale 4
   (preemptive Shopify search). Route as below.
5. Add unit tests covering EN / AR / FA inputs for each intent class
   in `tests/unit/intent.test.js`.

ROUTING in agent.js (after greeting/post-confirmation short-circuits,
before Marhale 4 preemptive search):
- intent === 'shopping' AND state.category exists → preemptive search
  (current behavior)
- intent === 'policy' OR 'support' → SKIP preemptive, go straight to
  Main LLM (knowledge block already has policies)
- intent === 'meta' → short-circuit with brief intro, localized:
  EN: "I'm alAsil's shopping assistant. I can help you find Apple
       products, check availability, and answer questions about
       warranty, payment, and delivery. What can I help you with?"
  AR / FA: equivalent translations
- intent === 'greeting' → handled by existing greeting short-circuit
- intent === 'unknown' → current behavior (let LLM decide)

UPDATED ACCEPTANCE:
- Manual scenarios S12, S13 pass (no Shopify call for policy/support)
- Unit tests for each intent class with EN/AR/FA examples
- Performance: classifyForAgent runs in <1ms (assert in test)
- Log {intent, confidence} for every turn to enable keyword tuning
- No regression in legacy pipeline (`detectIntent` still works for
  `response.js` and `chat.js`)

[Original spec preserved below for reference — keyword lists
intentionally retained as starting point for the EN/AR/FA expansion]

PROBLEM:
Preemptive Shopify search runs whenever category exists. Wastes calls
on policy/support questions like "return policy chand roozeh?".

REQUIREMENTS:
Add `src/intent-classifier.js`:
```js
function classifyIntent(message):
  'shopping' | 'policy' | 'support' | 'greeting' | 'meta' | 'unknown'
```

Use regex/keyword matching. NO LLM. Must be <1ms.

KEYWORDS (initial set — expand based on logs):

shopping:
  EN: price, cost, buy, purchase, want, looking for, available,
      stock, in stock, do you have, how much
  FA: qeymat, mikham, mishe, mojood, mojoode, dare, darin, chand,
      chand toman, befrushid
  AR: سعر, اشتري, ابي, موجود, عندكم, كم

policy:
  EN: return, returns, warranty, refund, shipping, delivery,
      exchange, policy, guarantee, how long
  FA: marjoo, marjooee, garanti, ضمانت, hamloonaql, hamloo
  AR: ضمان, ضمانة, ارجاع, استبدال, شحن, توصيل

support:
  EN: broken, not working, doesn't work, issue, problem, help,
      defective, faulty, fix, repair
  FA: kharab, kar nemikone, moshkel, eshkal, ta`mir, dorost koni
  AR: مشكلة, خراب, ما يشتغل, تصليح, عطل

greeting: handled by existing SC#1 (don't re-implement here)

meta:
  EN: who are you, what are you, what can you do, are you a bot,
      are you human, are you AI
  FA: ki hasti, chi hasti, robot, robati
  AR: من انت, هل انت روبوت

ROUTING in agent.js (after Marhale 3 short-circuits, before Marhale 4):
- intent === 'shopping' AND state.category exists → preemptive search
  (current behavior)
- intent === 'policy' OR 'support' → SKIP preemptive, go straight to
  Main LLM (knowledge block already has policies)
- intent === 'meta' → short-circuit with brief intro:
  "I'm alAsil's shopping assistant. I can help you find Apple products,
   check availability, and answer questions about warranty, payment,
   and delivery. What can I help you with?"
  (Localize to AR/FA based on detected language)
- intent === 'unknown' → current behavior (let LLM decide)

ACCEPTANCE:
- Manual scenarios S12, S13 pass (no Shopify call for policy/support)
- Unit tests for each intent class with EN/AR/FA examples
- Performance: classifyIntent runs in <1ms (assert in test)
- Log intent for every turn to enable keyword tuning

────────────────────────────────────────────────────────────────────
TIER C — MEDIUM (architecture cleanup)
────────────────────────────────────────────────────────────────────

ISSUE #6 — Remove FORBIDDEN_FIRST hack
Branch: refactor/06-tool-cleanup
Status: ✅ DONE — N/A on refactor/main (Path Y, snapshot strategy)

WHY OBSOLETE (2026-04-25):
The chat-session snapshot introduced a `FORBIDDEN_FIRST` symbol in
`src/tools/index.js` that registered tools nominally but redirected
their calls to findProduct. PHASE 1 audit confirmed no such symbol
exists on refactor/main: `grep -rn 'FORBIDDEN_FIRST' src/` returns
zero matches. Per Path Y (snapshot strategy), nothing to remove.

Tools currently registered in `tools/index.js` (all 10 are real, no
shadow redirects): findProduct, browseMenu, searchProducts,
filterCatalog, getAvailableOptions, getBySKU, getProductByTitle,
webFetch, verifyStock, saveCorrection.

The "rationalize tool surface" idea from this issue may still be
worth doing as a future task (e.g. trim tools the LLM rarely uses
based on `agent-stats.js` logs), but that's a separate scope and
not the FORBIDDEN_FIRST removal originally specified.

[Original spec preserved below for reference]

PROBLEM:
Currently registers browseMenu, searchProducts, filterCatalog,
getAvailableOptions — then secretly redirects to findProduct.
Confuses LLM mental model. Multi-turn behavior gets weird because
LLM "remembers" calling browseMenu but sees findProduct-shaped result.

REQUIREMENTS:
1. Remove from registered tool list passed to OpenAI:
   - browseMenu
   - searchProducts
   - filterCatalog
   - getAvailableOptions
2. Remove FORBIDDEN_FIRST redirect logic from tools/index.js
3. Keep ONLY these tools registered:
   - findProduct
   - verifyStock
   - webFetch
   - saveCorrection
4. Enrich findProduct's parameter schema so LLM can express browse-
   style intent natively. Add params:
   - `browse_mode: boolean` — when user is browsing, not searching
     for specific product
   - `filter_facets: object` — structured filters:
     { color?, storage?, price_range?, in_stock_only? }
   - `sort_by: 'relevance' | 'price_asc' | 'price_desc' | 'newest'`
5. Update verifyStock description in tool schema:
   "Use ONLY after findProduct has returned a specific product.
   Pass the exact product_id from a previous findProduct result.
   Do not invent or guess product IDs. If you don't have a
   product_id from a recent findProduct call, call findProduct
   first."
6. Update SYSTEM_PROMPT to reflect new tool list — remove any
   instructions referencing the removed tools

ACCEPTANCE:
- All previously-passing scenarios still pass
- Unit test: tool list passed to OpenAI excludes the 4 removed tools
- Unit test: findProduct accepts and uses new browse_mode/
  filter_facets params
- Manual: trigger a browse-style query ("show me iPhones") and verify
  LLM uses findProduct with browse_mode=true (not the removed tools)
- LLM logs no longer show calls to browseMenu etc.

────────────────────────────────────────────────────────────────────

ISSUE #7 — Replace content-based dedup with Telegram update_id
Branch: refactor/07-update-id-dedup

PROBLEM:
Gate 3 dedups by message content within 5s. Blocks legitimate
duplicate messages: user typing "yes" "yes" (confirming twice) gets
second message silently dropped. Conversation breaks.

REQUIREMENTS:
Replace content-based dedup with `update_id` tracking:

- Telegram guarantees unique `update_id` per webhook delivery
- Telegram retries use SAME update_id (so dedup-by-update_id catches
  true retries)
- User typing same content twice generates DIFFERENT update_ids (so
  legit duplicates pass through)

Implementation:
- Maintain `Map<update_id, timestamp>` in module scope
- On webhook receive, check if update_id is in map
  - If yes → skip processing (true Telegram retry)
  - If no → add to map, proceed
- Periodic cleanup: every 60s, remove entries older than 5min
  (Telegram never retries beyond 5min)
- Use `setInterval` with `unref()` so it doesn't prevent process exit

REMOVE the old content-based 5s check entirely.

ACCEPTANCE:
- Manual scenarios S15, S16 pass
- Unit test: same update_id twice → second skipped
- Unit test: same content with different update_ids → both processed
- Unit test: cleanup removes entries >5min old
- Memory bounded: simulate 10K updates → map size stays <2K after
  cleanup runs

────────────────────────────────────────────────────────────────────

ISSUE #8 — Soften SC#4 (auto-confirmation on count=1)
Branch: refactor/08-confirmation-threshold

PROBLEM:
Any count=1 result from findProduct triggers hard confirmation
("Just to confirm, looking for X?"). User browsing accessories with
1 result feels misled — they wanted to browse, not commit.

REQUIREMENTS:
Add `match_score` calculation in findProduct:
```js
match_score = (matchingTokens / totalQueryTokens) * weightedRelevance
```
Where matchingTokens = intersection of (tokenized query) and
(tokenized product title), normalized for stop words and order.

New SC#4 logic:
- Auto-confirm (current hard prompt) ONLY when EITHER:
  a) match_score >= 0.85, OR
  b) User message contains all major brand+family+storage tokens
     of the product title

Otherwise — emit SOFT prompt:
"I found this: [product title].

 Is this what you're looking for, or would you like to see other
 options?"

This gives user explicit "browse more" off-ramp.

The bot's pending_action should still be set to
'awaiting_confirmation' for both prompts (so SC#2 from Issue #1
works in either case).

ACCEPTANCE:
- Manual scenarios S21, S22 pass
- Unit test: high score (exact title match) → hard confirmation
- Unit test: low score (1 obscure result) → soft prompt
- Unit test: match_score calculation handles stop words correctly
- Unit test: match_score handles different word order

────────────────────────────────────────────────────────────────────
TIER D — MEDIUM (UX / performance)
────────────────────────────────────────────────────────────────────

ISSUE #9 — Reduce debounce + add typing indicator
Branch: refactor/09-debounce-typing

PROBLEM:
Debounce 2.5s feels broken. User thinks bot is dead. Mostly users
send 1 message and uselessly wait 2.5s.

REQUIREMENTS:
- Reduce debounce from 2.5s → 1s (in Gate 5)
- On every message received (after Gate 5 passes), immediately call
  Telegram `sendChatAction(chat_id, 'typing')`
- Refresh typing indicator every 4s while LLM is processing
  (Telegram auto-clears after 5s, so 4s ensures continuous indication)
- Implement as `setInterval` started before LLM call, cleared after
  reply sent (or on error)
- Wrap in try/finally to ensure interval is always cleared even on
  exceptions

ACCEPTANCE:
- Manual scenario S14 passes (rapid-fire still merges)
- Manual: typing indicator visible in Telegram during LLM processing
- Unit test: interval cleared on success, error, and timeout paths
- No memory leaks (intervals don't accumulate)

────────────────────────────────────────────────────────────────────

ISSUE #10 — Streaming-style response via editMessageText
Branch: refactor/10-streaming-feedback

PROBLEM:
Bot is silent for 2-5s, then dumps full reply. Feels broken.

REQUIREMENTS:
For turns hitting Main LLM (NOT short-circuits):

1. Immediately send placeholder (localize by detected user language):
   - EN: "🔍 Checking..."
   - AR: "🔍 جاري التحقق..."
   - FA: "🔍 در حال بررسی..."
2. Capture returned message_id
3. After LLM completes + post-processing done, call
   `editMessageText(chat_id, message_id, finalReply)`
4. If edit fails (e.g., message_id too old, network issue):
   - Log warning
   - Fall back to `sendMessage` with final reply
   - Try to delete the placeholder if possible (best-effort)

DO NOT use this for short-circuits (SC#1-#4) — they're <50ms,
placeholder would just flash.

ACCEPTANCE:
- Manual: shopping query shows placeholder → final reply (no flash)
- Manual: greeting (SC#1) shows immediate reply (no placeholder)
- Unit test: edit failure falls back to sendMessage
- Logs: track placeholder→edit success rate (target: >95%)

────────────────────────────────────────────────────────────────────

ISSUE #11 — Race-condition recovery for failed sends
Branch: refactor/11-failed-send-recovery

PROBLEM:
When sendMessage fails, current code saves user msg but not bot
reply. Next turn LLM sees user's question with no answer → confused,
may repeat the failed reply or contradict itself.

REQUIREMENTS:
When sendMessage fails (after retries):
1. Save user message to history (current behavior — keep)
2. Set on session: `last_send_failed: true`
3. On NEXT turn, when building Marhale 5 context, inject synthetic
   system message:
   ```
   {
     role: 'system',
     content: '[NOTE: Previous reply failed to send to user. They
     may resend or rephrase their question. Reacknowledge naturally
     without repeating the lost reply verbatim — they did not see it.]'
   }
   ```
4. After processing that next turn (whether or not LLM hit), clear
   `last_send_failed` flag
5. Log all failed sends with full context for ops review

ACCEPTANCE:
- Manual scenario S18 passes (mock failed send → next turn natural
  reacknowledgment)
- Unit test: last_send_failed correctly set on failure
- Unit test: synthetic system message injected on next turn only
- Unit test: flag cleared after one consumption (not persistent)

────────────────────────────────────────────────────────────────────
TIER E — LOW (optimization — defer if blocked)
────────────────────────────────────────────────────────────────────

ISSUE #12 — OpenAI prompt caching
Branch: refactor/12-prompt-caching

PROBLEM:
Currently messages array order may not maximize OpenAI's automatic
prompt cache (which keys on prefix stability).

REQUIREMENTS:
Restructure messages array order:
1. SYSTEM_PROMPT (large, stable across all turns) → FIRST
2. Knowledge block (large, stable per category) → SECOND
3. Conversation history (variable) → THIRD
4. Current user message → LAST

Verify cache effectiveness:
- Log `usage.prompt_tokens_details.cached_tokens` from OpenAI
  responses
- Add to logs/agent.jsonl entry: `cached_tokens`,
  `cache_hit_rate = cached / total_input`
- Target: >50% cache hit rate by turn 3 of any session

If not hitting target, debug:
- Check that SYSTEM_PROMPT is byte-identical across turns
  (no timestamps, no random ordering)
- Check that knowledge block for same category is byte-identical
- OpenAI cache requires ≥1024 token prefix — verify size

ACCEPTANCE:
- Manual scenario S24 passes
- Cached_tokens visible in logs
- Cache hit rate >50% on multi-turn shopping sessions
- No behavior change (purely optimization)

────────────────────────────────────────────────────────────────────

ISSUE #13 — Extract SYSTEM_PROMPT to prompts/ folder + modular composition
Branch: refactor/13-modular-prompt
Status: PENDING (RE-SCOPED 2026-04-25 per PHASE 1 finding)

RE-SCOPE NOTE (2026-04-25):
PHASE 1 audit found that the knowledge files in `config/` are
ALREADY modular — `knowledge.js` loads 6 separate `.md` files
(custom_answers, policies, apple_specs, apple_current_lineup,
payment_methods, catalog_taxonomy). The actual monolith that needs
extracting is the **340-line `SYSTEM_PROMPT` constant in
`agent.js`**.

Issue #13 is therefore re-scoped from "modular knowledge loading"
to "extract SYSTEM_PROMPT to prompts/ folder + modular composition".
This re-scope also benefits Issue #12 (prompt caching): OpenAI
prompt caching requires byte-identical prefix, which is brittle
when SYSTEM_PROMPT is built via in-code string concatenation.
File-based prompts make the cache key stable.

UPDATED REQUIREMENTS:
1. Create `src/prompts/` folder with:
   - `system-base.md`     — universal rules, shared across categories
   - `system-iphone.md`   — iPhone-specific instructions
   - `system-mac.md`      — Mac-specific
   - `system-ipad.md`     — iPad-specific
   - `system-airpods.md`  — AirPods-specific
   - `system-watch.md`    — Apple Watch-specific
   - `system-fragments.md` — re-usable snippets: USER LANGUAGE NOTE
     (from Issue #4 original spec), 8-step flow, OOS handling,
     tool-routing rules
2. Add `src/prompts/index.js` exporting:
   - `loadPrompts()` — reads all `.md` files at startup; mirrors
     `knowledge.js` hot-reload pattern so editing a `.md` file does
     not require server restart.
   - `buildSystemPrompt({ category, mode? })` — composes
     base + category-specific + relevant fragments. Returns string.
3. Replace the 340-line `SYSTEM_PROMPT` constant in `agent.js` with
   a call to `buildSystemPrompt(state.category)`.
4. Verify byte-identical output for same `category` across calls
   (test the cache prep — same input must produce the same string).
5. Token reduction observable on category-specific turns (iPhone
   turn doesn't load Mac fragments).

UPDATED ACCEPTANCE:
- `agent.js` no longer contains the SYSTEM_PROMPT constant
- All previously passing scenarios still pass
- Token reduction logged: input_tokens before/after on category-
  specific turns (target 30-40% reduction)
- Unit test: same `category` → byte-identical `buildSystemPrompt`
  output (cache prep)
- Unit test: switching `category` between turns produces a different
  but valid prompt
- Manual: edit a `.md` file in `prompts/` → next agent turn uses
  the edited version (no server restart)

[Original spec preserved below for reference — its category-file
breakdown maps roughly 1:1 to `prompts/` category files since
both schemes split by category]

PROBLEM:
Monolithic knowledge file always loaded. iPhone turn carries
MacBook/iPad/Watch knowledge → wasted tokens.

REQUIREMENTS:
Split current knowledge file into:
- `knowledge/general.md` — brand voice, intro, store info
  (always loaded)
- `knowledge/policies.md` — return, warranty, shipping
  (always loaded)
- `knowledge/payments.md` — payment methods, installments
  (always loaded)
- `knowledge/iphone.md` — iPhone lineup, specs, common questions
- `knowledge/mac.md` — Mac lineup, specs
- `knowledge/ipad.md` — iPad lineup, specs
- `knowledge/airpods.md` — AirPods lineup, specs
- `knowledge/watch.md` — Apple Watch lineup, specs
- `knowledge/lineup-summary.md` — 1-line per category
  (for unknown-category turns)

Loading logic in agent.js:
- ALWAYS load: general, policies, payments
- IF state.category known → load that category file
- IF state.category unknown → load lineup-summary instead

Build a single knowledge_block string by concatenating loaded files
with clear `## SECTION:` headers.

ACCEPTANCE:
- Manual scenario S25 passes (iPhone turn → no Mac knowledge in
  context — verifiable in logs)
- Token reduction: log input_tokens before/after, target 30-40%
  reduction on category-specific turns
- No behavior regression — bot still answers cross-category
  questions correctly when category is unknown
- Unit test: correct files loaded for each category

────────────────────────────────────────────────────────────────────

ISSUE #14 — History window 6 → 12 + summarization
Branch: refactor/14-history-summarization

PROBLEM:
6-message window too short. User references something 8 turns back →
LLM doesn't see it.

REQUIREMENTS:
- Sliding window: last 12 messages (was 6)
- When history.length > 12:
  - Take messages 0 to (length - 12) — older half
  - Summarize via gpt-4o-mini into single system message:
    `[Earlier conversation summary: <2-3 sentence summary
    capturing: products discussed, user preferences stated, decisions
    made>]`
  - Replace originals with this summary message
  - Cache summary on session as `history_summary`
- Run summarization async (don't block current response):
  - Generate summary in background
  - Apply on NEXT turn's context build
  - Current turn uses old behavior (last 12 raw)
- Re-summarize when summary message + new messages exceed 12 again
  (rolling)

ACCEPTANCE:
- Manual scenario S23 passes (15-turn conversation, context preserved)
- Unit test: summarization triggered at correct threshold
- Unit test: summary applied on subsequent turns
- Unit test: re-summarization works (multiple rounds)
- Cost: summarization adds ~$0.0001/turn (acceptable)

────────────────────────────────────────────────────────────────────

ISSUE #15 — Shopify webhook for cache invalidation
Branch: refactor/15-shopify-webhooks

PROBLEM:
5min stale-while-revalidate means OOS products show "available" for
up to 5min. Customer clicks → frustration.

REQUIREMENTS:
1. Add webhook endpoint: `POST /webhook/shopify/<secret>`
2. Verify HMAC signature (Shopify standard — use
   `X-Shopify-Hmac-Sha256` header)
3. Subscribe to topics (via Shopify Admin API or admin UI):
   - `products/update`
   - `products/create`
   - `products/delete`
   - `inventory_levels/update`
4. Handler logic:
   - products/create → add to cache
   - products/update → invalidate that product's cache entry,
     trigger re-fetch
   - products/delete → remove from cache
   - inventory_levels/update → re-fetch availability for that
     variant's parent product
5. Keep 5min stale-while-revalidate as FALLBACK for missed webhooks
6. Log all webhook receives + actions

DOCUMENTATION:
- Add `docs/SHOPIFY_WEBHOOKS.md` with setup steps:
  - How to register webhooks via Shopify admin
  - Required env vars (SHOPIFY_WEBHOOK_SECRET)
  - Health check endpoint to verify subscription

ACCEPTANCE:
- Webhook signature verification rejects invalid HMAC
- Manual: update product in Shopify admin → cache invalidated
  within 1s
- Manual: change inventory to 0 → next findProduct shows OOS
  immediately
- Unit test: HMAC validation
- Unit test: each topic dispatches to correct handler

────────────────────────────────────────────────────────────────────

ISSUE #16 — Corrections feedback loop
Branch: refactor/16-corrections-review

PROBLEM:
`logs/corrections.jsonl` collected but never reviewed systematically.
No mechanism to feed insights back into prompts/regex.

REQUIREMENTS:
Add `scripts/review-corrections.js`:

INPUT: `logs/corrections.jsonl` (one JSON per line)

PROCESSING:
- Parse all entries
- Group by:
  - Category (iphone, mac, etc.)
  - Pattern type (regex_miss, hallucination, wrong_product,
    wrong_price, oos_misreport, other)
  - Frequency

OUTPUT: `logs/corrections-report-YYYY-MM-DD.md` with sections:
- Summary stats (total corrections, top categories, top patterns)
- Top 10 most-corrected patterns with example messages
- Suggested regex additions (if regex_miss is common)
- Suggested SYSTEM_PROMPT amendments (if hallucination is common)
- Suggested knowledge file updates (if wrong_price/wrong_spec
  is common)

DOCUMENTATION in README:
- `npm run corrections:review` → generates report
- Recommended weekly cadence
- How to act on suggestions (commit prompt updates as
  `chore: prompt update from <date> corrections review`)

ACCEPTANCE:
- Script runs without error on existing corrections.jsonl
- Report generated in correct location
- Report contains all required sections
- Unit test: grouping logic correct
- Unit test: pattern type classification correct
- Documented in README

═══════════════════════════════════════════════════════════════════════
PHASE 3 — MANUAL TEST SCENARIOS (run after EACH issue)
═══════════════════════════════════════════════════════════════════════

Save to `docs/MANUAL_TESTS.md`. Run all relevant scenarios after
each issue completion. Mark issue # next to scenarios it specifically
tests.

S1.  Greeting EN: "hi" → 5-item welcome
S2.  Greeting AR: "السلام" → 5-item welcome (in Arabic)
S3.  Greeting FA: "salam" → 5-item welcome
S4.  Typo EN: "iphon 15 pro" → resolves to iPhone 15 Pro
S5.  Mixed script: "ای فون 15 meshki" → iPhone 15 Black
S6.  Family pivot: "iPhone 15" then "instead show me 16" → context
     reset
S7.  Family continuation: "iPhone 15" then "compare with 14" →
     context preserved [tests #3]
S8.  Confirmation flow: bot asks "Just to confirm..." → user "yes"
     → "available, want link?" [tests #1]
S9.  Confirmation flow AR: same as S8 but bot replies in Arabic
     → must still trigger SC#2 [tests #1]
S10. Link flow: bot asks "Send link?" → user "yes" → URL with UTM
     [tests #1]
S11. OOS handling: search for known-OOS product → graceful message
S12. Policy question: "what is your return policy?" → no Shopify call
     [tests #5]
S13. Support question: "my AirPods are not connecting" → no Shopify
     call [tests #5]
S14. Rapid fire: send 3 messages in 800ms → debounce merges into 1
     turn [tests #9]
S15. Same content twice: "yes" "yes" with different update_ids → both
     processed [tests #7]
S16. Telegram retry: same update_id received twice → second skipped
     [tests #7]
S17. /reset → clean slate, no welcome
S18. Failed send simulation: mock Telegram API failure → next turn
     bot reacknowledges naturally [tests #11]
S19. Hallucinated URL: force LLM to emit fake URL → must be stripped
     not substituted [tests #2]
S20. Near-miss URL: LLM emits "iPhone 15 Pro Max" URL when context is
     "iPhone 15 Pro" → must be stripped [tests #2]
S21. Single result low confidence: search returns 1 obscure
     accessory → soft prompt not hard confirmation [tests #8]
S22. Single result high confidence: exact title match → hard
     confirmation [tests #8]
S23. Long conversation: 15 turns → summarization kicks in, context
     preserved [tests #14]
S24. Cache hit rate: run 5 similar turns → log cached_tokens, verify
     >50% by turn 3 [tests #12]
S25. Category-specific knowledge: iPhone turn → MacBook knowledge NOT
     in context [tests #13]

═══════════════════════════════════════════════════════════════════════
PHASE 4 — WORKFLOW PER ISSUE (follow EXACTLY for each of the 16)
═══════════════════════════════════════════════════════════════════════

For EACH issue, in order:

STEP 1 — RECONNAISSANCE
- Re-read `docs/REFACTOR_PLAN.md` for the issue spec (do not trust
  context window memory)
- Re-read the relevant code files
- Check `docs/REFACTOR_PLAN.md` "Discovered During Refactor" section
  for any notes from previous issues that may affect this one

STEP 2 — PLAN
- Create the branch: `git checkout -b refactor/NN-<slug>`
- Propose implementation plan in plain English (3-8 bullets):
  - Files to change
  - New/changed data shapes
  - Edge cases considered
  - Tests to write
  - Migration concerns for live sessions (if any state shape change)
- WAIT for my explicit approval. Do not proceed without it.

STEP 3 — IMPLEMENT
- Write the code
- Add unit tests (Vitest)
- Add JSDoc comments where intent isn't obvious
- Persian comments are OK in code if they help the team
- **Mid-step deviations from the approved plan must STOP and ASK before
  implementing, not implement-then-explain.** If you notice tension during
  implementation (test approach, library choice, file organization,
  function signature, anything the plan specified) → STOP, frame the
  tension and your proposed alternative, WAIT for explicit approval, then
  implement. Unilateral changes erode the contract; small deviations
  stack up. (Process correction added 2026-04-25 after Issue #2.)

STEP 4 — VERIFY
- Run `npm test` — show me the output
- Run the relevant manual scenarios from PHASE 3 (describe what you'd
  expect to see — I'll do live testing)
- Show me `git diff`

STEP 5 — REVIEW
- WAIT for my approval before merging
- After approval:
  - Commit with message format: `refactor(NN): <one-line summary>`
  - Update `docs/REFACTOR_PLAN.md`:
    - Mark issue ✅ DONE
    - Add date
    - Add commit hash
    - Note any follow-up issues discovered (under a "Discovered
      During Refactor" section)

STEP 6 — MOVE ON
- Confirm with me before starting the next issue
- Do not auto-start the next issue

═══════════════════════════════════════════════════════════════════════
DEPLOYMENT PROTOCOL
═══════════════════════════════════════════════════════════════════════

Production stays UNTOUCHED on current `main` until explicit deploy.

Branch protocol:
- All refactor work on `refactor/NN-<slug>` branches
- Each completed issue merges into `refactor/main` (NOT origin/main)
- `refactor/main` never auto-deploys

Tier A Merge Follow-up Commits (after Issues #1, #2, #3 are merged
to refactor/main, BEFORE deploying to staging):

1. Replace Issue #1's `shouldClearForCategoryChange(session)` predicate
   with Issue #3's `applyResetDecision` integration. In handleAgent:
   - Remove the standalone `shouldClearForCategoryChange(session)` call
   - Where `decision.clearPendingAction === true` (returned from
     decideStateReset in Issue #3's flow), call
     `clearPendingAction(session)` (Issue #1's helper)
   - This unifies pending_action lifecycle with the rest of state reset
     under one decision matrix
   - Estimate: ~5 lines, 1 commit

2. Restore vitest.config.js coverage threshold settings: Issue #1's
   threshold-to-0 fix lives on its branch. Cherry-pick to refactor/main
   during merge OR accept as part of merge resolution. Either path
   leaves the same final state. Just make sure it lands.

3. Verify combined test suite still passes on refactor/main after merge:
   - Issue #1: 81 tests
   - Issue #2: 43 tests
   - Issue #3: 69 tests
   - Combined target: ~193 tests, all green

4. Update docs/REFACTOR_PLAN.md "Tier A Status" to ✅ DONE with the
   merge commit hashes recorded.

Deployment cadence:
- Tier A (Issues 1-3) complete + tested → merge `refactor/main` into
  `staging` → 48h soak → prod deploy
- Tier B (Issues 4-5) complete + tested → repeat
- Tier C (Issues 6-8) → repeat
- Tier D (Issues 9-11) → repeat
- Tier E (Issues 12-16) → can be batched, lower risk

If no staging environment exists:
- STOP and tell me. We'll set up a staging Telegram bot (separate
  token, same Shopify dev store) before any deploy.
- DO NOT deploy directly from refactor branches to prod. Ever.

Hotfix policy during refactor:
- If prod breaks during refactor period (unrelated bug), hotfix on
  a `hotfix/*` branch off origin/main
- Then `git rebase origin/main` on `refactor/main` to absorb the
  hotfix
- Tell me before doing this — coordination matters

Emergency rollback:
- Each prod deploy must be tagged: `prod-YYYY-MM-DD-tier-N`
- Rollback = `git revert <merge-commit>` and redeploy
- Document rollback steps in `docs/DEPLOYMENT.md`

═══════════════════════════════════════════════════════════════════════
GROUND RULES (apply throughout)
═══════════════════════════════════════════════════════════════════════

1. ONE issue per branch. No batching.
2. NO PR without tests. If you can't write a test for it, ask why.
3. NO drive-by refactors. If you spot something else broken, log it
   in `docs/REFACTOR_PLAN.md` under "Discovered During Refactor" —
   do NOT fix it inline.
4. Preserve all existing behavior except what the issue explicitly
   changes.
5. State shape changes require migration notes in commit message +
   plan doc.
6. If you're unsure, ASK. Do not guess. Especially about:
   - Which file owns a piece of logic
   - Whether a behavior is intentional or a bug
   - Whether to add a dependency
7. If the production bot is currently running on this codebase,
   flag any issue that has deployment risk and propose a staging
   test plan.
8. Persian/Arabic comments OK in code where they clarify intent for
   the team.
9. ALWAYS re-read `docs/REFACTOR_PLAN.md` and `CLAUDE.md` at start
   of each issue. Disk is source of truth.

═══════════════════════════════════════════════════════════════════════
START NOW
═══════════════════════════════════════════════════════════════════════

1. Save this entire message to `docs/REFACTOR_PLAN.md` and `CLAUDE.md`
2. Show me `ls -la` and `wc -l` for both files (must be 700+ lines)
3. Begin PHASE 0 (housekeeping). Show me each step's output.
4. WAIT for my responses to the housekeeping questions (dirty tree
   classification, origin/main pull review, Vitest config approval).
5. Then PHASE 1 (codebase summary).
6. Then WAIT for my confirmation before starting Issue #1.

DO NOT start Issue #1 work until I explicitly say "start issue 1".

═══════════════════════════════════════════════════════════════════════
DISCOVERED DURING REFACTOR
═══════════════════════════════════════════════════════════════════════

(Section reserved for issues found mid-refactor. Each entry must
include: date, issue ID, severity, file path, brief description,
proposed handling.)

### Shell injection vector in remote() helper (provisioning scripts)

bin/lib/staging-common.sh's remote() helper passes commands as a single
shell-interpolated string. Currently safe because all interpolated values
are hardcoded constants (paths, domain names, etc.). If user-supplied
values are ever added to a remote() call, this becomes a shell injection
vector. The phase_deploy function in provision-staging.sh demonstrates
the safer alternative (heredoc + argv passing).

**Status:** Currently safe; document for future work.
**Action:** Switch to argv-style if user input is introduced. Consider
refactoring all remote() callers to argv style as a future cleanup.

### Silent failure in env phase merge pipeline (BSD sed + bash local exit-code masking)

The original `phase_env` in `bin/provision-staging.sh` chained
`printf | awk | sed` to filter prod env and substitute domain references.
Two compounding bugs caused the entire prod-env merge to silently fail
when run on macOS:

1. **BSD sed regex incompatibility.** The substitution
   `sed -E 's|(^|[^A-Za-z0-9.-])bot\.useddevice\.ae|...'` errored on
   macOS BSD sed with "parentheses not balanced" (BSD sed -E is more
   pedantic about start-of-line alternations in `(^|[^...])` groups
   than GNU sed). Pipeline stdout was empty when sed failed.

2. **Bash command-substitution swallows errexit.** The capture
   `staging_env=$(_build_staging_env ...)` runs in a subshell that does
   NOT inherit `errexit` by default. The awk-pipe-sed failure inside
   the function returned non-zero, but the function continued to its
   trailing `printf` calls (which exit 0), so the function ended with
   exit 0 and `set -e` saw nothing to abort on. No
   `|| { err ...; return 1; }` was present on the capture line.

**Symptom:** env phase reported `ok ".env written."` while the staging
.env contained ONLY the header comment block + the three trailing
override lines (NODE_ENV, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET).
The entire prod-env body (filtered + substituted) was missing.

**Fix:** replaced sed substitution with portable awk gsub (placeholder
swap to avoid double-replacement); added explicit
`|| { err ...; return 1; }` on the staging_env capture; audited all
other `=$(...)` captures in the script for similar gaps (none found —
all critical captures already had explicit handlers).

**Status:** Fixed. Bot would have crashed on first agent call due to
missing OPENAI_API_KEY rather than silently corrupting prod data, so
impact was bounded to staging unavailability — no prod blast radius.

**Related broader concern (not addressed in this fix):** bash
command-substitution doesn't inherit errexit by default. Setting
`shopt -s inherit_errexit` at the top of the script would prevent this
class of bug at the framework level. Not done here to keep change
scope-limited; consider as a future hardening sweep across all bash
scripts in `bin/`.

**Operational consequence (one-time):** a staging Telegram bot token
and webhook secret were briefly visible in the operator's terminal
(via `head -25` on the half-built `.env`) during diagnosis of this bug.
Treated as compromised and rotated as part of the env --rotate re-run.

═══════════════════════════════════════════════════════════════════════
ISSUE STATUS TABLE
═══════════════════════════════════════════════════════════════════════

| #   | Title                                          | Tier | Status   | Branch                              | Date | Commit |
| --- | ---------------------------------------------- | ---- | -------- | ----------------------------------- | ---- | ------ |
| 1   | State flags for short-circuits                 | A    | PENDING  | refactor/01-state-flags             | -    | -      |
| 2   | URL validation hardening                       | A    | PENDING  | refactor/02-url-validation          | -    | -      |
| 3   | Family-change reset precision                  | A    | PENDING  | refactor/03-family-reset-precision  | -    | -      |
| 4   | Eliminate LLM Extractor                        | B    | PENDING  | refactor/04-eliminate-extractor     | -    | -      |
| 5   | Intent classifier before preemptive search     | B    | PENDING  | refactor/05-intent-classifier       | -    | -      |
| 6   | Remove FORBIDDEN_FIRST hack                    | C    | PENDING  | refactor/06-tool-cleanup            | -    | -      |
| 7   | update_id-based dedup                          | C    | PENDING  | refactor/07-update-id-dedup         | -    | -      |
| 8   | Soften SC#4 (count=1 confirmation)             | C    | PENDING  | refactor/08-confirmation-threshold  | -    | -      |
| 9   | Reduce debounce + typing indicator             | D    | PENDING  | refactor/09-debounce-typing         | -    | -      |
| 10  | Streaming-style response (editMessageText)     | D    | PENDING  | refactor/10-streaming-feedback      | -    | -      |
| 11  | Failed-send recovery                           | D    | PENDING  | refactor/11-failed-send-recovery    | -    | -      |
| 12  | OpenAI prompt caching                          | E    | PENDING  | refactor/12-prompt-caching          | -    | -      |
| 13  | Modular knowledge loading                      | E    | PENDING  | refactor/13-modular-knowledge       | -    | -      |
| 14  | History summarization (12-msg window)          | E    | PENDING  | refactor/14-history-summarization   | -    | -      |
| 15  | Shopify webhook cache invalidation             | E    | PENDING  | refactor/15-shopify-webhooks        | -    | -      |
| 16  | Corrections feedback loop script               | E    | PENDING  | refactor/16-corrections-review      | -    | -      |
