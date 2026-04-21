import { getCatalog, matchesFilter, enrichProduct } from './catalog.js';
import { searchProducts } from './shopify.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const MAX_RESULTS = 3;

function buildShopifyQuery(profile) {
  const terms = [];
  if (profile.family)   terms.push(`title:*${profile.family.replace(/\s+/g, '* *')}*`);
  else if (profile.category) terms.push(`title:*${profile.category}*`);
  if (profile.chip)     terms.push(`(title:*${profile.chip.replace(/\s+/g, '* *')}* OR tag:'${profile.chip}' OR tag:'${profile.chip} Chip')`);
  if (profile.storage_gb) {
    const s = profile.storage_gb >= 1024 ? `${profile.storage_gb / 1024}TB` : `${profile.storage_gb}GB`;
    terms.push(`title:*${s}*`);
  }
  if (profile.color)     terms.push(`title:*${profile.color.replace(/\s+/g, '* *')}*`);
  if (profile.region === 'International') terms.push(`title:*international*`);
  if (profile.region === 'Middle East')   terms.push(`title:*middle east*`);
  if (profile.variant && profile.variant !== 'Standard') terms.push(`title:*${profile.variant.replace(/\s+/g, '* *')}*`);
  terms.push('available_for_sale:true');
  return terms.join(' ');
}

async function liveSearch(profile, { limit = 20 } = {}) {
  const query = buildShopifyQuery(profile);
  if (!query || query === 'available_for_sale:true') return null;
  try {
    const t0 = Date.now();
    const raw = await searchProducts(query, { limit });
    const enriched = raw.map(enrichProduct);
    const matched = enriched.filter((p) => matchesFilter(p, profile));
    logger.info({ query, raw_count: raw.length, matched: matched.length, ms: Date.now() - t0 }, 'shopify live search');
    return matched;
  } catch (err) {
    logger.warn({ err: String(err?.message || err), query }, 'live search failed, falling back to catalog');
    return null;
  }
}

function rank(products, profile) {
  const features = new Set((profile.features || []).map((f) => String(f).toLowerCase()));
  const size = profile.size_preference;

  const cmp = (a, b) => {
    if (features.has('budget')) {
      const d = a.price_aed - b.price_aed;
      if (d) return d;
    } else if (features.has('performance')) {
      const d = (b.ram_gb || 0) - (a.ram_gb || 0);
      if (d) return d;
      const s = (b.storage_gb || 0) - (a.storage_gb || 0);
      if (s) return s;
    } else if (features.has('portability')) {
      const d = (a.screen_inch || 99) - (b.screen_inch || 99);
      if (d) return d;
    }
    if (size === 'small') {
      const d = (a.screen_inch || 99) - (b.screen_inch || 99);
      if (d) return d;
    } else if (size === 'large') {
      const d = (b.screen_inch || 0) - (a.screen_inch || 0);
      if (d) return d;
    }
    return (a.price_aed || 0) - (b.price_aed || 0);
  };

  return [...products].sort(cmp);
}

function diversify(products, limit) {
  const seen = new Map();
  for (const p of products) {
    const k = [
      p.family || '',
      p.variant || '',
      p.chip || '',
      p.storage_gb || '',
    ].join('|');
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

export async function retrieveProducts(profile, { limit = MAX_RESULTS } = {}) {
  const cap = Math.min(limit, 10);

  if (config.FEATURE_LIVE_SEARCH) {
    const live = await liveSearch(profile, { limit: 20 });
    if (live && live.length > 0) {
      const ranked = rank(live, profile);
      return diversify(ranked, cap);
    }
  }

  const catalog = await getCatalog();
  const matched = catalog.filter((p) => matchesFilter(p, profile));
  const ranked = rank(matched, profile);
  return diversify(ranked, cap);
}

export async function retrieveForComparison(profile, { limit = MAX_RESULTS } = {}) {
  const softProfile = { ...profile };
  delete softProfile.storage_gb;
  delete softProfile.color;
  delete softProfile.region;
  return retrieveProducts(softProfile, { limit });
}

const RELAX_ORDER = [
  'keyboard_layout', 'region', 'color', 'connectivity',
  'sim', 'storage_gb', 'ram_gb', 'screen_inch', 'variant', 'chip', 'family',
];

export async function retrieveWithRelaxation(profile, { limit = MAX_RESULTS } = {}) {
  let rows = await retrieveProducts(profile, { limit });
  if (rows.length > 0) return { products: rows, relaxed: [] };

  const soft = { ...profile };
  const relaxed = [];
  for (const field of RELAX_ORDER) {
    if (soft[field] === undefined || soft[field] === null || soft[field] === '') continue;
    relaxed.push({ field, removed_value: soft[field] });
    delete soft[field];
    rows = await retrieveProducts(soft, { limit });
    if (rows.length > 0) return { products: rows, relaxed };
  }
  return { products: [], relaxed };
}
