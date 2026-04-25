# alAsil AI Bot — Codebase Summary (PHASE 1)

Read fresh from `refactor/main` HEAD = `8328023` on 2026-04-25.
This summary describes the codebase **as it stands now**, not as the chat-session snapshot left it. Where the snapshot diverges from main, **disk wins** and the discrepancy is flagged.

---

## 1. Architecture Flow

A Telegram message follows this path:

1. Customer text → POST `/webhook/telegram/:secret` ([src/routes/telegram.js](src/routes/telegram.js))
2. **Webhook gate**: secret check → `res.json({ok:true})` IMMEDIATELY (Telegram ack), then process async
3. **Per-session in-memory dedup** (5s text-key) and **debouncer** (2.5s, merges rapid-fire fragments into one turn)
4. After debounce flush → `processBufferedTurn` reads session via `getSession(sessionId)` from Redis (or in-memory fallback) in [context.js](src/modules/context.js)
5. **Pipeline split on `config.USE_AGENT`**:
   - **Agent path** (`USE_AGENT=true`, default OFF) → `runAgent()` in [agent.js](src/modules/agent.js): builds system prompt + knowledge block + corrections block + focus context, runs an OpenAI tool-calling loop (max 5 iterations) over 10 catalog tools, post-processes (strip markdown/URLs/emojis), returns text + product list.
   - **Legacy path** (`USE_AGENT=false`) → `normalize` → `detectIntent` (4 regex-based intents) → `extractEntities` → `mergeProfile` → `buildResponse` ([response.js](src/modules/response.js)) which routes through `productInquiryPath` / `comparisonPath` / `generalQuestionPath` / `supportPath`, calling `phraseAnswer` ([llm.js](src/modules/llm.js)) for the final LLM-generated text.
6. State written back to Redis/in-memory; `sendMessage` ships text to Telegram. **Save happens BEFORE send** in both paths (a known gap — see anomalies §8).
7. Catalog: stale-while-revalidate cache in [catalog.js](src/modules/catalog.js), 5-min TTL, Admin API preferred (richer per-location inventory + metafields + collections), Storefront fallback. Auto-rebuilds `config/catalog_taxonomy.md` when SKU count changes.

---

## 2. Tech Stack Inventory

| Component | Package | Version |
|---|---|---|
| Node | engine | `>=18.0.0` |
| Module system | `"type": "module"` | ESM only |
| HTTP server | `express` | ^4.19.2 + `helmet` ^7, `cors` ^2.8, `express-rate-limit` ^7 |
| OpenAI SDK | `openai` | ^4.68.0 (default `gpt-4o-mini`, override via `AGENT_MODEL`) |
| Shopify clients | bare `fetch` + GraphQL | Storefront `2024-01`, Admin same — **no SDK** |
| Telegram client | bare `fetch` wrappers | [src/channels/telegram.js](src/channels/telegram.js) — **no library** |
| Session store | `redis` ^4.7 | with in-memory fallback when REDIS_URL is empty/default |
| DB pool | `pg` ^8.12 | **declared but unused** (see anomalies §8) |
| Logger | `pino` ^9.4 + `pino-pretty` | file in prod (`logs/app.log`), console in dev |
| Validation | `zod` ^3.23 | env config + `/chat` schema |
| ID generation | `uuid` ^10.0.0 | **moderate vuln <14** (GHSA-w5hq-g745-h8pq) |
| Test runner | `vitest` ^4.1.5 | added in PHASE 0 STEP 4, not yet used |

---

## 3. Session State

- **Storage**: Redis-first via `createClient(REDIS_URL)`, automatic in-memory fallback (`Map` keyed by `ai-support:session:<id>`) when Redis is unavailable. TTL = `SESSION_TTL_SECONDS` (default 1800s = 30 min).
- **Session-ID format**: `tg:<chat_id>:<thread_id|'general'>` for Telegram; UUID for `/chat` HTTP API.
- **`emptyState()` shape** ([context.js:56](src/modules/context.js)):
  ```js
  { turns, intent, language: 'en', profile: {}, missing: [],
    last_question, asked_fields: [], history: [], updated_at }
  ```
- **Agent path additionally writes**: `last_products` (cap 4), `focus` (category/model_key/family/variant + `ts`), `muted` (set by `/pause`).
- **History**: appended via `appendHistory()`, capped at 20 turns, each entry truncated to 400 chars. The agent passes only the last 6 turns into the prompt.
- **Persisted vs ephemeral**:
  - Persisted to Redis (or memory): full session state above.
  - Ephemeral (process-local Maps in `routes/telegram.js`): `_dedup` (5s text-dedup), `_pending` (debouncer state), `botInfo` (cached `getMe`).
  - File-based logs: `logs/agent.jsonl` (one row/turn) and `logs/corrections.jsonl` (append-only, soft-delete tombstones).

---

## 4. Feature Flags / Modes

From [src/config.js](src/config.js) (zod-validated, frozen):

| Var | Default (config.js) | Default (.env.example) | Purpose |
|---|---|---|---|
| `USE_AGENT` | `false` | `false` | Toggle legacy regex pipeline ↔ LLM tool-calling agent |
| `AGENT_MAX_ITERATIONS` | `5` | `5` | Max tool-call rounds before forced final answer |
| `AGENT_MODEL` | `''` (→ `OPENAI_MODEL`) | `''` | Override model for agent only |
| `AGENT_MAX_CONCURRENT` | `5` | **`10`** | OpenAI gate; **mismatch** between code and example |
| `AGENT_MAX_RETRIES` | `5` | **`3`** | Retry count on 429/5xx; **mismatch** |
| `FEATURE_LIVE_SEARCH` | `true` | `true` | Legacy pipeline live Shopify query (vs cached only) |
| `TELEGRAM_DEBOUNCE_MS` | (env, default 2500) | `2500` | Debouncer window for rapid-fire messages |
| `SHOPIFY_CACHE_TTL_SECONDS` | `300` | `300` | Catalog stale-while-revalidate window |
| `SHOPIFY_CATALOG_MAX` | `1000` | **`5000`** | Max products to fetch; **mismatch** |
| `DASHBOARD_SECRET` | (env) | `''` | Optional gate for `/dashboard` |
| `URL_BASE_PATH` / `PASSENGER_BASE_URI` | (env) | — | Sub-URI mount (cPanel Passenger) |
| `TELEGRAM_ADMIN_USERS` | (env, parsed → Set) | `7866231058` | Admin Telegram user IDs |

**Feature-flag philosophy**: `USE_AGENT=false` is the production default. The agent path is an opt-in pipeline; if it throws, [routes/telegram.js:280](src/routes/telegram.js) catches and **falls back to legacy** for that turn.

---

## 5. Existing Test Coverage

**Zero.** `find . -name "*.test.js" -o -name "*.spec.js"` returns no results (excluding the empty `tests/setup.js` we just placed).

`scripts/` contains plenty of test-like utilities (`scenario-tests.js`, `eval-agent.js`, `test-formatting.js`, `test-load.js`, `test-tools.js`, `test-disagreement*.js`, `test-lang.js`, `test-limiter.js`, `real-scenarios.js`) but they're standalone CLI scripts run manually, not Vitest tests. They could become fixtures in `tests/integration/`.

We start at **0% covered, 0 test files**.

---

## 6. Knowledge Files

Knowledge is **already modular at the file level**:

| File | Loaded by | Source of truth |
|---|---|---|
| [config/custom_answers.md](config/custom_answers.md) | knowledge.js | hand-curated, highest priority |
| [config/policies.md](config/policies.md) | knowledge.js | hand-curated store policies |
| [config/apple_specs.md](config/apple_specs.md) | knowledge.js | hand-curated Apple product specs |
| [config/apple_current_lineup.md](config/apple_current_lineup.md) | knowledge.js | **auto-synced** from apple.com/ae via `scripts/sync-apple.js` (in `.gitignore`) |
| [config/payment_methods.md](config/payment_methods.md) | knowledge.js | hand-curated Tabby/Tamara/COD rules |
| [config/catalog_taxonomy.md](config/catalog_taxonomy.md) | knowledge.js | **auto-generated** from Shopify by `scripts/build-taxonomy.js`, rebuilds on catalog SKU-count change |

`knowledgeBlock()` in [knowledge.js:44](src/modules/knowledge.js) concatenates all 6 with section headers and is injected as a single `system` message into both pipelines.

**System prompts that are NOT modular (still monolithic):**
- [agent.js:30-373](src/modules/agent.js) — `SYSTEM_PROMPT` is ~340 inline lines covering rules, flow, formatting, link policy, language policy, etc.
- [llm.js:9-184](src/modules/llm.js) — `BASE_PROMPT` is ~175 inline lines for the legacy pipeline.
- [correction-generator.js:18-28](src/modules/correction-generator.js) — small focused prompt.

If Issue #13 is "modular knowledge", knowledge files are already done; the gap is the agent's monolithic SYSTEM_PROMPT (see Open Questions §10).

---

## 7. File-to-Issue Mapping (Updated for refactor/main reality)

The chat-session snapshot held in-flight refactor work that was deliberately left behind by the OPTION B clean reset. Several issues assumed snapshot-state file paths that **do not exist on refactor/main**. Updated mapping:

| Issue | Original assumption | Reality on refactor/main | Files actually touched |
|---|---|---|---|
| **#1 — State flags** | Modify `product-state.js` | **File doesn't exist** — issue becomes "create state machine + integrate" | `src/modules/product-state.js` (new), `src/modules/agent.js`, `src/routes/telegram.js`, `src/modules/context.js` |
| **#2 — URL validation** | Add `validateUrls()` to agent.js | No such helper exists; agent only `stripUrlsForMultiProduct` | `src/modules/agent.js` (post-process), `src/utils/` (new validator helper) |
| **#3 — Family-change precision** | Modify family-change reset in `product-state.js` | Closest current behavior is `mergeProfile` `NEW_SEARCH_PHRASE` reset in [context.js:111](src/modules/context.js) | `src/modules/context.js` (legacy), `src/modules/agent.js` + state machine (agent) |
| **#4 — LLM extractor elimination** | Delete `llm-extractor.js` | **File doesn't exist** — issue is moot | (none — close as "obsolete") |
| **#5 — Intent classifier** | Add agent-side intent classifier for short-circuit | `intent.js` exists for **legacy only**, used in routes/telegram.js & chat.js — **does NOT short-circuit the agent** | `src/modules/agent.js` (add fast-path), possibly new `src/modules/agent-intent.js` |
| **#6 — FORBIDDEN_FIRST removal** | Remove `FORBIDDEN_FIRST` mechanism | **No such mechanism in code** — issue is moot | (none — close as "obsolete") |
| **#7 — update_id dedup** | Replace text-dedup with update_id | Current `_dedup` is text+sessionId Map ([routes/telegram.js:26](src/routes/telegram.js)) | `src/routes/telegram.js` |
| **#8 — Soft confirmation** | Add ask-before-confirm pattern | System prompt instructs confirmation in text only ([agent.js:91](src/modules/agent.js)); no code-level enforcement | `src/modules/agent.js` (prompt + maybe a soft-confirm tool wrapper in `src/tools/index.js`) |
| **#9 — Debounce reduction** | Lower TELEGRAM_DEBOUNCE_MS | Currently 2500ms in env+code | `.env.example`, `src/routes/telegram.js` (the `Math.max(500, Math.min(10000, ...))` clamp at line 50) |
| **#10 — Streaming** | Stream agent reply via editMessageText | No `editMessageText` in [channels/telegram.js](src/channels/telegram.js); agent does single-shot `chat.completions.create` | `src/modules/agent.js`, `src/channels/telegram.js` (add `editMessageText`), `src/routes/telegram.js` (handler) |
| **#11 — Failed-send recovery** | Detect send failure + retry | Both pipelines `saveSession` BEFORE `sendMessage`; if send throws, history records the reply but customer never sees it | `src/routes/telegram.js` (both `handleAgent` and `handleLegacy`), maybe new `src/modules/send-recovery.js` |
| **#12 — Prompt caching** | Cache stable system+knowledge prefix | Each turn rebuilds full message array in [agent.js:533](src/modules/agent.js); no `cache_control` markers | `src/modules/agent.js` (re-order messages so cacheable prefix is byte-identical) |
| **#13 — Modular knowledge** | Modularize knowledge | Knowledge **already modular** at file level (6 `.md` files); SYSTEM_PROMPT is the monolith | `src/modules/agent.js` (split SYSTEM_PROMPT) — see Open Questions |
| **#14 — History summarization** | Summarize old turns | History capped at 20, agent uses last 6, older dropped silently | `src/modules/context.js` (`appendHistory`), `src/modules/agent.js` (`buildContextBlock`) |
| **#15 — Shopify webhooks** | Subscribe to product webhooks | No webhook receiver; catalog refresh is purely TTL-driven | New route `src/routes/shopify-webhook.js`, `src/modules/catalog.js` (invalidation hook), `src/modules/shopify-admin.js` (webhook subscription helper) |
| **#16 — Corrections review** | Add approval workflow | `corrections.js` writes/reads JSONL; `correctionsBlock()` injects unconditionally; no `approved` status | `src/modules/corrections.js` (status field + filter), `src/server.js` (approval endpoint), `src/modules/agent.js` (no change if filter is in `correctionsBlock()`) |

**Issues that look obsolete (#4, #6) need explicit closure or rescoping** — see Open Questions.

---

## 8. Anomalies / Surprises

### CRITICAL — security
- **Telegram bot token committed in plain text in [OPERATIONS.md:79,84,91](OPERATIONS.md)**: `bot8619733332:AAEcwEzIjK_D-muF4z-DLiPyhSdBcowgzD8`. This is the live production bot token, in git history. Anyone with repo read access can hijack the bot. **Recommended:** rotate token via @BotFather, scrub `OPERATIONS.md` of the literal value, force-push to remove from history (or at minimum rotate now and accept the historical value is dead).

### Potentially overlapping with Issue #5 — read carefully
- [src/modules/intent.js](src/modules/intent.js) **already implements regex-based intent classification** with 4 categories (PRODUCT_INQUIRY, COMPARISON, GENERAL_QUESTION, SUPPORT). It's wired into the **legacy pipeline only**. The agent path bypasses it entirely. Issue #5 (per the chat-session plan) wanted intent classification for the agent path to short-circuit greetings/policies before the LLM tool-loop — that gap remains, but the existence of `intent.js` means we should reuse pieces (the regex patterns, the `STRONG_GENERAL_OVERRIDE`) rather than reinventing.

### Pre-existing dead/unused code
- **`src/db/pool.js` + `pg` dependency**: `pool` is exported and `checkDb()` is defined, but **`pool` is not imported anywhere** except itself, and `checkDb` is never called. PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE in config.js are validated but unused. Either drop `pg` from deps, or there's a planned use (Postgres-backed corrections? sessions?).
- **31KB inline HTML** in [src/dashboard-html.js](src/dashboard-html.js) (`DASHBOARD_HTML` constant). Imported as a JS string, served at `/dashboard`. Not testable, not editable as HTML. Could be a static file served via `express.static`.
- **Two diverging "stripFormatting" helpers** in [agent.js:376](src/modules/agent.js), [llm.js:286](src/modules/llm.js), [correction-generator.js:81](src/modules/correction-generator.js) — three near-identical implementations. Refactor candidate (extract to `src/utils/text-clean.js`).
- **Two "diversify" helpers** ([tools/index.js:413](src/tools/index.js), [retrieval.js:71](src/modules/retrieval.js)) — same algorithm, different homes.

### Config inconsistencies
- `AGENT_MAX_CONCURRENT`: code default `5`, .env.example says `10`. The code comment claims default 10, the zod default is 5.
- `AGENT_MAX_RETRIES`: code default `5`, .env.example says `3`.
- `SHOPIFY_CATALOG_MAX`: code default `1000`, .env.example says `5000`. shopify-admin.js falls back to `5000` if config undefined.

### Race / robustness gaps (will be addressed by issues, listing here for completeness)
- `saveSession` happens BEFORE `sendMessage` in both pipelines → if send fails, history is "ahead" of reality (Issue #11 territory).
- No `update_id` deduplication → Telegram retries cause double-replies (Issue #7).
- `_dedup` and `_pending` Maps are process-local → not safe under multi-process Passenger.

### Surprises in product detection
- [catalog.js:213](src/modules/catalog.js) `extractExtraSpecs` exposes ~20 metafield keys to the agent under `extra_specs`, but the agent's tool schema doesn't accept filtering by them — they're informational only.
- [tools/index.js:769](src/tools/index.js) `STRONG_TOKEN_SKIP` includes `"i need"` and `"i want"` (multi-word entries in a Set) — these literal strings would never tokenize that way (tokens are split on `[^a-z0-9]+`), so those entries are dead. Cosmetic.
- [normalize.js:139](src/modules/option-match.js?nope, that's option-match) — `tokenize()` filter is `t.length > 1 && !/^\d+$/.test(t) === false || t.length >= 2` which is logically equivalent to `t.length >= 2`. Confusing but not buggy.

### Deployment
- Production at `https://bot.useddevice.ae`, cPanel + Passenger, restart via `touch tmp/restart.txt`. Sub-URI deploys supported via `URL_BASE_PATH` / `PASSENGER_BASE_URI`.
- Node version on server: `nodevenv/alasil-bot/24` (Node 24).
- Shopify catalog auto-fetched on boot; first request after a cold start can be slow.

---

## 9. Staging Environment Status

**No separate staging deployment** is documented. Everything in `OPERATIONS.md` points to production:
- Single Telegram bot (`@alasilAi_support_bot`), single bot token.
- Single webhook URL (`/webhook/telegram/alasil-2026-xjk82nq4`).
- Single domain (`bot.useddevice.ae`).
- No staging-specific env file or branch.

Rollback is the only safety mechanism: `git checkout v0.1.0-baseline && touch tmp/restart.txt`.

**Implications for the refactor:** before merging Issue #1's first PR, we need a clear deploy story — either a staging bot (separate token, separate webhook) or a feature-flag rollout (`USE_AGENT=false` is one already, but per-issue flags will need similar). Without a staging path, **every refactor merge ships straight to production customers**.

---

## 10. Open Questions for Mohammad

Listed in priority order — please answer before Issue #1 starts.

1. **🚨 SECURITY: Telegram bot token leak.** [OPERATIONS.md](OPERATIONS.md) commits the live bot token in plain text (lines 79, 84, 91). Should we (a) rotate the token now and redact, (b) accept the historical value as compromised, (c) both? Recommend (c).

2. **Issue #5 partial overlap.** [intent.js](src/modules/intent.js) is a working regex intent classifier, but only used by the legacy pipeline. Per your STOP rule for "partial implementation": should we (a) treat #5 as fresh (build agent-side intent from scratch), (b) extend `intent.js` with an agent-friendly export, or (c) extract the regex patterns into a shared utility both paths can use?

3. **Issues #4 and #6 are obsolete.** `llm-extractor.js` does not exist on refactor/main; no `FORBIDDEN_FIRST` symbol exists either. Both were snapshot-only artifacts. Should we close them as "obsolete (already not present)" in the issue list, or do you want a paper trail in the DISCOVERED DURING REFACTOR section?

4. **Issue #13 ambiguity.** Knowledge files are already modular (6 `.md` files in `config/`). The remaining monolith is the **340-line `SYSTEM_PROMPT` in [agent.js](src/modules/agent.js)**. Did Issue #13 mean (a) split the system prompt into modular sections loaded from separate files, (b) restructure how `knowledgeBlock()` orders/sections things, or (c) something else?

5. **Staging environment.** There's no staging in `OPERATIONS.md`. Before issue #1's first deploy, do you want to (a) stand up a separate staging bot + webhook + subdomain, (b) keep deploying directly to prod and rely on `USE_AGENT` + per-issue flags, or (c) defer this question until later issues?

6. **`pg` Pool.** Configured but unused on refactor/main. Drop the dep + the 5 PG env vars, or keep for a planned use (e.g. Postgres-backed corrections in Issue #16)?

7. **Shared-helper refactor outside the 16 issues.** Three near-identical `stripFormatting()` and two `diversify()` helpers exist. Tackle as a "PHASE 2 prep" cleanup PR, or roll into whichever issue first touches them, or skip?

8. **uuid <14 vulnerability** (moderate). Standalone task, or tucked into one of the 16?

9. **`/chat` HTTP route** ([routes/chat.js](src/routes/chat.js)) is legacy-pipeline only and used by the dashboard / scripts. Should agent-path support be added here too, or is it intentionally legacy-only?

10. **Per-session rate limiter.** The snapshot had `src/modules/rate-limit.js` (sliding-window per-session). Main has only Express IP-level rate limit on `/chat`, none on `/webhook/telegram`. Should this be a new issue (#17?) or rolled into #11 (failed-send) which is the closest robustness-area issue?
