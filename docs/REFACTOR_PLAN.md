# alAsil AI Bot Refactor — Complete Plan

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

PROBLEM:
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

PROBLEM:
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
Branch: refactor/03-family-reset-precision

PROBLEM:
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

ACCEPTANCE:
- Manual scenarios S6, S7 pass
- Unit test: iPhone 15 → iPhone 16 (no pivot) → storage/color preserved
- Unit test: iPhone 15 → "instead show me 16" → full reset
- Unit test: iPhone 15 → MacBook → full reset (category change)
- Unit test: iPhone 15 64GB Black → iPhone 16 → state has 64GB Black
  preserved, family updated

────────────────────────────────────────────────────────────────────
TIER B — HIGH (architecture / cost) — do these second
────────────────────────────────────────────────────────────────────

ISSUE #4 — Eliminate LLM Extractor (Marhale 2)
Branch: refactor/04-eliminate-extractor

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

ISSUE #5 — Intent classifier before preemptive Shopify search
Branch: refactor/05-intent-classifier

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

ISSUE #13 — Modular knowledge loading
Branch: refactor/13-modular-knowledge

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
