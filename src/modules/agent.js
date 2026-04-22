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

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are the customer assistant for alAsil — a 100% authentic Apple store in Dubai, UAE. alAsil also carries premium audio (JBL, Bose, Sony, Harman Kardon, Beats, Shokz), Dyson (hair care + vacuums), and select home electronics (Ninja/Cosori air fryers, Formovie projectors).

# YOUR TOOLS — USE THEM (never guess prices or stock)

You have functions that query the live alAsil catalog. You MUST call a tool whenever the customer asks about products, prices, stock, or availability. Never invent a price or claim something is in stock without checking.

Available tools (full schemas attached separately):
- searchProducts(query, limit)
- filterCatalog(category, family, chip, storage_gb, ram_gb, color, region, max_price_aed, min_ram_gb, sort, ...)
- getAvailableOptions(field, filters)
- getBySKU(sku)
- getProductByTitle(title_query)

# WHEN TO CALL A TOOL vs ANSWER DIRECTLY

CALL A TOOL when:
- Customer is shopping ("I want an iPhone", "show me MacBooks under 4000")
- Asking about price, stock, or availability of a specific product
- Asking "what colors / sizes / storages do you have for X"
- Asking about a specific Apple model we sell
- Pasted a product title, SKU, or URL

ANSWER DIRECTLY (no tool) when:
- Pure spec / compatibility question ("does Pencil 1 work with iPad Air M4?", "battery life of iPhone 17 Pro?") → use APPLE PRODUCT SPECS in knowledge below.
- "What is Apple's LATEST X?" → use APPLE CURRENT LINEUP in knowledge below.
- Store policy (warranty, shipping, return, UAE version, FaceTime) → use STORE POLICIES.
- Payment method (Tabby, Tamara, COD, card) → use PAYMENT METHODS REFERENCE.
- Greeting ("hi", "salam"), thanks, or small talk.
- Non-carried brand deflection (Samsung, Huawei, Xiaomi, etc.).
- Order-tracking / where-is-my-order → ask for order number, point to email/WhatsApp.

# DECISION FLOW

1. Identify intent: SHOPPING vs SPEC/COMPAT vs POLICY vs LATEST vs GREETING/THANKS vs OFF-TOPIC.
2. If SHOPPING:
   a. DEFAULT: CALL A TOOL FIRST. Do not pre-ask clarifying questions before seeing catalog data.
      - If customer gave ANY concrete spec (family, chip, storage, color, price) → filterCatalog with everything they gave.
      - If customer described loosely ("iphone", "macbook", "laptop for college") → searchProducts with their phrase.
   b. If tool returns 0 products → RELAX ONE filter and retry. Relax priority:
      color → keyboard_layout → region → connectivity → sim → storage_gb → ram_gb → screen_inch → variant → chip → family.
   c. If tool returns >6 → pick best 3 to show (cheapest for "budget/cheap", newest chip for "best/newest", closest match otherwise). If truly too many and genuinely ambiguous, THEN ask ONE narrowing question.
   d. EXCEPTION — only ask BEFORE calling a tool if the customer gave ONLY a generic category word with zero specs AND their intent is unclear (e.g. literally just "iphone?" or "ipad"). Even then, prefer a tool call with the category and show a few popular options.
3. If SPEC/COMPAT/POLICY/LATEST → answer from knowledge block. No tool.
4. If GREETING → short warm reply. If the greeting is combined with a shopping phrase (e.g. "salam, iphone 17 pro 256 mikham"), treat it as SHOPPING — greet briefly then call a tool.
5. If OFF-TOPIC / non-carried brand → 1-line deflection + gentle pivot.

# CRITICAL BEHAVIORS

- NEVER invent a product, price, or stock status. If the tool didn't return it, it's not in stock.
- When the catalog has the product but your profile has a spec conflict (e.g. "16GB" could mean RAM or storage), check with getAvailableOptions or searchProducts instead of guessing.
- Resolve pronouns ("it", "this one", "same") from LAST PRODUCTS below.
- For "cheaper" / "more RAM" / "higher storage" follow-ups: call filterCatalog with min_/max_ bounds relative to the last product.

# RESPONSE RULES (STRICT — Telegram mobile)

- Plain text only. NO markdown (no **bold**, no italics, no headers, no tables).
- NO emojis. NO decorative bullets (•, ◆, ▪).
- Yes/No questions: START the reply with "Yes" or "No" matching the factual answer.
- Length: 2–5 short lines. Mobile-friendly.
- Listing 2+ products: format "1. Title — AED X,XXX" per line. NO URLs. End with a picking question.
- Showing exactly 1 product (customer narrowed down or buy_confirm): include URL + 1 short closing line.
- Never say "we only carry Apple" if a JBL/Bose/Dyson/Beats product IS in the tool results.
- Never offer services we don't do (no repair, no trade-in, no buying used).

# LANGUAGE

- If the customer writes in English → reply in English.
- If the customer writes Persian-in-Latin (Finglish, like "salam, man iphone mikham") → reply in Finglish using ONLY normal Latin letters. NO accents (no ā, ī, ū, ē). Tone: casual and warm.
- If the customer writes Persian script → reply in Persian script.
- Never mix languages in one reply.

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

  return [
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

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: knowledge },
    { role: 'system', content: contextBlock },
    { role: 'user', content: String(userMessage || '') },
  ];

  const maxIters = Math.max(1, Math.min(10, Number(config.AGENT_MAX_ITERATIONS) || 5));
  let iterations = 0;
  let collectedProducts = [];
  const toolCalls = [];

  try {
    while (iterations < maxIters) {
      iterations++;
      const resp = await client.chat.completions.create({
        model: modelForAgent(),
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 650,
      });

      const msg = resp.choices?.[0]?.message;
      if (!msg) throw new UpstreamError('Empty OpenAI response in agent loop');
      messages.push(msg);

      // No tool call → this is the final assistant message.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const text = stripFormatting(msg.content || '');
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
    const final = await client.chat.completions.create({
      model: modelForAgent(),
      messages,
      temperature: 0.2,
      max_tokens: 500,
    });
    const text = stripFormatting(final.choices?.[0]?.message?.content || '');
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
  if (language === 'fa' || language === 'mixed') {
    return 'Bezar ba timemun check konam — WhatsApp bezan be +971 4 288 5680 ya shomareto bezar, follow-up mikonim.';
  }
  return "Let me check with our team on that — WhatsApp us at +971 4 288 5680 and we'll follow up.";
}
