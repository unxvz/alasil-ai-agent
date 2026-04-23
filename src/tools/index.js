// Tool registry for the LLM agent.
// Each tool has:
//   - a JSON Schema (OpenAI "tools" param) that tells the LLM what args it takes
//   - an executor function that runs against our Shopify catalog / live search
//
// The agent (src/modules/agent.js) will let the LLM decide which tools to call,
// in what order, and with what arguments. The LLM synthesizes the final reply
// from the tool outputs.

import { getCatalog, matchesFilter, distinctValues, enrichProduct } from '../modules/catalog.js';
import { searchProducts as shopifyLiveSearch } from '../modules/shopify.js';
import { addCorrection } from '../modules/corrections.js';
import { webFetch, WEB_FETCH_KNOWN_TOPICS } from './web-fetch.js';
import { logger } from '../logger.js';

// ────────────────────────────────────────────────────────────────────────────
// Tool JSON Schemas (OpenAI function-calling format)
// ────────────────────────────────────────────────────────────────────────────
export const tools = [
  {
    type: 'function',
    function: {
      name: 'searchProducts',
      description:
        "Free-text search across the live Shopify catalog. Use when the customer describes what they want in natural language (e.g. 'iphone 16 pro 256 middle east', 'macbook for video editing', 'JBL speaker for pool party'). Handles typos and loose phrasing. Returns products currently in stock.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              "Search query — include the strongest keywords the customer used (model, chip, storage, color, region). Example: 'iphone 17 pro 256gb cosmic orange middle east'.",
          },
          limit: { type: 'number', description: 'Max results to return. Default 6.', default: 6 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'filterCatalog',
      description:
        "Precise filter over the cached catalog when you already know the customer's specs. Prefer this over searchProducts when you have structured attributes. Returns 0 if nothing matches — in that case RELAX one filter and retry (e.g. drop color, then region, then storage).",
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: [
              'iPhone',
              'iPad',
              'Mac',
              'AirPods',
              'Apple Watch',
              'Vision Pro',
              'HomePod',
              'Apple TV',
              'Display',
              'Speaker',
              'Headphones',
              'Earbuds',
              'Dyson',
              'Home Appliance',
              'Projector',
              'Gift Card',
              'Accessory',
            ],
          },
          model_key: {
            type: 'string',
            description:
              "PREFERRED over family for specific models. Canonical model identifier — isolates ONE sub-model, not the whole line. Examples: 'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17' (= standard variant only), 'iPhone Air', 'iPad Pro 13\\\" (M5)', 'iPad Air', 'MacBook Air 13\\\" (M5)', 'MacBook Pro 14\\\" (M5 Pro)', 'Apple Watch Series 11', 'Apple Watch Ultra 3', 'AirPods Pro 3'. Use this for 'what colors / storages / specs does X have' questions.",
          },
          family: {
            type: 'string',
            description:
              "Family groups ALL variants of a line together (iPhone 17 family includes Pro, Pro Max, Standard). Only use family when the customer really wants the whole line — otherwise prefer model_key.",
          },
          variant: {
            type: 'string',
            description: "iPhone variant: 'Pro', 'Pro Max', 'Plus', 'mini', 'Air', 'SE', 'Standard'.",
          },
          chip: {
            type: 'string',
            description: "Chip: 'M4', 'M4 Pro', 'M4 Max', 'M5', 'M5 Pro', 'A18 Pro', 'A19', 'A19 Pro'.",
          },
          storage_gb: { type: 'number', description: 'Storage in GB (128, 256, 512, 1024, 2048).' },
          ram_gb: { type: 'number', description: 'RAM/unified memory in GB (8, 16, 24, 32, 48, 64).' },
          screen_inch: { type: 'number', description: 'Screen size in inches (e.g. 11, 13, 14, 15, 16).' },
          color: { type: 'string' },
          region: { type: 'string', enum: ['Middle East', 'International'] },
          connectivity: { type: 'string', enum: ['Wi-Fi', 'Wi-Fi + Cellular'] },
          keyboard_layout: { type: 'string', enum: ['English', 'English/Arabic'] },
          max_price_aed: { type: 'number', description: 'Upper budget limit in AED.' },
          min_price_aed: { type: 'number', description: 'Lower budget limit in AED.' },
          min_ram_gb: { type: 'number', description: "Use when customer asks 'more RAM than X'." },
          min_storage_gb: { type: 'number', description: "Use when customer asks 'more storage than X'." },
          sort: {
            type: 'string',
            enum: ['price_asc', 'price_desc', 'ram_desc', 'storage_desc', 'screen_asc', 'screen_desc'],
            description:
              "Sort order. Use 'price_asc' for 'cheap / budget', 'ram_desc' for 'best performance', 'screen_asc' for 'portable / small', 'screen_desc' for 'large display'.",
          },
          limit: { type: 'number', default: 6 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browseMenu',
      description:
        "Step-by-step menu navigation — returns the next level of choices given what the customer has specified so far. Use this when the customer gives a broad hint ('iphone') and you need to walk them through the decision tree (model → storage → color → region). Returns a list of the next-level options that actually have in-stock SKUs. Much cleaner than raw searchProducts when the customer is still narrowing.",
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Top-level category, e.g. iPhone, iPad, Mac, Apple Watch.' },
          model_key: { type: 'string', description: 'Exact model line — "iPhone 17 Pro Max", "iPad Pro (M5)", "MacBook Air (M5)", "Apple Watch Series 11".' },
          storage_gb: { type: 'number' },
          color: { type: 'string' },
          region: { type: 'string', enum: ['Middle East', 'International'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getAvailableOptions',
      description:
        "List distinct in-stock values for one attribute, optionally narrowed by filters. Use for questions like 'what colors do you have for iPhone 17 Pro?' or 'what RAM options for MacBook Pro M4?' or 'what storage sizes for iPad Air?'.",
      parameters: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            enum: [
              'color',
              'storage_gb',
              'ram_gb',
              'chip',
              'screen_inch',
              'variant',
              'family',
              'region',
              'connectivity',
              'keyboard_layout',
            ],
          },
          filters: {
            type: 'object',
            description: "Optional filters to scope the question. PREFER model_key over family — family includes all variants (iPhone 17 Pro + Pro Max + Standard) which gives wrong counts. Example: for iPhone 17 standard colors use {model_key:'iPhone 17'}, for iPhone 17 Pro Max use {model_key:'iPhone 17 Pro Max'}.",
            properties: {
              category: { type: 'string' },
              model_key: { type: 'string', description: "Preferred — isolates one exact sub-model." },
              family: { type: 'string', description: "Legacy grouping across all variants of a line. Avoid unless you want the whole line." },
              variant: { type: 'string' },
              chip: { type: 'string' },
              storage_gb: { type: 'number' },
              ram_gb: { type: 'number' },
              screen_inch: { type: 'number' },
              region: { type: 'string' },
              color: { type: 'string' },
            },
          },
        },
        required: ['field'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getBySKU',
      description:
        "Exact SKU lookup. Use ONLY when the customer typed a clear Apple model number like 'MYMJ3AE/A' or 'MW2W3'. Do not use for general keywords.",
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string' },
        },
        required: ['sku'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getProductByTitle',
      description:
        "Fuzzy title lookup. Use when the customer pasted a product name or URL handle (e.g. 'AirPods 4 with ANC', 'iPhone 17 Pro Max 512GB Deep Blue'). Use for product title recognition in an 'assistance with ... | alAsil' pattern too.",
      parameters: {
        type: 'object',
        properties: {
          title_query: { type: 'string' },
          limit: { type: 'number', default: 6 },
        },
        required: ['title_query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webFetch',
      description:
        "Fetch an Apple reference page to verify a spec or compatibility fact that isn't covered in APPLE PRODUCT SPECS. Only fetches from a short allow-list: apple.com (incl. /ae/), support.apple.com, developer.apple.com, theapplewiki.com, gsmarena.com. Pass EITHER a full url OR a known topic shortcut. Results are cached for 24h. Use this sparingly — prefer the pre-loaded APPLE PRODUCT SPECS block when the fact is there.",
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              "Full URL on an allowed host. Example: 'https://support.apple.com/en-ae/108233'. Leave blank if using `topic`.",
          },
          topic: {
            type: 'string',
            description: 'Known-topic shortcut — preferred over raw URL for common questions.',
            enum: WEB_FETCH_KNOWN_TOPICS,
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'saveCorrection',
      description:
        "Save a permanent correction AFTER you have verified (via another tool call or the knowledge base) that your previous reply was factually wrong and the customer is right. The correction is stored and injected into EVERY future agent system prompt, so the next time any customer asks the same question, the fix is automatic. Only call this when the customer's disagreement has been verified. Do NOT call it if the bot was actually correct.",
      parameters: {
        type: 'object',
        properties: {
          original_customer_message: {
            type: 'string',
            description: "The customer's ORIGINAL question (from conversation_history) that got the wrong reply — not their current disagreement message.",
          },
          wrong_reply: {
            type: 'string',
            description: "The bot's previous reply that was factually wrong (from conversation_history).",
          },
          correct_reply: {
            type: 'string',
            description: "The correct reply the bot SHOULD have given — concise, plain text, in the same language/tone you'll send to the customer.",
          },
          note: {
            type: 'string',
            description: "Optional one-line explanation of what was wrong and how you verified it (e.g. 'verified via getAvailableOptions that iPhone 17 color list includes Cosmic Orange').",
          },
        },
        required: ['original_customer_message', 'correct_reply'],
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Executor
// ────────────────────────────────────────────────────────────────────────────
export async function executeTool(name, args) {
  const t0 = Date.now();
  try {
    let result;
    switch (name) {
      case 'searchProducts':
        result = await tool_searchProducts(args || {});
        break;
      case 'filterCatalog':
        result = await tool_filterCatalog(args || {});
        break;
      case 'getAvailableOptions':
        result = await tool_getAvailableOptions(args || {});
        break;
      case 'getBySKU':
        result = await tool_getBySKU(args || {});
        break;
      case 'getProductByTitle':
        result = await tool_getProductByTitle(args || {});
        break;
      case 'saveCorrection':
        result = await tool_saveCorrection(args || {});
        break;
      case 'webFetch':
        result = await webFetch(args || {});
        break;
      case 'browseMenu':
        result = await tool_browseMenu(args || {});
        break;
      default:
        return { error: `Unknown tool: ${name}` };
    }
    logger.info(
      { tool: name, args, ms: Date.now() - t0, count: result?.products?.length ?? result?.values?.length ?? 0 },
      'tool call'
    );
    return result;
  } catch (err) {
    logger.warn({ err: String(err?.message || err), tool: name, args }, 'tool execution failed');
    return { error: String(err?.message || err) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function briefProduct(p) {
  return {
    sku: p.sku,
    title: p.title,
    price_aed: Number.isFinite(p.price_aed) ? Number(p.price_aed) : null,
    was_aed:
      p.compare_at_aed !== null && p.compare_at_aed !== undefined ? Number(p.compare_at_aed) : null,
    in_stock: p.in_stock,
    category: p.category,
    family: p.family,
    model_key: p.model_key,
    variant: p.variant,
    chip: p.chip,
    storage_gb: p.storage_gb,
    ram_gb: p.ram_gb,
    screen_inch: p.screen_inch,
    color: p.color,
    material: p.material,
    year: p.year,
    generation: p.generation,
    region: p.region,
    sim: p.sim,
    connectivity: p.connectivity,
    keyboard_layout: p.keyboard_layout,
    category_path: p.category_path,
    url: p.url,
  };
}

function applySort(list, sort) {
  const out = [...list];
  switch (sort) {
    case 'price_asc':
      out.sort((a, b) => (a.price_aed || 0) - (b.price_aed || 0));
      break;
    case 'price_desc':
      out.sort((a, b) => (b.price_aed || 0) - (a.price_aed || 0));
      break;
    case 'ram_desc':
      out.sort((a, b) => (b.ram_gb || 0) - (a.ram_gb || 0) || (a.price_aed || 0) - (b.price_aed || 0));
      break;
    case 'storage_desc':
      out.sort(
        (a, b) => (b.storage_gb || 0) - (a.storage_gb || 0) || (a.price_aed || 0) - (b.price_aed || 0)
      );
      break;
    case 'screen_asc':
      out.sort((a, b) => (a.screen_inch || 99) - (b.screen_inch || 99));
      break;
    case 'screen_desc':
      out.sort((a, b) => (b.screen_inch || 0) - (a.screen_inch || 0));
      break;
    default:
      out.sort((a, b) => (a.price_aed || 0) - (b.price_aed || 0));
  }
  return out;
}

function diversify(products, limit) {
  const seen = new Map();
  for (const p of products) {
    const k = [p.family || '', p.variant || '', p.chip || '', p.storage_gb || ''].join('|');
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(p);
  }
  const buckets = Array.from(seen.values());
  const out = [];
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    for (const list of buckets) {
      if (out.length >= limit) break;
      if (list.length) {
        out.push(list.shift());
        progressed = true;
      }
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Tool implementations
// ────────────────────────────────────────────────────────────────────────────
// Weak tokens = no-signal words that shouldn't be required in the title match.
// Keep this list TIGHT — anything that actually narrows the catalog (variant,
// chip, storage, color, brand, family) must stay OUT of this list.
const WEAK_QUERY_TOKENS = new Set([
  // English stopwords
  'a', 'an', 'the', 'is', 'are', 'i', 'we', 'you', 'please', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'have', 'has', 'got', 'want', 'need', 'like', 'would', 'could', 'should', 'do', 'does', 'can', 'will', 'may',
  'me', 'my', 'our', 'your', 'some', 'any', 'new', 'old', 'latest', 'newest', 'best', 'cheap', 'cheapest', 'good',
  // Locations/common context
  'ae', 'uae', 'dubai', 'abu', 'dhabi', 'emirates', 'ksa', 'saudi',
  // Units (when they appear alone)
  'gb', 'tb', 'mm', 'inch', 'inches',
  // Generic filler brand that matches too much
  'apple',
  // Finglish filler words
  'mikham', 'mikhay', 'mishe', 'nemishe', 'mojoud', 'mojoude', 'hast', 'hastesh', 'hastid', 'darid', 'daryad',
  'mibinam', 'khob', 'lotfan', 'az', 'baraye', 'ye', 'yek', 'ta', 'al', 'alan', 'chand', 'chandeh',
  'gheymat', 'gheymatesh', 'mikhastam', 'bebinam', 'komak', 'chetor', 'chejori', 'chia', 'chish', 'chizi',
  'man', 'shoma', 'shomaro', 'lotf', 'salam', 'sss', 'mersi', 'merci',
]);

// Strong anchor tokens — used for category inference in search ranking.
const STRONG_ANCHORS = /\b(iphone|ipad|macbook|imac|airpods?|airtag|airpod|pencil|magic|apple\s*watch|apple\s*tv|homepod|vision|mac\s*mini|mac\s*studio|studio\s*display|pro\s*display|dyson|airwrap|supersonic|corrale|jbl|bose|sony|harman|beats|shokz|ninja|cosori|formovie|ultra|series|ipod)\b/i;

// If the query mentions a primary product category (e.g. "iphone"), rank that
// category ahead of Accessory matches. Without this, "iphone 17" ranks iPhone 17
// Clear Case ahead of the actual phones because the accessory is cheaper.
function detectPreferredCategory(q) {
  const s = String(q || '').toLowerCase();
  // Accessory intent words — if customer asked for an accessory, DON'T override.
  if (/\b(case|cover|band|strap|loop|cable|charger|adapter|screen\s*protector|tempered\s*glass|magsafe\s*(charger|wallet)|folio|pencil|magic\s*(keyboard|mouse|trackpad)|airtag|dock|stand)\b/.test(s)) {
    return null;
  }
  if (/\b(iphone)\b/.test(s)) return 'iPhone';
  if (/\bipad\b/.test(s)) return 'iPad';
  if (/\b(macbook|imac|mac\s*(mini|studio))\b/.test(s)) return 'Mac';
  if (/\bairpods?\b/.test(s)) return 'AirPods';
  if (/\bapple\s*watch\b/.test(s)) return 'Apple Watch';
  if (/\bvision\s*pro\b/.test(s)) return 'Vision Pro';
  if (/\bhomepod\b/.test(s)) return 'HomePod';
  if (/\bapple\s*tv\b/.test(s)) return 'Apple TV';
  if (/\b(studio|pro)\s*display\b/.test(s)) return 'Display';
  if (/\b(jbl|bose|sony|harman|beats|shokz)\b/.test(s)) {
    if (/\b(speaker|boombox|flip|charge|go|clip|xtreme|partybox|soundlink|soundbar|pulse)\b/.test(s)) return 'Speaker';
    if (/\b(earbud|buds|tune\s*flex|free\s*earbuds|wf-|studio\s*buds|fit\s*pro)\b/.test(s)) return 'Earbuds';
    if (/\b(headphone|over[-\s]?ear|studio\s*pro|quietcomfort(?!\s*earbuds)|wh-)\b/.test(s)) return 'Headphones';
  }
  if (/\bdyson\b/.test(s)) return 'Dyson';
  return null;
}

function tokenizeQuery(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    // Keep any non-empty token; single-digit tokens matter for generations
    // (e.g. "AirPods Pro 3", "Apple Watch Series 11", "iPhone 17").
    .filter((t) => t.length >= 1 && t !== '');
}

function strongTokens(q) {
  return tokenizeQuery(q).filter((t) => !WEAK_QUERY_TOKENS.has(t));
}

// True if the product title covers enough of the query's strong tokens.
function titleCoversQuery(title, queryTokens) {
  const tLower = String(title || '').toLowerCase();
  if (queryTokens.length === 0) return true;
  let hits = 0;
  for (const t of queryTokens) if (tLower.includes(t)) hits++;
  const threshold = Math.max(1, Math.ceil(queryTokens.length * 0.6));
  return hits >= threshold;
}

async function tool_searchProducts({ query, limit = 6 }) {
  const q = String(query || '').trim();
  if (!q) return { products: [], count: 0, error: 'empty query' };
  const cap = Math.min(20, Math.max(1, Number(limit) || 6));

  const qStrongTokens = strongTokens(q);

  // Score-by-title: how many strong query tokens appear in the product title.
  const scoreTitle = (p) => {
    if (qStrongTokens.length === 0) return 1;
    const t = String(p.title || '').toLowerCase();
    let s = 0;
    for (const tok of qStrongTokens) if (t.includes(tok)) s++;
    return s;
  };

  const threshold =
    qStrongTokens.length >= 2 ? Math.max(2, Math.ceil(qStrongTokens.length * 0.6)) : Math.max(1, qStrongTokens.length);

  // 1) Live Shopify search — freshest stock, but loose relevance.
  let liveResults = [];
  try {
    const raw = await shopifyLiveSearch(q, { limit: Math.min(30, cap * 4) });
    liveResults = raw
      .map(enrichProduct)
      .filter((p) => p.in_stock !== false)
      .filter((p) => scoreTitle(p) >= threshold);
  } catch (err) {
    logger.warn({ err: String(err?.message || err), q }, 'live search failed, using catalog only');
  }

  // 2) Catalog keyword scan — handles cases where Shopify's relevance misses the
  //    exact product (e.g. "AirPods Pro 3" doesn't appear in Shopify's top-30 for
  //    the query "airpods pro 3").
  const catalog = await getCatalog();
  const catalogResults = [];
  for (const p of catalog) {
    if (p.in_stock === false) continue;
    if (scoreTitle(p) >= threshold) catalogResults.push(p);
  }

  // 3) Union by SKU (preserve both sources, dedupe).
  const bySku = new Map();
  for (const p of liveResults) bySku.set(String(p.sku || p.id || p.handle), p);
  for (const p of catalogResults) {
    const k = String(p.sku || p.id || p.handle);
    if (!bySku.has(k)) bySku.set(k, p);
  }
  let merged = Array.from(bySku.values());

  // 4) Sort by:
  //    - title-coverage desc (most tokens matched wins)
  //    - preferred category (if the query names a primary category, boost it over Accessory)
  //    - price asc
  //
  //    Without the category boost, searching "iphone 17" surfaces "iPhone 17 Clear
  //    Case" before any actual phone because the accessory is cheaper and has the
  //    same tokens. We want the PRIMARY product first.
  const preferredCategory = detectPreferredCategory(q);
  const categoryRank = (p) => {
    if (!preferredCategory) return 0;
    if (p.category === preferredCategory) return 0;
    if (p.category === 'Accessory') return 2;
    return 1;
  };
  merged.sort(
    (a, b) =>
      scoreTitle(b) - scoreTitle(a) ||
      categoryRank(a) - categoryRank(b) ||
      (a.price_aed || 0) - (b.price_aed || 0)
  );

  const diverse = diversify(merged, cap);
  return {
    products: diverse.map(briefProduct),
    count: merged.length,
  };
}

async function tool_filterCatalog(args = {}) {
  const {
    max_price_aed,
    min_price_aed,
    min_ram_gb,
    min_storage_gb,
    sort,
    limit = 6,
    ...filterFields
  } = args;

  // Strip empty strings so matchesFilter doesn't over-restrict.
  for (const k of Object.keys(filterFields)) {
    const v = filterFields[k];
    if (v === '' || v === null || v === undefined) delete filterFields[k];
  }

  const catalog = await getCatalog();
  let hits = catalog.filter((p) => matchesFilter(p, filterFields));

  if (Number.isFinite(max_price_aed)) {
    hits = hits.filter((p) => Number.isFinite(p.price_aed) && p.price_aed <= max_price_aed);
  }
  if (Number.isFinite(min_price_aed)) {
    hits = hits.filter((p) => Number.isFinite(p.price_aed) && p.price_aed >= min_price_aed);
  }
  if (Number.isFinite(min_ram_gb)) {
    hits = hits.filter((p) => (p.ram_gb || 0) >= min_ram_gb);
  }
  if (Number.isFinite(min_storage_gb)) {
    hits = hits.filter((p) => (p.storage_gb || 0) >= min_storage_gb);
  }

  const sorted = applySort(hits, sort || 'price_asc');
  const cap = Math.min(20, Math.max(1, Number(limit) || 6));
  const diverse = diversify(sorted, cap);

  return {
    products: diverse.map(briefProduct),
    count: hits.length,
    applied_filters: { ...filterFields, max_price_aed, min_price_aed, min_ram_gb, min_storage_gb, sort },
  };
}

async function tool_getAvailableOptions({ field, filters = {} }) {
  if (!field) return { error: 'field is required' };
  const cleanFilters = {};
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === '' || v === null || v === undefined) continue;
    cleanFilters[k] = v;
  }
  const values = await distinctValues(field, cleanFilters);
  return { field, filters: cleanFilters, values };
}

async function tool_getBySKU({ sku }) {
  const needle = String(sku || '').toLowerCase().trim();
  if (!needle) return { products: [], count: 0 };
  const catalog = await getCatalog();
  const matches = catalog.filter((p) => String(p.sku || '').toLowerCase() === needle);
  return {
    products: matches.map(briefProduct),
    count: matches.length,
  };
}

// Menu browser — given what the customer has chosen so far, return the next
// level's available options. Drives a clean "pick → narrow → pick" flow so
// classifications never get mixed up (see owner request).
async function tool_browseMenu(args = {}) {
  const { category, model_key, storage_gb, color, region } = args;
  const catalog = await getCatalog();
  const inStock = catalog.filter((p) => p.in_stock !== false);

  // No input at all → return categories
  if (!category) {
    const categories = new Map();
    for (const p of inStock) {
      if (!p.category) continue;
      categories.set(p.category, (categories.get(p.category) || 0) + 1);
    }
    return {
      level: 'category',
      options: [...categories.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ value: name, count })),
      next_level: 'model_key',
      hint: 'Ask the customer which category they want.',
    };
  }

  // Filter by category
  let scoped = inStock.filter((p) => p.category === category);

  // No model_key yet → return available model keys
  if (!model_key) {
    const models = new Map();
    for (const p of scoped) {
      if (!p.model_key) continue;
      if (!models.has(p.model_key)) models.set(p.model_key, { count: 0, prices: [] });
      const m = models.get(p.model_key);
      m.count++;
      if (Number.isFinite(p.price_aed)) m.prices.push(p.price_aed);
    }
    return {
      level: 'model_key',
      category,
      options: [...models.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, info]) => ({
          value: name,
          count: info.count,
          from_aed: info.prices.length ? Math.min(...info.prices) : null,
        })),
      next_level: 'storage_gb',
      hint: 'Offer the customer the available models for this category.',
    };
  }

  // Filter by model_key
  scoped = scoped.filter((p) => p.model_key === model_key);
  if (scoped.length === 0) {
    return { level: 'empty', category, model_key, options: [], hint: `No in-stock items for ${model_key}.` };
  }

  // No storage yet → return storages (only if they vary)
  if (!storage_gb) {
    const storages = new Map();
    for (const p of scoped) {
      if (!p.storage_gb) continue;
      if (!storages.has(p.storage_gb)) storages.set(p.storage_gb, { count: 0, prices: [] });
      const s = storages.get(p.storage_gb);
      s.count++;
      if (Number.isFinite(p.price_aed)) s.prices.push(p.price_aed);
    }
    if (storages.size > 1) {
      return {
        level: 'storage_gb',
        category,
        model_key,
        options: [...storages.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([gb, info]) => ({
            value: gb,
            label: gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`,
            count: info.count,
            from_aed: info.prices.length ? Math.min(...info.prices) : null,
          })),
        next_level: 'color',
      };
    }
  } else {
    scoped = scoped.filter((p) => p.storage_gb === storage_gb);
  }

  // No color yet → return colors
  if (!color) {
    const colors = new Map();
    for (const p of scoped) {
      if (!p.color) continue;
      if (!colors.has(p.color)) colors.set(p.color, 0);
      colors.set(p.color, colors.get(p.color) + 1);
    }
    if (colors.size > 0) {
      return {
        level: 'color',
        category,
        model_key,
        storage_gb,
        options: [...colors.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ value: name, count })),
        next_level: 'region',
      };
    }
  } else {
    scoped = scoped.filter((p) => p.color === color);
  }

  // Region next, if multiple exist
  if (!region) {
    const regions = new Map();
    for (const p of scoped) {
      const r = p.region || 'Standard';
      regions.set(r, (regions.get(r) || 0) + 1);
    }
    if (regions.size > 1) {
      return {
        level: 'region',
        category,
        model_key,
        storage_gb,
        color,
        options: [...regions.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ value: name, count })),
        next_level: 'done',
      };
    }
  } else {
    scoped = scoped.filter((p) => (p.region || 'Standard') === region);
  }

  // At this point we should be at a single SKU or a small leaf set
  return {
    level: 'done',
    category,
    model_key,
    storage_gb,
    color,
    region,
    products: scoped.slice(0, 10).map(briefProduct),
    count: scoped.length,
  };
}

async function tool_saveCorrection({ original_customer_message, wrong_reply, correct_reply, note }) {
  if (!original_customer_message || !correct_reply) {
    return { error: 'original_customer_message and correct_reply are required' };
  }
  try {
    const row = addCorrection({
      user_msg: original_customer_message,
      wrong_reply: wrong_reply || '',
      correct_reply,
      note: note ? 'auto-learned from customer feedback: ' + note : 'auto-learned from customer feedback',
    });
    logger.info({ id: row.id, user_msg: row.user_msg.slice(0, 80) }, 'customer-confirmed correction saved');
    return { ok: true, id: row.id };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

async function tool_getProductByTitle({ title_query, limit = 6 }) {
  const q = String(title_query || '').toLowerCase().trim();
  if (!q) return { products: [], count: 0 };
  const tokens = q
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return { products: [], count: 0 };

  const catalog = await getCatalog();
  const scored = [];
  for (const p of catalog) {
    if (p.in_stock === false) continue;
    const title = String(p.title || '').toLowerCase();
    const handle = String(p.handle || '').toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 2;
      else if (handle.includes(t)) score += 1;
    }
    const threshold = Math.max(3, Math.ceil(tokens.length * 0.7));
    if (score >= threshold) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.p.price_aed || 0) - (b.p.price_aed || 0));
  const cap = Math.min(10, Math.max(1, Number(limit) || 6));
  return {
    products: scored.slice(0, cap).map((x) => briefProduct(x.p)),
    count: scored.length,
  };
}
