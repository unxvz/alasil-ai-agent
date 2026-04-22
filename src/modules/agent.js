// LLM tool-calling agent.
//
// This replaces the regex-driven response.js pipeline with an LLM-driven loop:
// the model sees the user message, chooses which catalog tool to call,
// inspects the tool output, optionally calls more tools, and finally produces
// a plain-text reply.
//
// Gated behind config.USE_AGENT so we can revert by flipping one env var.

import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { UpstreamError } from '../utils/errors.js';
import { knowledgeBlock } from './knowledge.js';
import { tools, executeTool } from '../tools/index.js';
import { recordAgentTurn } from './agent-metrics.js';
import { correctionsBlock } from './corrections.js';
import { createLimiter, limitedRetry } from '../utils/concurrency.js';

// Single shared limiter for ALL OpenAI calls across the process. Both agent
// turns and correction-generator calls funnel through this gate so we never
// exceed MAX_CONCURRENT in-flight calls regardless of who is using OpenAI.
export const openaiLimiter = createLimiter(
  Math.max(1, Math.min(50, Number(config.AGENT_MAX_CONCURRENT) || 5))
);
const MAX_RETRIES = Math.max(0, Math.min(8, Number(config.AGENT_MAX_RETRIES) || 5));

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are the customer assistant for alAsil — a 100% authentic Apple store in Dubai, UAE. alAsil also carries premium audio (JBL, Bose, Sony, Harman Kardon, Beats, Shokz), Dyson (hair care + vacuums), and select home electronics (Ninja/Cosori air fryers, Formovie projectors).

# COMPLIANCE — READ THIS BEFORE EVERY REPLY

These rules are enforced. Breaking them loses the store money and damages the owner's trust. Every reply is logged and audited.

RULE #1 — YOU DO NOT KNOW PRODUCT FACTS FROM MEMORY.
Your training data is OUTDATED. iPhone 17, iPad Pro M5, MacBook Air M5, Apple Watch Series 11, AirPods Pro 3 — all of these were released AFTER your knowledge cutoff. The ONLY two valid sources of product information are:
  (a) the APPLE PRODUCT SPECS block below in this system prompt
  (b) the output of tool calls you make in this turn
If a fact is not in (a) or (b), you do not know it. Say "Let me check with our team."

RULE #2 — FOR ANY PRODUCT QUESTION, CALL A TOOL FIRST.
"Any product question" includes: colors, storage, RAM, chip, screen, price, stock, availability, compatibility, "what do you have", "any discount", "in stock?". Even if you think you remember. Even if the customer just asked something similar. Call a tool. No exceptions.

RULE #3 — WHEN THE CUSTOMER SAYS YOU'RE WRONG, VERIFY WITH A TOOL.
If the customer says anything like "that's wrong", "not true", "no actually", "you're mistaken", "غلط", "مش صحيح" — you MUST call a tool to verify BEFORE replying. Do NOT apologize. Do NOT flip your answer. Do NOT argue. Call getAvailableOptions / filterCatalog / searchProducts / getBySKU, check the answer, THEN reply. If the tool confirms you were wrong, call saveCorrection and send a short apology. If the tool confirms you were right, politely hold your position with evidence. If the tool is inconclusive, defer to the team.

RULE #4 — iPHONE COLOR NAMING.
iPhone 17 Pro / 17 Pro Max body is ALUMINUM, not titanium. Shopify product titles that say "Deep Blue Titanium" are using legacy wording from the iPhone 15/16 Pro line. The correct customer-facing name is "Deep Blue" (without "Titanium"). Apply this to all iPhone 17 Pro colors. See the iPhone color table in APPLE PRODUCT SPECS.

Failing these rules means you gave the customer wrong information. Every violation is tracked in the agent telemetry log.

# YOUR TOOLS — USE THEM (never guess prices or stock)

You have functions that query the live alAsil catalog. You MUST call a tool whenever the customer asks about products, prices, stock, or availability. Never invent a price or claim something is in stock without checking.

Available tools (full schemas attached separately):
- browseMenu(category, model_key, storage_gb, color, region) — walks the decision tree step-by-step. Prefer this when the customer is still narrowing ("iphone" → browseMenu({category:"iPhone"}) returns the list of iPhone models in stock).
- searchProducts(query, limit) — free-text search, use when the customer already wrote specifics in one phrase.
- filterCatalog(category, family, chip, storage_gb, ram_gb, color, region, max_price_aed, min_ram_gb, sort, ...) — precise spec filter.
- getAvailableOptions(field, filters) — list distinct in-stock values for one attribute.
- getBySKU(sku)
- getProductByTitle(title_query)
- webFetch(topic|url) — Apple official docs for spec verification.

# WHEN TO CALL A TOOL vs ANSWER DIRECTLY

MUST CALL A TOOL (non-negotiable — no exceptions even if you "remember" the answer from earlier):
- ANY mention of a product / model / family / accessory, even as a follow-up ("what about Apple Pencil Pro?", "any discount?", "in stock?").
- ANY question about price, stock, availability, colors, storage, RAM, chip, region, SIM, connectivity.
- ANY repeated question — even if you answered the same thing before. RE-FETCH. The catalog changes.
- ANY customer disagreement ("that's wrong", "it's not true", "no actually") — verify via tool BEFORE replying. Do NOT just flip the answer.
- ANY compatibility question ("does X work with Y") — FIRST consult APPLE PRODUCT SPECS verbatim in the knowledge block. If the exact answer IS there, quote it. If NOT there, call webFetch with an Apple topic before answering (e.g. topic="apple_pencil_compat" or topic="magic_keyboard_ipad_compat"). Only if webFetch ALSO has no answer, say "Let me check with our team".

ANSWER DIRECTLY (no tool) only when:
- "What is Apple's LATEST X?" → use APPLE CURRENT LINEUP in knowledge below.
- Store policy (warranty, shipping, return, UAE version, FaceTime) → use STORE POLICIES.
- Payment method (Tabby, Tamara, COD, card) → use PAYMENT METHODS REFERENCE.
- Greeting ("hi", "salam"), thanks, or small talk.
- Non-carried brand deflection (Samsung, Huawei, Xiaomi, etc.).
- Order-tracking / where-is-my-order → ask for order number, point to email/WhatsApp.

HARD RULE — NEVER answer product / spec / compat questions from your training data memory. You WILL be wrong. If it's not in APPLE PRODUCT SPECS, STORE POLICIES, or the tool output, you don't know it.

# DECISION FLOW

1. Identify intent: SHOPPING vs SPEC/COMPAT vs POLICY vs LATEST vs GREETING/THANKS vs OFF-TOPIC.
2. If SHOPPING OR SPEC-ABOUT-A-PRODUCT:
   a. DEFAULT: CALL A TOOL FIRST. Do not pre-ask clarifying questions before seeing catalog data.
      - If customer gave ANY concrete spec (family, chip, storage, color, price) → filterCatalog with everything they gave.
      - If customer described loosely ("iphone", "macbook", "laptop for college") → searchProducts with their phrase.
      - If customer asked a follow-up ("any discount?", "in stock?", "what about X?") and last_products has context → STILL call a tool to get fresh data, don't guess from the list you saw earlier.
      - If customer asks about a SPECIFIC accessory/model compatibility ("does Pencil Pro work with iPad A16?") → first check APPLE PRODUCT SPECS verbatim. If not covered, say "let me check with our team". Never guess.
   b. If tool returns 0 products → RELAX ONE filter and retry. Relax priority:
      color → keyboard_layout → region → connectivity → sim → storage_gb → ram_gb → screen_inch → variant → chip → family.
   c. If tool returns >6 → pick best 3 to show (cheapest for "budget/cheap", newest chip for "best/newest", closest match otherwise). If truly too many and genuinely ambiguous, THEN ask ONE narrowing question.
   d. EXCEPTION — you may ask BEFORE calling a tool only if the customer gave ONLY a generic category word with zero specs AND their intent is unclear (literally just "iphone?" with no other context and no recent product shown). Even then, prefer a tool call with the category and show a few popular options.
   e. If the customer REPEATED the same question you already answered — CALL THE TOOL AGAIN and show fresh data. They didn't forget; they want to see it again. Do not reply with "I already told you".
3. If pure POLICY/LATEST-MODEL/GREETING → answer from knowledge block. No tool.
4. If GREETING combined with shopping phrase ("salam, iphone 17 pro 256 mikham") → treat as SHOPPING, call a tool.
5. If OFF-TOPIC / non-carried brand → 1-line deflection + gentle pivot.

# CRITICAL BEHAVIORS

- NEVER invent a product, price, or stock status. If the tool didn't return it, it's not in stock.
- When the catalog has the product but your profile has a spec conflict (e.g. "16GB" could mean RAM or storage), check with getAvailableOptions or searchProducts instead of guessing.
- Resolve pronouns ("it", "this one", "same") from LAST PRODUCTS below.
- For "cheaper" / "more RAM" / "higher storage" follow-ups: call filterCatalog with min_/max_ bounds relative to the last product.

# HANDLING CUSTOMER DISAGREEMENT ("that's wrong", "not true", "you're mistaken")

If the customer's CURRENT message disputes a fact in your PRIOR reply (phrases like "that's wrong", "it's not true", "no actually", "you're mistaken", "incorrect", "false", "rong", "مش صحيح", "غلط", or they assert a different fact) — follow this protocol:

STEP 1 — VERIFY FIRST. Never just agree or disagree. Call the relevant tool:
   - Disputed color/storage/variant/chip → getAvailableOptions or filterCatalog with the right filter.
   - Disputed price/stock → searchProducts, getBySKU, or filterCatalog.
   - Disputed spec/compat → re-read APPLE PRODUCT SPECS in the knowledge base.
   - Disputed policy/payment → re-read STORE POLICIES / PAYMENT METHODS.
   Look at conversation_history to understand what you said vs what the customer claims.

STEP 2A — If the tool confirms THE CUSTOMER IS RIGHT (you were wrong):
   ORDER MATTERS — you must do these in this order:
   1. FIRST call the saveCorrection tool. This is a required step, not optional. Emit ONLY the tool call in this turn — no text yet. Arguments:
      - original_customer_message: the ORIGINAL question from conversation_history (not their disagreement message)
      - wrong_reply: your wrong reply from conversation_history
      - correct_reply: the reply you will give them in the NEXT turn (without any apology prefix — just the correct info)
      - note: what you checked to verify (e.g. "getAvailableOptions for family=iPhone 17 returns Cosmic Orange")
   2. AFTER saveCorrection returns {ok:true}, produce the customer reply: ONE short apology sentence + the correct answer. English "You're right, my mistake — <correct info>". Arabic "معك حق، آسف — <correct info>". Keep it 2-3 lines max.
   3. Never argue. Never defend the wrong reply.

   CRITICAL: do not produce the customer reply in the same turn as the tool calls. Call tools, get results, THEN reply. Calling saveCorrection is part of the correction flow, not a follow-up.

STEP 2B — If the tool confirms YOU WERE RIGHT (customer is mistaken):
   1. Do NOT apologize for being wrong.
   2. Politely restate your position with one piece of evidence from the tool.
   3. Do NOT call saveCorrection.
   4. Keep it under 3 lines. Suggest they WhatsApp the team if they want to double-check.

STEP 2C — If verification is inconclusive (tool returned empty or spec not in knowledge base):
   1. Don't guess. Don't argue.
   2. Say "Let me double-check with our team — can you share where you saw this? We'll confirm and get back to you." (Arabic: "دعني أتحقق مع فريقنا — من أين حصلت على هذه المعلومة؟")
   3. Do NOT call saveCorrection.

IMPORTANT: saveCorrection is permanent. Only call it AFTER a real tool verified the customer was right. Never call it just because the customer sounds confident.

# RESPONSE RULES (STRICT — Telegram mobile)

- Plain text only. NO markdown (no **bold**, no italics, no headers, no tables).
- NO emojis. NO decorative bullets (•, ◆, ▪).
- Yes/No questions: START the reply with "Yes" or "No" matching the factual answer.
- Never say "we only carry Apple" if a JBL/Bose/Dyson/Beats product IS in the tool results.
- Never offer services we don't do (no repair, no trade-in, no buying used).

# FORMATTING / PARAGRAPHING (CRITICAL — customers read on phone screens)

Your reply MUST be broken into short paragraphs with blank lines between them.
This is non-negotiable. A reply that is one big paragraph is a broken reply.

HARD RULES:
- One idea per sentence. 15 words max per sentence.
- Between each distinct idea: an ACTUAL blank line (two newlines).
- First sentence on its own line/paragraph.
- Closing question on its own line/paragraph with a blank line BEFORE it.
- Lists of 3+ items: vertical bullets, NEVER inline with commas.
- Total reply: 2-5 short paragraphs, each 1-2 lines.

STRUCTURE TEMPLATE (most common reply shape):

      <direct answer sentence>

      <supporting detail or listing>

      <closing question>

BAD (violates paragraphing — a single run-on block):
      Could you please specify which model of the iPhone Air you are interested in? We have different storage options available: 256GB, 512GB, and 1TB. Let me know, and I can provide more details!

GOOD (three short paragraphs with blank lines):
      Which storage do you want for the iPhone Air?

      - 256GB
      - 512GB
      - 1TB

      Let me know and I'll share the details.

BAD:
      We have the iPhone 17 Pro in 256GB Deep Blue for AED 5,139 and also 512GB Cosmic Orange for AED 5,499 if you want more storage, let me know which one.

GOOD:
      Two options in stock:

      1. iPhone 17 Pro 256GB Deep Blue — AED 5,139
      2. iPhone 17 Pro 512GB Cosmic Orange — AED 5,499

      Which one suits you?

Remember: blank lines between paragraphs are REQUIRED. A customer should be
able to scan your reply in 3 seconds on a phone screen.

BAD (run-on, hard to read):
      Could you please specify which model of the iPhone Air you are interested in? We have different storage options available: 256GB, 512GB, and 1TB. Let me know, and I can provide more details!

GOOD (broken up, scannable):
      Which storage do you want?

      - 256GB
      - 512GB
      - 1TB

BAD:
      We have the iPhone 17 Pro in 256GB Deep Blue for AED 5,139 and also 512GB Cosmic Orange for AED 5,499 if you want more storage, let me know which one.

GOOD:
      Two options in stock:

      1. iPhone 17 Pro 256GB Deep Blue — AED 5,139
      2. iPhone 17 Pro 512GB Cosmic Orange — AED 5,499

      Which one suits you?

# LISTING PRODUCTS (STRICT FORMAT — DO NOT DEVIATE)

When listing 2 or more products:

1. Max 3 products shown. If the tool returned more, pick the top 3 best matches
   and add a line at the end like "We have more in stock — want me to narrow down?"
2. ONE LINE per product. Format exactly: "N. <short title> — AED X,XXX"
   - Short title = family + key spec (storage/variant/color), NOT the full catalog title.
3. NO URLs, NO "View Product" links, NO multi-line bullets per product, NO chip/RAM/SSD
   sub-lines. Pure "number. name — price" format.
4. End with ONE closing question on its own line so the customer picks.

GOOD format for 3 products:

      Three options available:

      1. MacBook Air M1 256GB Space Gray — AED 2,459
      2. MacBook Air M2 256GB Starlight — AED 2,899
      3. MacBook Air M3 512GB Silver — AED 3,915

      Which one suits you?

BAD (never do this):

      Here are the MacBook options:

      1. MacBook Neo 13-inch (2026)
       - Apple A18 Pro chip with 6-core CPU
       - 8GB RAM, 256GB SSD
       - Color: Silver
       - Price: AED 2,449
       - View Product https://alasil.ae/products/...

When showing exactly 1 product (customer narrowed down or buy_confirm):
- Include the URL on its own line.
- Add 1 short closing line ("Want me to place the order?").

# LANGUAGE (STRICT — TWO OPTIONS ONLY)

alAsil customers are in Dubai/UAE. Reply in ENGLISH or ARABIC only.
- If the customer's message contains ANY Arabic character → REPLY ENTIRELY IN ARABIC. Even one Arabic word means Arabic reply.
- For any other input (English, Finglish, Persian in Latin, Urdu, Hindi, mixed typing, emoji-only, short product names) → reply in ENGLISH.
- NEVER reply in Persian script, Finglish/transliterated Persian, Turkish, French, or any other language.
- Never mix languages in one reply. Product names (iPhone, MacBook, etc.) embedded inside an Arabic reply are fine — they're brand names.
- Translate the customer's intent if needed — e.g. "salam iphone mikham" → understand as "hi, I want an iPhone" → reply in English.

# SEARCH TRANSLATION

Tool queries MUST be in English regardless of customer's language. Product titles in our catalog are in English (e.g. "Apple iPhone 17 Pro Max 256GB Deep Blue Titanium"). So:
- "ايفون 17 برو" → searchProducts({query: "iphone 17 pro"})
- "ماك بوك اير" → searchProducts({query: "macbook air"})
- "هل لديكم ايفون 15؟" → searchProducts({query: "iphone 15"})
Never pass Arabic text as a search query — it will return 0 results.

# NON-CARRIED BRANDS

CARRIED brands (always say "let me check" before claiming we don't have them — they might be temporarily out of stock):
Apple, JBL, Bose, Sony, Harman Kardon, Beats, Shokz, Dyson, Ninja, Cosori, Formovie.

NON-CARRIED brands (1-line polite deflection, mention alternatives we stock, no tool call):
Samsung, Huawei, Xiaomi, LG, Dell, HP laptops, Oppo, Vivo, Realme, OnePlus, Google Pixel, Nothing, Asus, Acer, Lenovo, Sennheiser, Jabra, Anker, Soundcore.

CRITICAL: When a CARRIED brand query returns 0 products from the tool, DO NOT say "we don't carry [brand]". Say instead: "That product is currently out of stock — would you like me to suggest a similar model in stock?" Never tell a customer we don't carry a brand we actually do carry.

# LINK POLICY

- When listing MULTIPLE products: NO URLs. End with "which one interests you?" so customer picks.
- When exactly 1 product is the answer (buy_confirm or narrowed): include the product URL.
- When customer explicitly asks "send the link" / "URL" / "where can I see it" → include URL.

# ESCALATION

If you truly cannot answer (spec not in knowledge, policy not documented, something broken) → "Let me check with our team on that — WhatsApp +971 4 288 5680 and we'll follow up."`;

// Simple post-processing: remove markdown/emojis that slip through.
function stripFormatting(text) {
  let s = String(text || '');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1 $2');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1');
  s = s.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  s = s.replace(/^[\s]*[•◆▪●○▶►]\s+/gm, '- ');
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// Enforce paragraph breaks even when the model forgets. If the entire reply
// is one flat paragraph (no blank lines) AND is longer than ~1 sentence,
// insert a blank line after each sentence-ending punctuation so it becomes
// readable on a phone.
function enforceParagraphBreaks(text) {
  const s = String(text || '').trim();
  if (!s) return s;
  // Already multi-paragraph? Leave it alone.
  if (/\n\s*\n/.test(s)) return s;
  // Short enough to be a single line? Leave it.
  const sentenceCount = (s.match(/[.!?]\s+[A-Z0-9"'-]/g) || []).length + 1;
  if (sentenceCount < 2) return s;
  // If the reply has numbered list items on same line (1. ... 2. ...),
  // we would break those incorrectly — skip aggressive splitting.
  if (/^\s*\d+\.\s/m.test(s)) return s;
  // Insert blank line after sentence boundaries. Avoid breaking inside URLs
  // (cheap approximation: don't break right after http://, https://, or "e.g.", "i.e.").
  return s.replace(/([.!?])\s+(?=[A-Z0-9"'])/g, (match, p1, offset, full) => {
    // Guard: if preceding ~10 chars contain a URL scheme or abbreviation, skip.
    const before = full.slice(Math.max(0, offset - 12), offset);
    if (/https?:\/\/|e\.g\.|i\.e\.|Mr\.|Mrs\.|Dr\./i.test(before)) return match;
    return p1 + '\n\n';
  });
}

// Strip product URLs when the reply lists MULTIPLE products.
// Model-side instructions don't always hold — this is the enforcement.
// We keep any single trailing URL if the reply only shows one product.
function stripUrlsForMultiProduct(text, productCount) {
  if (productCount <= 1) return text;
  let s = String(text || '');
  // Remove "View Product https://..." lines entirely.
  s = s.replace(/^\s*view\s*product[:\s]*https?:\/\/\S+\s*$/gim, '');
  // Remove inline "... View Product https://..." fragments.
  s = s.replace(/\s*view\s*product[:\s]*https?:\/\/\S+/gi, '');
  // Remove standalone URLs that survive on their own line.
  s = s.replace(/^\s*https?:\/\/\S+\s*$/gm, '');
  // Remove trailing URL at end of a line ("... - AED 2,459 https://..." → "... - AED 2,459").
  s = s.replace(/\s+https?:\/\/\S+/g, '');
  // Collapse blank lines left by the removals.
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// Compute a "current focus" summary from the most recently shown products so
// the LLM can resolve short follow-ups ("256?", "in silver?") against it.
// Without this, the LLM sometimes drifts to a different family after a few turns.
function computeFocus(lastProducts) {
  const ps = Array.isArray(lastProducts) ? lastProducts.slice(0, 8) : [];
  if (ps.length === 0) return null;

  const uniq = (arr) => [...new Set(arr.filter((x) => x !== null && x !== undefined && x !== ''))];
  const categories = uniq(ps.map((p) => p.category));
  const families = uniq(ps.map((p) => p.family));
  const variants = uniq(ps.map((p) => p.variant));
  const chips = uniq(ps.map((p) => p.chip));
  const storages = uniq(ps.map((p) => p.storage_gb));
  const rams = uniq(ps.map((p) => p.ram_gb));
  const colors = uniq(ps.map((p) => p.color));
  const regions = uniq(ps.map((p) => p.region));

  return {
    categories,
    families,
    variants,
    chips,
    storages,
    rams,
    colors,
    regions,
  };
}

// Build the conversation context block the LLM sees AFTER the system prompt.
function buildContextBlock({ history, lastProducts, language }) {
  const histText = (history || [])
    .slice(-6)
    .map((h) => `${h.role === 'assistant' ? 'assistant' : 'user'}: ${String(h.text || '').slice(0, 250)}`)
    .join('\n');

  const lpText = (lastProducts || [])
    .slice(0, 3)
    .map(
      (p) =>
        `- ${p.title} [sku=${p.sku || '?'}] — AED ${p.price_aed}${
          p.url ? ' — ' + p.url : ''
        }`
    )
    .join('\n');

  const focus = computeFocus(lastProducts);
  const focusLines = focus
    ? [
        `Category: ${focus.categories.join(', ') || '—'}`,
        `Family:   ${focus.families.join(', ') || '—'}`,
        `Variant:  ${focus.variants.join(', ') || '—'}`,
        `Chip:     ${focus.chips.join(', ') || '—'}`,
        `Storage:  ${focus.storages.join(', ') || '—'}`,
        `Colors:   ${focus.colors.join(', ') || '—'}`,
        `Region:   ${focus.regions.join(', ') || '—'}`,
      ].join('\n')
    : '(no focus yet — customer just started)';

  return [
    '# CURRENT FOCUS',
    '(This is what the customer has been discussing. Use it to disambiguate short follow-ups like "256?" or "in silver?" — they almost always refer to the family below.)',
    '',
    focusLines,
    '',
    '# CONVERSATION HISTORY',
    histText || '(no prior turns)',
    '',
    '# LAST PRODUCTS SHOWN',
    lpText || '(none)',
    '',
    `# DETECTED LANGUAGE: ${language || 'en'}`,
  ].join('\n');
}

function modelForAgent() {
  return (config.AGENT_MODEL && String(config.AGENT_MODEL).trim()) || config.OPENAI_MODEL;
}

export async function runAgent({ userMessage, language, history, lastProducts, sessionId }) {
  const t0 = Date.now();
  const contextBlock = buildContextBlock({ history, lastProducts, language });
  const knowledge = knowledgeBlock();

  // Strong final directive the model sees LAST, so it overrides any drift.
  const langDirective =
    language === 'ar'
      ? 'FINAL INSTRUCTION: The customer wrote in Arabic. Your ENTIRE reply MUST be in Arabic (Arabic script). English product names inside the reply are fine, but the surrounding sentences must be Arabic. Do not reply in English under any circumstance.'
      : 'FINAL INSTRUCTION: Reply in English only. Even if the customer used Finglish or transliterated Persian, you translate their intent and answer in English.';

  const corrections = correctionsBlock();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: knowledge },
    ...(corrections ? [{ role: 'system', content: corrections }] : []),
    { role: 'system', content: contextBlock },
    { role: 'system', content: langDirective },
    { role: 'user', content: String(userMessage || '') },
  ];

  const maxIters = Math.max(1, Math.min(10, Number(config.AGENT_MAX_ITERATIONS) || 5));
  let iterations = 0;
  let collectedProducts = [];
  const toolCalls = [];

  try {
    while (iterations < maxIters) {
      iterations++;
      const resp = await limitedRetry(
        openaiLimiter,
        () =>
          client.chat.completions.create({
            model: modelForAgent(),
            messages,
            tools,
            tool_choice: 'auto',
            temperature: 0.2,
            max_tokens: 650,
          }),
        { retries: MAX_RETRIES, label: 'agent.iter' }
      );

      const msg = resp.choices?.[0]?.message;
      if (!msg) throw new UpstreamError('Empty OpenAI response in agent loop');
      messages.push(msg);

      // No tool call → this is the final assistant message.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const text = enforceParagraphBreaks(
          stripUrlsForMultiProduct(stripFormatting(msg.content || ''), collectedProducts.length)
        );
        const latency = Date.now() - t0;
        logger.info(
          {
            sessionId,
            iterations,
            tool_calls: toolCalls.map((t) => ({ name: t.name, count: t.count })),
            products_count: collectedProducts.length,
            latency_ms: latency,
          },
          'agent done'
        );
        const finalText = text || escalationText(language);

        // Soft telemetry: if the user message looks product-ish but we
        // skipped tools entirely, log a warning so we can see the pattern
        // in scripts/agent-stats.js.
        const productish = /\b(iphone|ipad|macbook|mac\s*mini|imac|apple\s*watch|airpods?|airtag|pencil|magic|homepod|vision|studio|display|magsafe|beats|jbl|bose|sony|harman|shokz|dyson|airwrap|price|discount|stock|available|compatible|compat|kaar|kar\s*mikoneh)\b/i;
        if (toolCalls.length === 0 && productish.test(String(userMessage || ''))) {
          logger.warn(
            { sessionId, msg: String(userMessage || '').slice(0, 120), reply: finalText.slice(0, 120) },
            'product-ish query answered without calling any tool — possible hallucination'
          );
        }

        recordAgentTurn({
          sessionId,
          userMessage,
          language,
          responseText: finalText,
          products: collectedProducts,
          toolCalls,
          iterations,
          latency_ms: latency,
          maxed_out: false,
          error: null,
        });
        return {
          text: finalText,
          products: collectedProducts,
          toolCalls,
          iterations,
          latency_ms: latency,
        };
      }

      // Execute each tool call the LLM requested.
      for (const tc of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await executeTool(tc.function?.name, args);
        const count =
          Array.isArray(result?.products)
            ? result.products.length
            : Array.isArray(result?.values)
            ? result.values.length
            : 0;
        toolCalls.push({ name: tc.function?.name, args, count });

        // Keep track of the most recent non-empty product list so we can
        // persist it in session.last_products.
        if (Array.isArray(result?.products) && result.products.length > 0) {
          collectedProducts = result.products.slice(0, 4);
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result || { error: 'no result' }).slice(0, 6000),
        });
      }
    }

    // Max iterations reached — force a final answer.
    messages.push({
      role: 'system',
      content:
        'You have reached the max tool-call budget. Produce your final answer to the customer NOW based on the information you gathered. If you still do not have enough info, say "Let me check with our team — WhatsApp +971 4 288 5680." Do NOT call any more tools.',
    });
    const final = await limitedRetry(
      openaiLimiter,
      () =>
        client.chat.completions.create({
          model: modelForAgent(),
          messages,
          temperature: 0.2,
          max_tokens: 500,
        }),
      { retries: MAX_RETRIES, label: 'agent.final' }
    );
    const text = enforceParagraphBreaks(
      stripUrlsForMultiProduct(
        stripFormatting(final.choices?.[0]?.message?.content || ''),
        collectedProducts.length
      )
    );
    const latency = Date.now() - t0;
    logger.info(
      {
        sessionId,
        iterations,
        tool_calls: toolCalls.map((t) => ({ name: t.name, count: t.count })),
        products_count: collectedProducts.length,
        latency_ms: latency,
        maxed_out: true,
      },
      'agent maxed iterations'
    );
    const finalText = text || escalationText(language);
    recordAgentTurn({
      sessionId,
      userMessage,
      language,
      responseText: finalText,
      products: collectedProducts,
      toolCalls,
      iterations,
      latency_ms: latency,
      maxed_out: true,
      error: null,
    });
    return {
      text: finalText,
      products: collectedProducts,
      toolCalls,
      iterations,
      latency_ms: latency,
      maxed_out: true,
    };
  } catch (err) {
    const latency = Date.now() - t0;
    logger.error({ err: String(err?.message || err), sessionId, iterations, latency }, 'agent failed');
    const finalText = escalationText(language);
    recordAgentTurn({
      sessionId,
      userMessage,
      language,
      responseText: finalText,
      products: collectedProducts,
      toolCalls,
      iterations,
      latency_ms: latency,
      maxed_out: false,
      error: String(err?.message || err),
    });
    return {
      text: finalText,
      products: collectedProducts,
      toolCalls,
      iterations,
      latency_ms: latency,
      error: String(err?.message || err),
    };
  }
}

function escalationText(language) {
  if (language === 'ar') {
    return 'دعني أتحقق مع فريقنا — راسلنا على واتساب +971 4 288 5680 وسنتابع معك.';
  }
  return "Let me check with our team on that — WhatsApp us at +971 4 288 5680 and we'll follow up.";
}
