// LLM-based intent + spec extractor.
//
// Regex extraction in product-state.js handles clean English queries well
// but misses typos ("iphon"), transliterations ("ای فون", "ايفون"), implicit
// mentions ("laptop", "phone"), and slang. This module calls a fast LLM
// (gpt-4o-mini) to produce a structured JSON of the specs the customer
// mentioned — then we merge that with the regex extraction for a complete
// state picture.
//
// Design notes:
//  - Uses gpt-4o-mini for cost/speed (not the main agent model).
//  - Always returns a full spec object; fields the message didn't mention
//    are null. Merging with regex state means regex-confirmed fields stay
//    even if LLM missed them.
//  - Cached per message hash so the SAME message doesn't re-hit the LLM.

import OpenAI from 'openai';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// Cheaper/faster model for extraction. Deliberately NOT the agent model —
// extraction is a narrow, high-volume task where gpt-4o-mini is enough.
const EXTRACTOR_MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You extract product-request specs from a single customer message for alAsil (Apple store in Dubai).

Return ONLY valid JSON matching this schema. Use null when the message doesn't mention that attribute:

{
  "intent": "shopping" | "greeting" | "policy" | "discount_query" | "confirmation" | "link_request" | "off_topic",
  "category": "iPhone" | "Mac" | "iPad" | "Apple Watch" | "AirPods" | "Accessory" | "Vision Pro" | "HomePod" | "Apple TV" | null,
  "family": string | null,
  "chip": string | null,
  "storage_gb": number | null,
  "ram_gb": number | null,
  "screen_size": string | null,
  "case_size": string | null,
  "color": string | null,
  "connectivity": "Wi-Fi" | "Wi-Fi + Cellular" | "GPS" | "GPS + Cellular" | null,
  "region": "Middle East" | "International" | null,
  "sim": "Dual eSIM" | "Nano SIM + eSIM" | "eSIM" | null,
  "sub_model": string | null,
  "charging": "Lightning" | "USB-C" | null,
  "case_material": "Titanium" | "Aluminum" | "Stainless Steel" | null,
  "year": number | null
}

Rules:
- HANDLE TYPOS: "iphon" / "aifon" / "ayfon" → iPhone. "mkbook" / "makbook" → MacBook. "airpod" → AirPods.
- HANDLE TRANSLITERATION: "ای فون" / "ايفون" / "آيفون" → iPhone. "ماك بوك" / "مک بوک" → MacBook.
- HANDLE IMPLICIT: "laptop" → Mac (MacBook). "phone" → iPhone. "tablet" → iPad. "watch" → Apple Watch.
- HANDLE FINGLISH: "meshki" → black. "sefid" → white. "takhfif" → discount_query. "gheymat" → shopping (price). "darid?" = "do you have?".
- HANDLE MIXED SCRIPT: Farsi+English ok. Arabic+English ok.
- "Pro Max" alone without category → iPhone Pro Max (most common).
- "Space Grey" / "Space Gray" → space gray (same colour).
- Storage: "256gb" → 256. "1tb" → 1024. "1 TB" → 1024. Bare "256" / "512" / "1tb" → storage if no other noun attached.
- "16gb ram" / "16gb memory" → ram_gb, NOT storage_gb.
- RETURN null for fields not in the message. Do not invent.
- If the message is clearly a confirmation ("yes", "ok", "بله", "درسته") → intent=confirmation.
- If the message asks for a link ("link", "send", "URL") → intent=link_request.
- If the message asks about discount/offer/sale → intent=discount_query.
- Short acknowledgements or greetings with NO product mention → intent=greeting.

Output JSON only. No prose, no markdown.`;

// Simple in-memory cache — msg_hash → extraction.
const _cache = new Map();
const CACHE_MAX = 500;

function hashMsg(msg) {
  return crypto.createHash('sha1').update(String(msg || '').trim().toLowerCase()).digest('hex');
}

export async function extractWithLLM(msg) {
  const trimmed = String(msg || '').trim();
  if (!trimmed) return null;
  const key = hashMsg(trimmed);
  const cached = _cache.get(key);
  if (cached) return cached;

  try {
    const res = await client.chat.completions.create({
      model: EXTRACTOR_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: trimmed.slice(0, 500) },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });
    const content = res.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      logger.warn({ content: content.slice(0, 200), err: String(e) }, 'llm-extractor JSON parse failed');
      return null;
    }
    // Cap cache size — simple FIFO eviction.
    if (_cache.size >= CACHE_MAX) {
      const first = _cache.keys().next().value;
      _cache.delete(first);
    }
    _cache.set(key, parsed);
    return parsed;
  } catch (err) {
    logger.warn({ err: String(err?.message || err), msg: trimmed.slice(0, 80) }, 'llm-extractor call failed');
    return null;
  }
}

// Merge an LLM extraction into a regex-derived state. The LLM wins on empty
// fields; regex wins on fields both filled (because regex is deterministic
// on exact matches). Returns a new state object.
export function mergeLLMIntoState(state, llmExtraction) {
  if (!llmExtraction) return state;
  const next = { ...state };
  const KEYS = [
    'category', 'family', 'chip', 'storage_gb', 'ram_gb', 'screen_size',
    'case_size', 'color', 'connectivity', 'region', 'sim', 'sub_model',
    'charging', 'case_material',
  ];
  for (const k of KEYS) {
    const llmVal = llmExtraction[k];
    if (next[k] == null && llmVal != null && llmVal !== '') {
      next[k] = llmVal;
    }
  }
  // Intent flags
  if (llmExtraction.intent === 'confirmation') next.confirmed = true;
  if (llmExtraction.intent === 'link_request') next.link_requested = true;
  // Track what the LLM inferred for transparency.
  next._llm_intent = llmExtraction.intent || null;
  return next;
}
