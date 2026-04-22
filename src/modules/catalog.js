import { config } from '../config.js';
import { logger } from '../logger.js';
import { fetchAllProducts } from './shopify.js';

let _cache = null;
let _loadedAt = 0;
let _inflight = null;

const TTL_MS = config.SHOPIFY_CACHE_TTL_SECONDS * 1000;

export async function getCatalog({ refresh = false } = {}) {
  const now = Date.now();
  if (!refresh && _cache && now - _loadedAt < TTL_MS) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const raw = await fetchAllProducts();
      const enriched = raw.map(_enrichProduct);
      _cache = enriched;
      _loadedAt = Date.now();
      logger.info({ count: enriched.length }, 'Shopify catalog loaded');
      return enriched;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export async function refreshCatalog() {
  return getCatalog({ refresh: true });
}

export function catalogStatus() {
  return {
    loaded:    Boolean(_cache),
    count:     _cache ? _cache.length : 0,
    loaded_at: _loadedAt || null,
    age_ms:    _loadedAt ? Date.now() - _loadedAt : null,
    ttl_ms:    TTL_MS,
  };
}

export function enrichProduct(p) {
  return _enrichProduct(p);
}

function _enrichProduct(p) {
  const title = p.title || '';
  const norm = normalizeTitle(title);
  const tagsText = Array.isArray(p.tags) ? p.tags.join(' ') : '';
  const category = detectCategory(norm, p.productType, p.tags);
  const family = detectFamily(norm, category);
  const variant = detectVariant(norm, category);
  const chip = detectChip(norm) || detectChip(tagsText) || detectChip(String(p.productType || ''));
  const storage_gb = detectStorage(norm);
  const ram_gb = detectRam(norm);
  const screen_inch = detectScreen(norm);
  const rawColor = detectColor(title);
  const region = detectRegion(norm);
  const sim = detectSim(norm);
  const keyboard_layout = detectKeyboard(norm);
  const connectivity = detectConnectivity(norm);
  const model =
    category === 'iPhone' ? detectIphoneModel(norm)
    : category === 'Mac'  ? chip
    : null;

  // New fields
  const material = detectMaterial(category, family);
  const year = detectYear(category, family, chip);
  const generation = detectGeneration(category, family, variant);
  const color = normalizeColor(rawColor, material);

  // Canonical model_key: a stable "which exact phone model is this" label.
  // Customer can ask for any of these and the bot knows what to filter on.
  // For iPhone: "iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17", "iPhone Air", "iPhone 17e"
  // For iPad: "iPad Pro (M5)", "iPad Air (M4)", "iPad mini (A17 Pro)", "iPad (A16)"
  // For Mac: "MacBook Air (M5)", "MacBook Pro 14 (M5 Pro)", etc.
  // For Apple Watch: "Apple Watch Series 11", "Apple Watch Ultra 3", etc.
  const model_key = buildModelKey({ category, family, variant, chip, screen_inch });

  // Canonical category_path: "iPhone > iPhone 17 Pro Max > 256GB > Deep Blue"
  // Gives LLM a deterministic breadcrumb so it can map any customer phrase
  // to exactly one product group.
  const category_path = buildCategoryPath({ category, model_key, storage_gb, color, region });

  return {
    ...p,
    category,
    family,
    model,
    model_key,
    variant,
    chip,
    storage_gb,
    ram_gb,
    screen_inch,
    color,
    raw_color: rawColor,
    region,
    sim,
    keyboard_layout,
    connectivity,
    material,
    year,
    generation,
    category_path,
    features: { storage_gb, ram_gb, screen_inch },
  };
}

// Build a human-readable "model_key" that uniquely identifies the phone/ipad/mac/watch
// line, separate from variants-within-line (storage, color, region, etc).
function buildModelKey({ category, family, variant, chip, screen_inch }) {
  if (!family) return null;
  if (category === 'iPhone') {
    // Merge family + variant — "iPhone 17" + "Pro Max" → "iPhone 17 Pro Max"
    if (!variant || variant === 'Standard' || variant === 'Air') return family;
    return `${family} ${variant}`;
  }
  if (category === 'iPad') {
    if (chip) return `${family} (${chip})`;
    return family;
  }
  if (category === 'Mac') {
    if (screen_inch && chip) return `${family} ${screen_inch}" (${chip})`;
    if (chip) return `${family} (${chip})`;
    return family;
  }
  if (category === 'Apple Watch') {
    return family; // e.g. "Apple Watch Series 11"
  }
  if (category === 'AirPods') {
    return family; // "AirPods 4", "AirPods Pro 3", etc.
  }
  return family;
}

function buildCategoryPath({ category, model_key, storage_gb, color, region }) {
  const parts = [];
  if (category) parts.push(category);
  if (model_key && model_key !== category) parts.push(model_key);
  if (storage_gb) {
    parts.push(storage_gb >= 1024 ? `${Math.round(storage_gb / 1024)}TB` : `${storage_gb}GB`);
  }
  if (color) parts.push(color);
  if (region) parts.push(region);
  return parts.join(' > ');
}

// Normalize color names so catalog strings like "Deep Blue Titanium" (inherited
// from iPhone 15/16 Pro legacy titling) get reduced to "Deep Blue" when the
// phone body is actually aluminum. Keeps the raw value available via raw_color.
function normalizeColor(raw, material) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Strip a trailing material suffix if it disagrees with the actual material.
  // We do this conservatively — only strip "Titanium"/"Aluminum"/"Ceramic" when
  // the product's detected material is DIFFERENT or UNKNOWN, to avoid breaking
  // colors whose proper name includes the material (e.g. "Natural Titanium"
  // on iPhone 15/16 Pro, where the body really is titanium).
  const suffix = /\s+(Titanium|Aluminum|Aluminium|Ceramic)\s*$/i;
  const hasSuffix = suffix.test(s);
  if (!hasSuffix) return s;
  const claimed = s.match(suffix)[1].toLowerCase();
  if (material && material !== claimed) {
    return s.replace(suffix, '').trim();
  }
  return s;
}

// Body material by product family. When Apple changes materials between
// generations (iPhone 15/16 Pro = titanium; iPhone 17 Pro = back to aluminum),
// this lets the bot correct misleading product titles.
function detectMaterial(category, family) {
  if (category === 'iPhone') {
    // iPhone 17 Pro / Pro Max: aluminum unibody
    if (/iPhone\s*17(\s*Pro(\s*Max)?)?$/i.test(family || '')) return 'aluminum';
    // iPhone 17 standard: aluminum
    if (/^iPhone\s*17$/i.test(family || '')) return 'aluminum';
    // iPhone Air: titanium
    if (/iPhone\s*Air/i.test(family || '')) return 'titanium';
    // iPhone 17e: aluminum
    if (/iPhone\s*17e/i.test(family || '')) return 'aluminum';
    // iPhone 16 Pro / 15 Pro: titanium
    if (/iPhone\s*(15|16)\s*Pro/i.test(family || '')) return 'titanium';
    // iPhone 16 / 15 standard: aluminum
    if (/iPhone\s*(15|16)$/i.test(family || '')) return 'aluminum';
    return null;
  }
  if (category === 'Apple Watch') {
    if (/Ultra/i.test(family || '')) return 'titanium';
    if (/Series\s*11/i.test(family || '')) return 'aluminum'; // also titanium option — noted in specs
    return null;
  }
  if (category === 'iPad') {
    return 'aluminum'; // all current iPads
  }
  if (category === 'Mac') {
    return 'aluminum';
  }
  return null;
}

// Release year by family or chip, best-effort.
function detectYear(category, family, chip) {
  const fam = String(family || '');
  const ch = String(chip || '');
  if (category === 'iPhone') {
    if (/iPhone\s*17(?:\s*Pro)?/i.test(fam) || /iPhone\s*Air/i.test(fam)) return 2025;
    if (/iPhone\s*17e/i.test(fam)) return 2026;
    if (/iPhone\s*16/i.test(fam)) return 2024;
    if (/iPhone\s*15/i.test(fam)) return 2023;
    if (/iPhone\s*14/i.test(fam)) return 2022;
    if (/iPhone\s*13/i.test(fam)) return 2021;
  }
  if (category === 'iPad') {
    if (/iPad\s*Pro/i.test(fam) && /M5/i.test(ch)) return 2025;
    if (/iPad\s*Pro/i.test(fam) && /M4/i.test(ch)) return 2024;
    if (/iPad\s*Air/i.test(fam) && /M4/i.test(ch)) return 2026;
    if (/iPad\s*Air/i.test(fam) && /M3/i.test(ch)) return 2025;
    if (/iPad\s*Air/i.test(fam) && /M2/i.test(ch)) return 2024;
    if (/iPad\s*mini/i.test(fam)) return 2024;
  }
  if (category === 'Mac') {
    if (/M5/i.test(ch)) return 2026;
    if (/M4/i.test(ch)) return 2024;
    if (/M3/i.test(ch)) return 2023;
    if (/M2/i.test(ch)) return 2022;
    if (/M1/i.test(ch)) return 2020;
  }
  if (category === 'Apple Watch') {
    if (/Series\s*11|Ultra\s*3|SE\s*3/i.test(fam)) return 2025;
    if (/Series\s*10|Ultra\s*2/i.test(fam)) return 2024;
  }
  return null;
}

// Generation — usually the number in the family name (e.g. "iPhone 17" → "17").
function detectGeneration(category, family, variant) {
  const fam = String(family || '');
  if (category === 'iPhone') {
    const m = fam.match(/iPhone\s*(\d{1,2})e?/i);
    if (m) return m[1] + (fam.endsWith('e') ? 'e' : '');
    if (/iPhone\s*Air/i.test(fam)) return 'Air';
    if (/iPhone\s*SE/i.test(fam)) return 'SE';
  }
  if (category === 'Apple Watch') {
    const m = fam.match(/(Series|SE|Ultra)\s*(\d+)/i);
    if (m) return `${m[1]} ${m[2]}`;
  }
  if (category === 'AirPods') {
    const m = fam.match(/AirPods\s*(?:Pro|Max)?\s*(\d+)/i);
    if (m) return m[1];
  }
  return null;
}

function normalizeTitle(t) {
  return String(t || '')
    .replace(/[–—]/g, '-')
    .replace(/[‑‐‒]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const ACCESSORY_TITLE_WORDS = /\b(screen\s*protector|bumper|case|cover|sleeve|stand|charger|cable|adapter|pencil|airtag|magic\s*(mouse|keyboard|trackpad)|smart\s*folio|smart\s*cover|magsafe|power\s*adapter|earpods\b|earphones|earbuds|airpod\s*case|sport\s*band|woven\s*band|alpine\s*loop|milanese\s*loop|solo\s*loop|braided\s*loop|vesa\s*mount|dock|hub|grip|kickstand|pop\s*socket|lanyard|beats\s+.*\s+case|tempered\s*glass)\b/i;

const PRODUCT_TYPE_TO_CATEGORY = {
  'iphone': 'iPhone',
  'ipad': 'iPad', 'ipad air': 'iPad', 'ipad pro': 'iPad', 'ipad mini': 'iPad',
  'macbook air': 'Mac', 'macbook pro': 'Mac', 'macbook neo': 'Mac', 'mac studio': 'Mac', 'mac mini': 'Mac', 'imac': 'Mac',
  'airpods': 'AirPods', 'earpods': 'Accessory',
  'apple watch': 'Apple Watch',
  'vision pro': 'Vision Pro',
  'apple tv': 'Apple TV',
  'display': 'Display', 'studio pro': 'Display',
  'speaker': 'Speaker',
  'headphone': 'Headphones', 'headphones': 'Headphones',
  'earbuds': 'Earbuds', 'studio buds': 'Earbuds', 'fit pro': 'Earbuds', 'power beats': 'Earbuds',
  'solo': 'Headphones', 'flex': 'Earbuds',
  'dyson': 'Dyson',
  'air fryer': 'Home Appliance',
  'projector': 'Projector',
  'gift card': 'Gift Card',
  'accessories': 'Accessory',
};

function detectCategory(title, productType, tags) {
  const tagText = Array.isArray(tags) ? tags.join(' ') : '';
  const pt = String(productType || '').toLowerCase().trim();

  const startsWith = (re) => re.test(title);
  const hasAccWord = ACCESSORY_TITLE_WORDS.test(title);

  if (startsWith(/^\s*apple\s*watch\b/i))           return 'Apple Watch';
  if (startsWith(/^\s*airpods\b/i)) {
    if (hasAccWord) return 'Accessory';
    return 'AirPods';
  }
  if (startsWith(/^\s*homepod\b/i))                 return 'HomePod';
  if (startsWith(/^\s*(apple\s*)?vision\s*pro\b/i)) return 'Vision Pro';
  if (startsWith(/^\s*apple\s*tv\b/i))              return 'Apple TV';
  if (startsWith(/^\s*(studio|pro)\s*display\b/i))  return 'Display';

  if (pt && PRODUCT_TYPE_TO_CATEGORY[pt]) {
    const cat = PRODUCT_TYPE_TO_CATEGORY[pt];
    const primaryAudioVideo = ['Speaker', 'Headphones', 'Earbuds', 'Apple Watch', 'AirPods', 'Vision Pro', 'Apple TV', 'Display', 'HomePod'];
    if (primaryAudioVideo.includes(cat)) return cat;
    if (cat !== 'Accessory' && cat !== 'Gift Card' && ACCESSORY_TITLE_WORDS.test(title)) {
      return 'Accessory';
    }
    return cat;
  }

  if (hasAccWord) return 'Accessory';

  if (startsWith(/^\s*ipad\b/i))                    return 'iPad';
  if (startsWith(/^\s*iphone\b/i))                  return 'iPhone';
  if (startsWith(/^\s*(macbook|mac\s*mini|mac\s*studio|imac)\b/i)) return 'Mac';
  if (startsWith(/^\s*(apple\s*)?vision\s*pro\b/i)) return 'Vision Pro';
  if (startsWith(/^\s*homepod\b/i))                 return 'HomePod';
  if (startsWith(/^\s*apple\s*tv\b/i))              return 'Apple TV';
  if (startsWith(/^\s*(studio|pro)\s*display\b/i))  return 'Display';
  if (startsWith(/^\s*(jbl|bose|sony|harman\s*kardon|beats|shokz)\b/i)) {
    if (/\b(speaker|boombox|pulse|flip|charge|go|clip|xtreme|partybox|soundlink|soundbar)\b/i.test(title)) return 'Speaker';
    if (/\b(earbud|buds|tws|tune\s*flex|quietcomfort\s*earbuds|free\s*earbuds|wf-)\b/i.test(title)) return 'Earbuds';
    if (/\b(headphone|over[-\s]?ear|studio\s*pro|quietcomfort(?!\s*earbuds)|wh-)\b/i.test(title)) return 'Headphones';
    if (/\b(playstation|controller|dualsense|game|cable|remote|mic|microphone)\b/i.test(title)) return 'Accessory';
    if (ACCESSORY_TITLE_WORDS.test(title)) return 'Accessory';
    return 'Accessory';
  }
  if (startsWith(/^\s*dyson\b/i)) return 'Dyson';
  if (startsWith(/^\s*(ninja|instant|cosori)\b/i)) return 'Home Appliance';
  if (startsWith(/^\s*formovie\b/i)) return 'Projector';

  if (/\biphone\b/i.test(title))                 return 'iPhone';
  if (/\bipad\b/i.test(title))                   return 'iPad';
  if (/\b(macbook|mac\s*mini|mac\s*studio|imac)\b/i.test(title)) return 'Mac';
  if (/\bairpods\b/i.test(title))                return 'AirPods';
  if (/\bapple\s*watch\b/i.test(title))          return 'Apple Watch';

  const allText = `${title} ${pt} ${tagText}`;
  if (/\biphone\b/i.test(allText))                 return 'iPhone';
  if (/\bipad\b/i.test(allText))                   return 'iPad';
  if (/\b(macbook|mac\s*mini|mac\s*studio|imac)\b/i.test(allText)) return 'Mac';
  if (/\bairpods\b/i.test(allText))                return 'AirPods';
  if (/\bapple\s*watch\b/i.test(allText))          return 'Apple Watch';
  return null;
}

function detectFamily(t, category) {
  if (category === 'iPhone') {
    if (/\biphone\s*air\b/i.test(t)) return 'iPhone Air';
    if (/\biphone\s*se\b/i.test(t))  return 'iPhone SE';
    const m = t.match(/\biphone\s*(\d{1,2})\b/i);
    if (m) return `iPhone ${m[1]}`;
    return 'iPhone';
  }
  if (category === 'iPad') {
    if (/\bipad\s*pro\b/i.test(t))  return 'iPad Pro';
    if (/\bipad\s*air\b/i.test(t))  return 'iPad Air';
    if (/\bipad\s*mini\b/i.test(t)) return 'iPad mini';
    return 'iPad';
  }
  if (category === 'Mac') {
    if (/\bmacbook\s*pro\b/i.test(t))  return 'MacBook Pro';
    if (/\bmacbook\s*air\b/i.test(t))  return 'MacBook Air';
    if (/\bmac\s*mini\b/i.test(t))     return 'Mac mini';
    if (/\bmac\s*studio\b/i.test(t))   return 'Mac Studio';
    if (/\bimac\b/i.test(t))           return 'iMac';
  }
  if (category === 'AirPods') {
    const maxGen = t.match(/\bairpods\s*max\s*\(?(\d+)(?:nd|rd|st|th)?\s*(?:generation|gen)\)?/i) || t.match(/\bairpods\s*max\s+(\d+)\b/i);
    if (maxGen) return `AirPods Max ${maxGen[1]}`;
    if (/\bairpods\s*max\b/i.test(t)) return 'AirPods Max';
    const proGen = t.match(/\bairpods\s*pro\s*\(?(\d+)(?:nd|rd|st|th)?\s*(?:generation|gen)\)?/i) || t.match(/\bairpods\s*pro\s+(\d+)\b/i);
    if (proGen) return `AirPods Pro ${proGen[1]}`;
    if (/\bairpods\s*pro\b/i.test(t)) return 'AirPods Pro';
    const apGen = t.match(/\bairpods\s*\(?(\d+)(?:nd|rd|st|th)?\s*(?:generation|gen)\)?/i) || t.match(/\bairpods\s+(\d+)\b/i);
    if (apGen) return `AirPods ${apGen[1]}`;
    return 'AirPods';
  }
  if (category === 'Vision Pro') return 'Apple Vision Pro';
  if (category === 'Apple TV') {
    if (/\b4k\b/i.test(t)) return 'Apple TV 4K';
    return 'Apple TV';
  }
  if (category === 'HomePod') {
    if (/\bhomepod\s*mini\b/i.test(t)) return 'HomePod mini';
    return 'HomePod';
  }
  if (category === 'Display') {
    if (/\bstudio\s*display\b/i.test(t)) return 'Studio Display';
    if (/\bpro\s*display\b/i.test(t)) return 'Pro Display XDR';
    return null;
  }
  if (category === 'Dyson') {
    if (/\bairwrap\b/i.test(t)) return 'Dyson Airwrap';
    if (/\bsupersonic\b/i.test(t)) return 'Dyson Supersonic';
    if (/\bcorrale\b/i.test(t)) return 'Dyson Corrale';
    if (/\bv1[0-9]\b/i.test(t)) return 'Dyson V-Series';
    return null;
  }
  if (category === 'Apple Watch') {
    const ultGen = t.match(/\bultra\s*\(?(\d+)(?:nd|rd|st|th)?\s*(?:generation|gen)?\)?\b/i) || t.match(/\bultra\s+(\d+)\b/i);
    if (ultGen) return `Apple Watch Ultra ${ultGen[1]}`;
    if (/\bultra\b/i.test(t)) return 'Apple Watch Ultra';
    const ser = t.match(/\bseries\s*(\d+)\b/i);
    if (ser) return `Apple Watch Series ${ser[1]}`;
    const seGen = t.match(/\bwatch\s*se\s*(\d+)\b/i);
    if (seGen) return `Apple Watch SE ${seGen[1]}`;
    if (/\bwatch\s*se\b/i.test(t)) return 'Apple Watch SE';
    return 'Apple Watch';
  }
  return null;
}

function detectVariant(t, category) {
  if (category === 'iPhone') {
    if (/\biphone\s*air\b/i.test(t)) return 'Air';
    if (/\bpro\s*max\b/i.test(t))    return 'Pro Max';
    if (/\bplus\b/i.test(t))         return 'Plus';
    if (/\bpro\b/i.test(t))          return 'Pro';
    if (/\bmini\b/i.test(t))         return 'mini';
    if (/\bse\b/i.test(t))           return 'SE';
    if (/\biphone\s*\d{1,2}\s*e\b/i.test(t)) return 'e';
    return 'Standard';
  }
  return null;
}

function detectChip(t) {
  const m = t.match(/\bm([1-9])\s*(pro|max|ultra)?\b/i);
  if (!m) return null;
  const base = `M${m[1]}`;
  const suffix = m[2] ? ' ' + m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : '';
  return `${base}${suffix}`;
}

const VALID_STORAGE_SIZES = new Set([64, 128, 256, 512, 1024, 2048, 4096, 8192]);
const VALID_RAM_SIZES = new Set([8, 16, 24, 32, 36, 48, 64, 96, 128]);

function collectGbTbValues(t) {
  const out = [];
  const regex = /\b(\d+(?:\.\d+)?)\s*(gb|tb)\b/gi;
  let m;
  while ((m = regex.exec(t)) !== null) {
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const gb = unit === 'tb' ? Math.round(n * 1024) : Math.round(n);
    const after = t.slice(regex.lastIndex, regex.lastIndex + 24).toLowerCase();
    const isExplicitRam = /\s*(ram|memory|unified\s*memory)\b/.test(after);
    const isExplicitStorage = /\s*(ssd|storage|hard\s*drive|hdd)\b/.test(after);
    out.push({ gb, pos: m.index, isExplicitRam, isExplicitStorage });
  }
  return out;
}

function detectStorage(t) {
  const vals = collectGbTbValues(t);
  if (vals.length === 0) return null;
  const explicitStorage = vals.filter((v) => v.isExplicitStorage);
  if (explicitStorage.length > 0) return explicitStorage.reduce((a, b) => b.gb > a.gb ? b : a).gb;
  const nonRam = vals.filter((v) => !v.isExplicitRam);
  if (nonRam.length === 0) return null;
  const storageOnly = nonRam.filter((v) => VALID_STORAGE_SIZES.has(v.gb) && !VALID_RAM_SIZES.has(v.gb));
  if (storageOnly.length > 0) return storageOnly.reduce((a, b) => b.gb > a.gb ? b : a).gb;
  const ambiguous = nonRam.filter((v) => VALID_STORAGE_SIZES.has(v.gb));
  if (ambiguous.length > 0) return Math.max(...ambiguous.map((v) => v.gb));
  return Math.max(...nonRam.map((v) => v.gb));
}

function detectRam(t) {
  const explicit = t.match(/\b(\d+)\s*gb\s*(ram|memory|unified\s*memory)\b/i);
  if (explicit) return parseInt(explicit[1], 10);
  const vals = collectGbTbValues(t);
  const ramOnly = vals.filter((v) => VALID_RAM_SIZES.has(v.gb) && !VALID_STORAGE_SIZES.has(v.gb));
  if (ramOnly.length === 1) return ramOnly[0].gb;
  if (ramOnly.length > 1) return Math.min(...ramOnly.map((v) => v.gb));
  const smallGb = vals.filter((v) => v.gb <= 128 && VALID_RAM_SIZES.has(v.gb));
  const bigGb = vals.filter((v) => v.gb >= 128 && VALID_STORAGE_SIZES.has(v.gb));
  if (smallGb.length && bigGb.length && /\b(macbook|ipad\s*pro|mac\s*mini|mac\s*studio|imac)\b/i.test(t)) {
    const candidate = smallGb.find((v) => v.gb !== 128);
    if (candidate) return candidate.gb;
  }
  return null;
}

function detectScreen(t) {
  const m = t.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:["'""]|-?\s*inch(?:es)?|-?\s*in\b)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

const KNOWN_COLORS = [
  'space black','space gray','space grey','natural titanium','desert titanium',
  'black titanium','deep blue titanium','deep blue','sky blue','cloud white',
  'light gold','cosmic orange','mist blue','rose gold','jet black',
  'alpine green','sierra blue','pacific blue','graphite',
  'silver','gold','black','white','blue','red','green','purple','pink',
  'yellow','midnight','starlight','orange','sage','lavender','titanium',
].sort((a, b) => b.length - a.length);

function detectColor(title) {
  // Split camelCase ("SkyBlue" → "Sky Blue", "CloudWhite" → "Cloud White")
  // and normalize whitespace so we catch color names even when the Shopify
  // product title runs words together.
  const split = String(title || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ');
  for (const c of KNOWN_COLORS) {
    const safe = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${safe}\\b`, 'i').test(split)) {
      return c.replace(/\b\w/g, (m) => m.toUpperCase());
    }
  }
  return null;
}

function detectRegion(t) {
  if (/\b(middle\s*east|me\s*version|uae\s*version)\b/i.test(t)) return 'Middle East';
  if (/\b(international|int\s*version|with\s*face\s*time|face[-\s]*time)\b/i.test(t)) return 'International';
  if (/\bno\s*face[-\s]*time\b/i.test(t)) return 'Middle East';
  return null;
}

function detectSim(t) {
  if (/\bdual\s*esim\b/i.test(t))                return 'Dual eSIM';
  if (/\bnano\s*sim\s*\+?\s*esim\b/i.test(t))    return 'Nano SIM + eSIM';
  if (/\besim\s*only\b/i.test(t))                return 'eSIM Only';
  return null;
}

function detectKeyboard(t) {
  if (/\b(english\s*\/\s*arabic|english\s*and\s*arabic|english-arabic|arabic\s*keyboard)\b/i.test(t)) return 'English/Arabic';
  if (/\benglish\s*keyboard\b/i.test(t)) return 'English';
  return null;
}

function detectConnectivity(t) {
  if (/\b(wi[-\s]?fi\s*\+\s*cellular|cellular\s*\+\s*wi[-\s]?fi|gps\s*\+\s*cellular)\b/i.test(t)) return 'Wi-Fi + Cellular';
  if (/\bwi[-\s]?fi\s*only\b/i.test(t)) return 'Wi-Fi';
  if (/\bcellular\b/i.test(t))          return 'Wi-Fi + Cellular';
  if (/\bwi[-\s]?fi\b/i.test(t))        return 'Wi-Fi';
  return null;
}

function detectIphoneModel(t) {
  const m = t.match(/\biphone\s*(\d{1,2})\s*(e|se|pro\s*max|pro|plus|mini)?\b/i);
  if (!m) return null;
  const num = m[1];
  const suffix = (m[2] || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return suffix ? `${num} ${suffix}` : num;
}

export function matchesFilter(product, filter) {
  if (product.in_stock === false) return false;
  const title = String(product.title || '').toLowerCase();
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'budget' || k === 'features' || k === 'size_preference' || k === 'usage' || k === 'model') continue;
    const pv = product[k];
    if (pv === undefined || pv === null) {
      if (k === 'family' || k === 'chip') {
        const tokens = String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
        if (tokens.length === 0) return false;
        const allPresent = tokens.every((t) => title.includes(t));
        if (!allPresent) return false;
        continue;
      }
      return false;
    }
    if (Array.isArray(pv)) {
      const hit = pv.some((x) => String(x).toLowerCase() === String(v).toLowerCase());
      if (!hit) return false;
    } else {
      const pvStr = String(pv).toLowerCase();
      const vStr = String(v).toLowerCase();
      if (pvStr !== vStr) {
        if (k === 'family' && pvStr.startsWith(vStr + ' ')) continue;
        return false;
      }
    }
  }
  if (filter.budget && Number.isFinite(filter.budget.amount)) {
    if (!Number.isFinite(product.price_aed) || product.price_aed > filter.budget.amount) return false;
  }
  return true;
}

export async function distinctValues(field, filter = {}) {
  const items = await getCatalog();
  const scoped = items.filter((p) => p.in_stock !== false && matchesFilterExcept(p, filter, field));
  const seen = new Set();
  const values = [];
  for (const p of scoped) {
    const v = p[field];
    if (v === null || v === undefined || v === '') continue;
    const key = String(v).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(v);
  }
  values.sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
  return values;
}

function matchesFilterExcept(product, filter, skipField) {
  const scoped = { ...filter };
  delete scoped[skipField];
  return matchesFilter(product, scoped);
}
