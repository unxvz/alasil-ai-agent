import { config } from '../config.js';
import { logger } from '../logger.js';
import { fetchAllProducts } from './shopify.js';
import { adminEnabled, fetchAllProductsAdmin } from './shopify-admin.js';

let _cache = null;
let _loadedAt = 0;
let _inflight = null;

const TTL_MS = config.SHOPIFY_CACHE_TTL_SECONDS * 1000;

// Background refresh worker — does the actual Shopify fetch + enrichment.
// Never throws to the caller; errors are logged.
async function _refreshCatalog() {
  try {
    let raw;
    if (adminEnabled()) {
      try {
        raw = await fetchAllProductsAdmin();
        logger.info({ count: raw.length, source: 'admin' }, 'catalog fetched via Admin API');
      } catch (err) {
        logger.warn({ err: String(err?.message || err) }, 'Admin API fetch failed, falling back to Storefront');
        raw = await fetchAllProducts();
      }
    } else {
      raw = await fetchAllProducts();
    }
    const enriched = raw.map(_enrichProduct);
    const wasFirstLoad = _cache === null;
    const prevSkuCount = _cache?.length || 0;
    _cache = enriched;
    _loadedAt = Date.now();
    logger.info({ count: enriched.length }, 'Shopify catalog loaded');

    if (wasFirstLoad || prevSkuCount !== enriched.length) {
      Promise.resolve().then(async () => {
        try {
          const { buildTaxonomyFromCatalog } = await import('../../scripts/build-taxonomy.js');
          const res = buildTaxonomyFromCatalog(enriched);
          logger.info({ path: res.path, lines: res.lines, inStock: res.inStock }, 'taxonomy auto-rebuilt');
        } catch (err) {
          logger.warn({ err: String(err?.message || err) }, 'taxonomy auto-rebuild failed');
        }
      });
    }
    return enriched;
  } catch (err) {
    logger.error({ err: String(err?.message || err) }, 'catalog refresh failed');
    throw err;
  } finally {
    _inflight = null;
  }
}

// getCatalog returns the cached data IMMEDIATELY if we have any, even if
// stale. If stale (past TTL) we kick off a background refresh so the NEXT
// call sees fresh data. User-facing requests never wait 60+ seconds for a
// catalog refetch — that was causing very slow bot replies.
//
// Only when there is no cache at all (first call after boot) do we await
// the fetch. { refresh: true } also awaits, used by the admin / audit script.
export async function getCatalog({ refresh = false } = {}) {
  const now = Date.now();
  const isStale = !_cache || (now - _loadedAt >= TTL_MS);

  if (refresh) {
    if (_inflight) return _inflight;
    _inflight = _refreshCatalog();
    return _inflight;
  }

  // No cache yet — we have to wait.
  if (!_cache) {
    if (_inflight) return _inflight;
    _inflight = _refreshCatalog();
    return _inflight;
  }

  // Stale but usable: kick off refresh in background, return stale data now.
  if (isStale && !_inflight) {
    _inflight = _refreshCatalog();
    // Do NOT await. Fire-and-forget.
    _inflight.catch(() => {});
  }
  return _cache;
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
  // Title-based detection runs FIRST — it handles Apple product lines cleanly
  // (AirPods, iPhone, iPad, Mac all start their titles with the family name).
  // Shopify's standardized `category` taxonomy is a fallback; merchants often
  // mis-tag AirPods as "Headphones", and title beats that every time.
  const category = detectCategory(norm, p.productType, p.tags) || detectCategoryFromAdmin(p);
  const family = detectFamilyFromCollections(p, category) || detectFamily(norm, category);
  const variant = detectVariant(norm, category);
  const chip = detectChip(norm) || detectChip(tagsText) || detectChip(String(p.productType || ''));

  // Prefer admin data (variants options, metafields) over regex extraction.
  // alAsil's Shopify uses `custom.*` namespace for most specs. Check both
  // `apple.*` (our suggested convention) and `custom.*` (merchant's existing).
  const storage_gb = readVariantOption(p, 'storage') || detectStorage(norm);
  const ram_gb = readMetafield(p, 'apple.ram_gb') || readMetafield(p, 'custom.ram_gb') || detectRam(norm);
  const screen_inch = readMetafield(p, 'apple.screen_inch') || readMetafield(p, 'custom.screen_inch') || detectScreen(norm);
  const rawColor = readVariantOption(p, 'color') || detectColor(title);
  const region = detectRegion(norm);
  const sim = detectSim(norm);
  const keyboard_layout = detectKeyboard(norm);
  const connectivity = detectConnectivity(norm);
  const model =
    category === 'iPhone' ? detectIphoneModel(norm)
    : category === 'Mac'  ? chip
    : null;

  // New fields — metafield wins when set, fallback to regex/derivation.
  const material = readMetafield(p, 'apple.material') || readMetafield(p, 'custom.material') || detectMaterial(category, family);
  const year = readMetafield(p, 'apple.year') || readMetafield(p, 'custom.year') || detectYear(category, family, chip);
  const generation = readMetafield(p, 'apple.generation') || readMetafield(p, 'custom.generation') || detectGeneration(category, family, variant);
  const officialColor = readMetafield(p, 'apple.official_color') || readMetafield(p, 'custom.official_color');
  const color = officialColor || normalizeColor(rawColor, material);
  const modelKeyOverride = readMetafield(p, 'apple.model_key') || readMetafield(p, 'custom.model_key');
  // Merchant's existing metafields we can expose to the agent as spec facts
  const extra_specs = extractExtraSpecs(p);

  // Canonical model_key: a stable "which exact phone model is this" label.
  // Customer can ask for any of these and the bot knows what to filter on.
  // Metafield `apple.model_key` wins if the merchant has set it; otherwise
  // we derive from family + variant.
  const model_key = modelKeyOverride || buildModelKey({ category, family, variant, chip, screen_inch });

  // Canonical category_path: "iPhone > iPhone 17 Pro Max > 256GB > Deep Blue"
  // Gives LLM a deterministic breadcrumb so it can map any customer phrase
  // to exactly one product group.
  const category_path = buildCategoryPath({
    category, model_key, family, variant, chip, ram_gb, storage_gb,
    color, region, connectivity, sim, screen_inch,
    title: p.title,
  });

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
    extra_specs,
    features: { storage_gb, ram_gb, screen_inch },
  };
}

// Pull the merchant's useful spec metafields (chip_model, battery_life, etc.)
// into a clean dict so the agent can reason over them in one place.
function extractExtraSpecs(p) {
  const mf = p?.metafields;
  if (!mf || typeof mf !== 'object') return null;
  const wanted = [
    'chip_model', 'battery_capacity', 'battery_life', 'display_type', 'brightness',
    'cpu_cores', 'charger_type', 'fast_charging', 'front_camera', 'rear_camera',
    'biometric_authentication', 'bluetooth', 'gps', 'sim_type', 'water_resistance',
    'always_on_display', 'expandable_storage', 'condition', 'operating_system',
    'refresh_rate', 'resolution', 'ports', 'weight', 'wifi_standard',
  ];
  const out = {};
  for (const key of wanted) {
    const entry = mf[`custom.${key}`] || mf[`apple.${key}`];
    if (entry && entry.value !== null && entry.value !== '') {
      out[key] = entry.value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Build a human-readable "model_key" that uniquely identifies the phone/ipad/mac/watch
// line, separate from variants-within-line (storage, color, region, etc).
// When the merchant-curated family (from a Shopify collection) already
// contains the variant (e.g. family="iPhone 17 Pro Max" already has "Pro Max"),
// we skip the concatenation to avoid "iPhone 17 Pro Max Pro Max" duplication.
function buildModelKey({ category, family, variant, chip, screen_inch }) {
  if (!family) return null;
  const famLower = String(family).toLowerCase();
  const alreadyHas = (piece) => famLower.includes(String(piece || '').toLowerCase());

  if (category === 'iPhone') {
    if (!variant || variant === 'Standard' || variant === 'Air') return family;
    if (alreadyHas(variant)) return family;
    return `${family} ${variant}`;
  }
  if (category === 'iPad') {
    if (chip && !alreadyHas(chip)) return `${family} (${chip})`;
    return family;
  }
  if (category === 'Mac') {
    const sizeStr = screen_inch ? `${screen_inch}"` : null;
    const parts = [family];
    if (sizeStr && !alreadyHas(sizeStr)) parts.push(sizeStr);
    if (chip && !alreadyHas(chip)) parts.push(`(${chip})`);
    return parts.join(' ');
  }
  if (category === 'Apple Watch') {
    return family;
  }
  if (category === 'AirPods') {
    return family;
  }
  return family;
}

// Build a category_path that uniquely identifies the SKU bundle the customer
// would ask for. We include enough fields per category to avoid duplicates:
//   iPhone / iPad       → model → storage → color → region → connectivity/sim
//   Mac                 → model → chip → ram → storage → color
//   Apple Watch         → family → case size → material → band
//   AirPods             → family
//   Accessory/Audio     → brand from title + color (no family concept)
function buildCategoryPath(p) {
  const {
    category, model_key, family, variant, chip, ram_gb, storage_gb,
    color, region, connectivity, sim, screen_inch, title,
  } = p;
  const parts = [];
  if (category) parts.push(category);

  if (category === 'iPhone') {
    if (model_key) parts.push(model_key);
    if (storage_gb) parts.push(fmtBytes(storage_gb));
    if (color) parts.push(color);
    if (region) parts.push(region);
    if (sim && sim !== 'Dual eSIM') parts.push(sim);
  } else if (category === 'iPad') {
    if (model_key) parts.push(model_key);
    if (storage_gb) parts.push(fmtBytes(storage_gb));
    if (color) parts.push(color);
    if (connectivity) parts.push(connectivity);
  } else if (category === 'Mac') {
    if (model_key) parts.push(model_key);
    else if (family) parts.push(family);
    if (chip && !String(model_key || '').includes(chip)) parts.push(chip);
    if (ram_gb) parts.push(`${ram_gb}GB RAM`);
    if (storage_gb) parts.push(fmtBytes(storage_gb));
    if (color) parts.push(color);
  } else if (category === 'Apple Watch') {
    if (family) parts.push(family);
    const caseSize = extractWatchCaseSize(title);
    if (caseSize) parts.push(caseSize);
    const material = extractWatchMaterial(title);
    if (material) parts.push(material);
    const band = extractBandColor(title);
    if (band) parts.push(band);
  } else if (category === 'AirPods') {
    if (family) parts.push(family);
    if (color) parts.push(color);
  } else if (category === 'Accessory' || category === 'Speaker' ||
             category === 'Headphones' || category === 'Earbuds' ||
             category === 'Display' || category === 'Dyson' ||
             category === 'Home Appliance' || category === 'Projector' ||
             category === 'HomePod' || category === 'Apple TV' ||
             category === 'Vision Pro') {
    // These categories don't have a clean family hierarchy — add brand-ish and
    // title-ish fields so each SKU gets its own unique breadcrumb.
    if (family) parts.push(family);
    const brand = extractBrand(title);
    if (brand && !parts.some((x) => String(x).toLowerCase().includes(brand.toLowerCase()))) {
      parts.push(brand);
    }
    const shortTitle = shortenTitle(title);
    if (shortTitle && !parts.some((x) => String(x).toLowerCase() === shortTitle.toLowerCase())) {
      parts.push(shortTitle);
    }
    if (storage_gb) parts.push(fmtBytes(storage_gb));
    if (color) parts.push(color);
  } else {
    if (model_key && model_key !== category) parts.push(model_key);
    if (storage_gb) parts.push(fmtBytes(storage_gb));
    if (color) parts.push(color);
    if (region) parts.push(region);
  }

  return parts.join(' > ');
}

function fmtBytes(gb) {
  return gb >= 1024 ? `${Math.round(gb / 1024)}TB` : `${gb}GB`;
}

function extractBrand(title) {
  const t = String(title || '');
  const m = t.match(/\b(JBL|Bose|Sony|Harman\s*Kardon|Beats|Shokz|Dyson|Ninja|Cosori|Formovie|Apple|Magic|MagSafe|AirTag|AirPods|Studio\s*Display|Pro\s*Display)\b/i);
  return m ? m[1] : null;
}

function extractWatchCaseSize(title) {
  const m = String(title || '').match(/\b(\d{2})\s*mm\b/);
  return m ? `${m[1]}mm` : null;
}

function extractWatchMaterial(title) {
  const t = String(title || '').toLowerCase();
  if (/titanium/.test(t)) return 'Titanium';
  if (/aluminum|aluminium/.test(t)) return 'Aluminum';
  if (/stainless/.test(t)) return 'Stainless';
  return null;
}

function extractBandColor(title) {
  const t = String(title || '');
  const m = t.match(/with\s+([A-Z][A-Za-z/ ]+?)\s+(?:Alpine\s*Loop|Trail\s*Loop|Ocean\s*Band|Sport\s*Band|Sport\s*Loop|Solo\s*Loop|Braided\s*Solo\s*Loop|Milanese\s*Loop|Leather|Modern\s*Buckle|Nike\s*Band)/i);
  return m ? m[1].trim() : null;
}

function shortenTitle(title) {
  // Take the first 3-5 meaningful words after stripping brand tokens
  const t = String(title || '')
    .replace(/\b(JBL|Bose|Sony|Harman\s*Kardon|Beats|Shokz|Dyson|Ninja|Cosori|Formovie|Apple)\s*/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/—|–|-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = t.split(' ').slice(0, 4);
  return words.join(' ').slice(0, 48) || null;
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

// Prefer Shopify's standardized taxonomy (category_shopify.fullName, set by
// merchant in 2024+ Shopify) over our regex-based detectCategory.
function detectCategoryFromAdmin(p) {
  const full = p?.category_shopify?.fullName;
  if (!full) return null;
  // Map Shopify's tree to our internal category labels.
  const fn = String(full).toLowerCase();
  if (/mobile\s*phones|smartphones/.test(fn)) return 'iPhone';
  if (/tablet\s*computers|tablets/.test(fn)) return 'iPad';
  if (/laptop\s*computers|computers/.test(fn)) return 'Mac';
  if (/smartwatches?|smart\s*watches/.test(fn)) return 'Apple Watch';
  if (/earbuds|earphones/.test(fn)) return 'Earbuds';
  if (/headphones/.test(fn)) return 'Headphones';
  if (/speakers/.test(fn)) return 'Speaker';
  if (/monitor|display/.test(fn)) return 'Display';
  return null;
}

// Prefer a merchant-curated collection like "iPhone 17 Pro Max" over our
// regex-based family extraction. We rank collections by specificity: a
// collection that names a full model (iPhone 17 Pro Max) beats a series
// collection (iPhone 17 Series) which beats a category-only collection
// (iPhone).
function detectFamilyFromCollections(p, category) {
  const cols = Array.isArray(p?.collections) ? p.collections : [];
  if (cols.length === 0) return null;
  const promos = /\b(hot\s*deals?|deals|sale|offers?|bf|black\s*friday|valentines?|new\s*arrivals|bundles?|gift\s*cards?|combos?|bestsellers?|all\s*products?|cases?\s*&?\s*protection|shop\s*by\s*brand|previous\s*models?|older\s*models?|legacy|vintage|older\s*generation|refurbished|accessor(y|ies))\b/i;

  // Score each collection; higher score = more specific.
  const scored = [];
  for (const c of cols) {
    const t = String(c.title || '').trim();
    if (!t) continue;
    if (promos.test(t)) continue;
    let score = 0;
    // Specific model with variant (e.g. "iPhone 17 Pro Max")
    if (/iPhone\s*\d{1,2}\s*(Pro\s*Max|Pro|Plus|Mini|e)\b/i.test(t)) score += 120;
    // iPhone Air / iPhone SE special
    if (/iPhone\s*(Air|SE)\b/i.test(t)) score += 120;
    // Bare "iPhone <number>" without a variant suffix — still specific
    if (score === 0 && /^iPhone\s*\d{1,2}\s*$/i.test(t)) score += 100;
    // iPad / Mac / Watch model-specific
    if (/iPad\s*(Pro|Air|Mini)/i.test(t)) score += 80;
    if (/MacBook\s*(Air|Pro)|Mac\s*Studio|Mac\s*mini|iMac/i.test(t)) score += 80;
    if (/Apple\s*Watch\s*(Series\s*\d+|Ultra\s*\d*|SE\s*\d*)/i.test(t)) score += 80;
    if (/AirPods\s*(Pro\s*\d*|Max|4|3|2)/i.test(t)) score += 80;
    // Series-level (only if no specific model scored)
    if (score === 0 && /(\d{1,2}\s*Series\b|Series\s*\d{1,2})/i.test(t)) score += 40;
    // Exact category match — use only if nothing else scored
    if (score === 0 && category && new RegExp('^\\s*' + category.replace(/\s+/g, '\\s*') + '\\s*$', 'i').test(t)) score += 5;
    // Partial category match — last resort
    if (score === 0 && category && new RegExp('\\b' + category.replace(/\s+/g, '\\s*') + '\\b', 'i').test(t)) score += 3;
    if (score === 0) continue;
    // Length tiebreaker
    score += t.length * 0.05;
    scored.push({ title: t, score });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].title;
}

// Extract an option value (like Color / Storage) from Shopify variant metadata
// when the Admin API exposed it. Returns number for storage_gb, string for color.
function readVariantOption(p, which) {
  const vs = Array.isArray(p?.variants) ? p.variants : [];
  if (vs.length === 0) return null;
  const target = String(which || '').toLowerCase();
  // Pick a variant that has the option set (usually the first).
  for (const v of vs) {
    const opts = v.options || {};
    for (const [k, val] of Object.entries(opts)) {
      const kk = String(k).toLowerCase();
      if (target === 'color' && /colou?r|finish/.test(kk)) {
        return String(val).trim();
      }
      if (target === 'storage' && /storage|capacity|memory/.test(kk)) {
        // parse e.g. "256GB", "1TB"
        const m = String(val).match(/(\d+(?:\.\d+)?)\s*(gb|tb)/i);
        if (m) {
          const n = parseFloat(m[1]);
          return m[2].toLowerCase() === 'tb' ? Math.round(n * 1024) : Math.round(n);
        }
      }
    }
  }
  return null;
}

function readMetafield(p, fullKey) {
  const mf = p?.metafields;
  if (!mf || typeof mf !== 'object') return null;
  const entry = mf[fullKey];
  if (!entry || entry.value === null || entry.value === undefined || entry.value === '') return null;
  // Convert common types:
  if (entry.type === 'number_integer' || entry.type === 'number_decimal') {
    const n = Number(entry.value);
    return Number.isFinite(n) ? n : null;
  }
  return String(entry.value);
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
  // Branded audio — extract the product line for each major brand.
  if (category === 'Headphones' || category === 'Earbuds' || category === 'Speaker') {
    // Bose lines
    if (/\bquietcomfort\s*ultra\s*headphones?\b/i.test(t)) return 'Bose QuietComfort Ultra Headphones';
    if (/\bquietcomfort\s*ultra\s*earbuds?\b/i.test(t)) return 'Bose QuietComfort Ultra Earbuds';
    if (/\bquietcomfort\s*earbuds?\s*ii\b/i.test(t)) return 'Bose QuietComfort Earbuds II';
    if (/\bquietcomfort\s*45\b/i.test(t)) return 'Bose QuietComfort 45';
    if (/\bnoise\s*cancelling\s*headphones?\s*700\b/i.test(t)) return 'Bose Noise Cancelling Headphones 700';
    if (/\bsoundlink\s*flex\b/i.test(t)) return 'Bose SoundLink Flex';
    if (/\bsoundlink\s*micro\b/i.test(t)) return 'Bose SoundLink Micro';
    if (/\bsoundlink\s*max\b/i.test(t)) return 'Bose SoundLink Max';
    if (/\bsoundbar\s*9\d\d\b/i.test(t)) return 'Bose Soundbar';
    // Beats lines
    if (/\bbeats\s*studio\s*pro\b/i.test(t)) return 'Beats Studio Pro';
    if (/\bbeats\s*studio\s*buds\s*\+\b/i.test(t)) return 'Beats Studio Buds +';
    if (/\bbeats\s*studio\s*buds\b/i.test(t)) return 'Beats Studio Buds';
    if (/\bbeats\s*solo\s*4\b/i.test(t)) return 'Beats Solo 4';
    if (/\bbeats\s*solo\s*3\b/i.test(t)) return 'Beats Solo3';
    if (/\bbeats\s*solo\s*buds\b/i.test(t)) return 'Beats Solo Buds';
    if (/\bpowerbeats\s*pro\s*2\b/i.test(t)) return 'Powerbeats Pro 2';
    if (/\bpowerbeats\s*pro\b/i.test(t)) return 'Powerbeats Pro';
    if (/\bbeats\s*fit\s*pro\b/i.test(t)) return 'Beats Fit Pro';
    if (/\bbeats\s*flex\b/i.test(t)) return 'Beats Flex';
    if (/\bbeats\s*pill\b/i.test(t)) return 'Beats Pill';
    // JBL speakers
    if (/\bjbl\s*flip\s*6\b/i.test(t)) return 'JBL Flip 6';
    if (/\bjbl\s*flip\s*5\b/i.test(t)) return 'JBL Flip 5';
    if (/\bjbl\s*charge\s*5\b/i.test(t)) return 'JBL Charge 5';
    if (/\bjbl\s*charge\s*6\b/i.test(t)) return 'JBL Charge 6';
    if (/\bjbl\s*xtreme\s*[34]\b/i.test(t)) return 'JBL Xtreme';
    if (/\bjbl\s*pulse\b/i.test(t)) return 'JBL Pulse';
    if (/\bjbl\s*partybox\b/i.test(t)) return 'JBL PartyBox';
    if (/\bjbl\s*go\s*\d\b/i.test(t)) return 'JBL Go';
    if (/\bjbl\s*clip\s*\d\b/i.test(t)) return 'JBL Clip';
    if (/\bjbl\s*boombox\b/i.test(t)) return 'JBL Boombox';
    if (/\bjbl\s*tour\s*one\b/i.test(t)) return 'JBL Tour One';
    if (/\bjbl\s*tour\s*pro\b/i.test(t)) return 'JBL Tour Pro';
    // Sony / Harman / Shokz catch-all: brand + next word
    const sm = t.match(/\b(sony|harman\s*kardon|shokz|harman)\s+([A-Za-z0-9-]+)/i);
    if (sm) return `${sm[1]} ${sm[2]}`;
    // Fallback: brand alone
    const brand = t.match(/\b(jbl|bose|sony|harman\s*kardon|beats|shokz)\b/i);
    if (brand) return brand[1].toUpperCase() === 'JBL' ? 'JBL' : brand[1];
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

    // SPECIAL: if the caller passes `family: "iPhone 17 Pro Max"` but the
    // product stores family="iPhone 17" and variant="Pro Max" (our convention),
    // silently split the filter so it matches. Same treatment as if they had
    // passed model_key directly.
    if (k === 'family' && typeof v === 'string' && product.model_key && String(product.model_key).toLowerCase() === String(v).toLowerCase()) {
      continue;
    }

    const pv = product[k];
    if (pv === undefined || pv === null) {
      // Fallback token-in-title match, but ONLY within the same category so
      // iPhone accessories don't leak into an iPhone phone filter.
      if (k === 'family' || k === 'chip' || k === 'model_key') {
        if (filter.category && product.category && String(filter.category).toLowerCase() !== String(product.category).toLowerCase()) {
          return false;
        }
        // Also reject cross-category for common primary filters — if the
        // caller is clearly asking for a phone (family contains "iPhone")
        // but the product is an Accessory, bail out.
        const isPhoneFilter = /\b(iphone|ipad|macbook|imac|apple\s*watch|airpods|homepod|vision)\b/i.test(String(v));
        if (isPhoneFilter && product.category === 'Accessory') return false;
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
