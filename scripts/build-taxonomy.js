#!/usr/bin/env node
// Generate config/catalog_taxonomy.md — a structured map of every
// category / family / variant / spec / tag we actually stock.
//
// This runs offline against the live Shopify catalog. The agent reads the
// output file via the knowledge block, so the LLM always has an accurate
// picture of "what we have" without needing a tool call for broad questions
// and, more importantly, can disambiguate follow-up messages ("256?" →
// knows the customer means storage for the family last discussed).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCatalog } from '../src/modules/catalog.js';

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

async function main() {
  console.log('Loading catalog from Shopify...');
  const catalog = await getCatalog();
  const inStock = catalog.filter((p) => p.in_stock !== false);
  console.log(`Loaded ${catalog.length} total (${inStock.length} in stock).`);

  // Group by category → family → variant
  const byCategory = new Map();
  for (const p of inStock) {
    const cat = p.category || 'Unknown';
    if (!byCategory.has(cat)) byCategory.set(cat, new Map());
    const fam = p.family || '(no family)';
    const famMap = byCategory.get(cat);
    if (!famMap.has(fam)) famMap.set(fam, []);
    famMap.get(fam).push(p);
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

  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`Wrote ${OUT} (${lines.length} lines)`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
