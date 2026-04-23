#!/usr/bin/env node
// Generate config/catalog_taxonomy.md — a structured map of every
// category / family / variant / spec / tag we actually stock.
//
// Two ways to run:
//   1. CLI: `node scripts/build-taxonomy.js` — pulls fresh catalog, writes file.
//   2. Programmatic: `import { buildTaxonomyFromCatalog }` — called by
//      catalog.js right after a successful Shopify refresh, so the file stays
//      in sync when a new product is added in Shopify.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'config', 'catalog_taxonomy.md');

function unique(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (v === null || v === undefined || v === '') continue;
    const key = String(v).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function sortAlphaNumeric(arr) {
  return [...arr].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

function fmtStorage(list) {
  return list
    .map((v) => (v >= 1024 ? `${Math.round(v / 1024)}TB` : `${v}GB`))
    .join(', ');
}

function fmtPriceRange(products) {
  const prices = products.map((p) => p.price_aed).filter((x) => Number.isFinite(x));
  if (prices.length === 0) return null;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const fmt = (n) => `AED ${Math.round(n).toLocaleString()}`;
  return lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`;
}

// Programmatic: build the markdown from an already-loaded catalog array.
// Called by catalog.js right after a Shopify refresh so the file stays fresh
// without waiting for the nightly cron.
export function buildTaxonomyFromCatalog(catalog) {
  const inStock = (catalog || []).filter((p) => p.in_stock !== false);

  // Group by category → model_key (the new canonical per-model-line identifier).
  // This keeps iPhone 17 Pro and iPhone 17 Pro Max as separate groups instead
  // of rolling them up into a single "iPhone 17" family with mixed variants.
  const byCategory = new Map();
  for (const p of inStock) {
    const cat = p.category || 'Unknown';
    if (!byCategory.has(cat)) byCategory.set(cat, new Map());
    const key = p.model_key || p.family || '(no family)';
    const modelMap = byCategory.get(cat);
    if (!modelMap.has(key)) modelMap.set(key, []);
    modelMap.get(key).push(p);
  }

  // Tag frequency
  const tagCount = new Map();
  for (const p of inStock) {
    for (const t of p.tags || []) {
      const k = String(t).trim();
      if (!k) continue;
      tagCount.set(k, (tagCount.get(k) || 0) + 1);
    }
  }

  const lines = [];
  const syncDate = new Date().toISOString().slice(0, 10);
  lines.push(`# alAsil Catalog Taxonomy (auto-generated ${syncDate})`);
  lines.push('');
  lines.push('Use this map to figure out WHAT WE STOCK across categories, families,');
  lines.push('and variants. Values shown here are only the ones that currently exist');
  lines.push('in our catalog — if a variant is not listed, we do not have it.');
  lines.push('');
  lines.push('For PRECISE stock / price / SKU queries, call a tool (filterCatalog,');
  lines.push('searchProducts). This file is for ORIENTATION — what families exist,');
  lines.push('what chip options exist for a family, etc.');
  lines.push('');
  lines.push(`Total in-stock SKUs: ${inStock.length}`);
  lines.push('');

  // Category summary table
  lines.push('## Category summary');
  lines.push('');
  lines.push('| Category | SKUs in stock | Price range |');
  lines.push('|----------|---------------|-------------|');
  const catNames = [...byCategory.keys()].sort();
  for (const cat of catNames) {
    const famMap = byCategory.get(cat);
    const allInCat = [].concat(...famMap.values());
    lines.push(`| ${cat} | ${allInCat.length} | ${fmtPriceRange(allInCat) || '—'} |`);
  }
  lines.push('');

  // Per category — families + attribute values
  for (const cat of catNames) {
    const famMap = byCategory.get(cat);
    const sortedFams = [...famMap.keys()].sort((a, b) => famMap.get(b).length - famMap.get(a).length);
    lines.push(`## ${cat}`);
    lines.push('');
    for (const fam of sortedFams) {
      const items = famMap.get(fam);
      lines.push(`### ${fam} (${items.length} SKUs)`);
      const price = fmtPriceRange(items);
      if (price) lines.push(`Price range: ${price}`);

      const variants = unique(items.map((p) => p.variant).filter(Boolean));
      if (variants.length) lines.push(`Variants: ${variants.join(', ')}`);

      const chips = unique(items.map((p) => p.chip).filter(Boolean));
      if (chips.length) lines.push(`Chips: ${sortAlphaNumeric(chips).join(', ')}`);

      const storages = sortAlphaNumeric(unique(items.map((p) => p.storage_gb).filter(Boolean)));
      if (storages.length) lines.push(`Storage: ${fmtStorage(storages)}`);

      const rams = sortAlphaNumeric(unique(items.map((p) => p.ram_gb).filter(Boolean)));
      if (rams.length) lines.push(`RAM: ${rams.join('GB, ')}GB`);

      const screens = sortAlphaNumeric(unique(items.map((p) => p.screen_inch).filter(Boolean)));
      if (screens.length) lines.push(`Screen: ${screens.join('", ')}"`);

      const colors = sortAlphaNumeric(unique(items.map((p) => p.color).filter(Boolean)));
      if (colors.length) lines.push(`Colors: ${colors.join(', ')}`);

      const regions = unique(items.map((p) => p.region).filter(Boolean));
      if (regions.length) lines.push(`Regions: ${regions.join(', ')}`);

      const sims = unique(items.map((p) => p.sim).filter(Boolean));
      if (sims.length) lines.push(`SIM: ${sims.join(', ')}`);

      const conns = unique(items.map((p) => p.connectivity).filter(Boolean));
      if (conns.length) lines.push(`Connectivity: ${conns.join(', ')}`);

      const kbs = unique(items.map((p) => p.keyboard_layout).filter(Boolean));
      if (kbs.length) lines.push(`Keyboard: ${kbs.join(', ')}`);

      lines.push('');
    }
  }

  // Top tags
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([t, n]) => `${t} (${n})`);
  if (topTags.length) {
    lines.push('## Top Shopify tags (by product count)');
    lines.push('');
    lines.push(topTags.join(' · '));
    lines.push('');
  }

  // Common aliases / disambiguation hints
  lines.push('## Quick disambiguation hints');
  lines.push('');
  lines.push('When a customer says a short phrase, this table says which category it belongs to.');
  lines.push('');
  lines.push('| Customer phrase | Maps to |');
  lines.push('|-----------------|---------|');
  lines.push('| iphone 17 / 17 pro / 17 pro max / air / 17e | iPhone → family is the number |');
  lines.push('| iphone 16 / 16 pro / 16 plus / 16 pro max | iPhone → iPhone 16 family |');
  lines.push('| ipad pro / ipad air / ipad mini / ipad | iPad — watch for chip (M4 / M5 / A16 / A17 Pro) |');
  lines.push('| macbook air / macbook pro / mac mini / mac studio / imac | Mac — chip determines year |');
  lines.push('| airpods / airpods pro / airpods max / airpods 4 | AirPods — gen number is often in title |');
  lines.push('| apple watch / watch ultra / watch series / watch se | Apple Watch — series number on title |');
  lines.push('| pencil / apple pencil / pencil pro / pencil usb-c | Accessory (category) — spec lookup via apple_specs.md |');
  lines.push('| case / cover / folio / band / charger / cable / adapter | Accessory — always filter category=Accessory |');
  lines.push('| jbl / bose / sony / harman | Speaker/Earbuds/Headphones by product line |');
  lines.push('| dyson airwrap / supersonic / corrale | Dyson category |');
  lines.push('');

  lines.push('## Regeneration');
  lines.push(`This file is generated by \`scripts/build-taxonomy.js\`. Re-run whenever new product lines are added to Shopify. Last run: ${syncDate}.`);

  const content = lines.join('\n') + '\n';
  fs.writeFileSync(OUT, content);
  return { path: OUT, lines: lines.length, bytes: content.length, totalSkus: catalog.length, inStock: inStock.length };
}

// CLI entrypoint — keep existing behaviour for the nightly cron.
async function main() {
  console.log('Loading catalog from Shopify...');
  const { getCatalog } = await import('../src/modules/catalog.js');
  const catalog = await getCatalog();
  const res = buildTaxonomyFromCatalog(catalog);
  console.log(`Loaded ${res.totalSkus} total (${res.inStock} in stock).`);
  console.log(`Wrote ${res.path} (${res.lines} lines, ${res.bytes} bytes)`);
}

// Only run main() when this file is executed directly, not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
}
