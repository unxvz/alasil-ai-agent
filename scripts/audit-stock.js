#!/usr/bin/env node
// Compare the cached catalog's in_stock flag against a FRESH Shopify pull
// for every product. Flags any SKU where the cache disagrees with Shopify
// right now — those are the ones where the bot would say "out of stock"
// for a product that's actually available (or vice versa).
//
// Usage:
//   node scripts/audit-stock.js                 # full audit
//   node scripts/audit-stock.js --only-mismatch # only show discrepancies
//   node scripts/audit-stock.js --refresh       # force a catalog refresh first

import 'dotenv/config';
import { getCatalog, enrichProduct } from '../src/modules/catalog.js';
import { fetchAllProducts } from '../src/modules/shopify.js';

const ONLY = process.argv.includes('--only-mismatch');
const FORCE = process.argv.includes('--refresh');

async function main() {
  console.log('Loading cached catalog…');
  const cached = await getCatalog({ refresh: FORCE });
  console.log(`Cached: ${cached.length} products`);

  console.log('Pulling fresh catalog from Shopify…');
  const rawFresh = await fetchAllProducts();
  const fresh = rawFresh.map(enrichProduct);
  console.log(`Fresh: ${fresh.length} products`);

  const cacheById = new Map(cached.map((p) => [p.id || p.handle, p]));

  let inStockFresh = 0;
  let inStockCached = 0;
  let freshOnlyInStock = [];
  let cachedOnlyInStock = [];
  let onlyInFresh = [];
  let onlyInCached = [];

  for (const f of fresh) {
    if (f.in_stock) inStockFresh++;
    const c = cacheById.get(f.id || f.handle);
    if (!c) {
      onlyInFresh.push(f);
      continue;
    }
    if (c.in_stock) inStockCached++;
    if (f.in_stock && !c.in_stock) freshOnlyInStock.push({ f, c });
    if (!f.in_stock && c.in_stock) cachedOnlyInStock.push({ f, c });
  }

  const freshIds = new Set(fresh.map((p) => p.id || p.handle));
  for (const c of cached) {
    if (!freshIds.has(c.id || c.handle)) onlyInCached.push(c);
  }

  console.log();
  console.log('─── Stock counts ───');
  console.log(`  In-stock NOW (Shopify): ${inStockFresh}`);
  console.log(`  In-stock (cached):      ${inStockCached}`);
  console.log();
  console.log('─── Mismatches ───');
  console.log(`  Fresh=in-stock but cache says OOS: ${freshOnlyInStock.length}  ← bot would wrongly say "not available"`);
  console.log(`  Cache says in-stock but fresh OOS:  ${cachedOnlyInStock.length}  ← bot would wrongly say "available"`);
  console.log(`  New products not yet in cache:      ${onlyInFresh.length}`);
  console.log(`  Products removed since cache:        ${onlyInCached.length}`);

  const printOne = ({ f, c }, label) => {
    console.log(`  [${label}] ${String(f.title || '').slice(0, 80)}`);
    console.log(`           handle=${f.handle}  sku=${f.sku || '?'}`);
    console.log(`           cache.in_stock=${c?.in_stock}  fresh.in_stock=${f.in_stock}`);
  };

  if (freshOnlyInStock.length > 0) {
    console.log();
    console.log('─── Products the bot WOULD wrongly say are OOS ───');
    for (const row of freshOnlyInStock.slice(0, 20)) printOne(row, 'STALE OOS');
    if (freshOnlyInStock.length > 20) console.log(`   …and ${freshOnlyInStock.length - 20} more`);
  }

  if (!ONLY && cachedOnlyInStock.length > 0) {
    console.log();
    console.log('─── Products the bot WOULD wrongly say are IN STOCK ───');
    for (const row of cachedOnlyInStock.slice(0, 20)) printOne(row, 'STALE INSTOCK');
    if (cachedOnlyInStock.length > 20) console.log(`   …and ${cachedOnlyInStock.length - 20} more`);
  }

  if (!ONLY && onlyInFresh.length > 0) {
    console.log();
    console.log('─── New products in Shopify not yet in cache ───');
    for (const f of onlyInFresh.slice(0, 10)) console.log(`  ${String(f.title || '').slice(0, 80)}  (${f.handle})`);
  }

  // Tell the operator what to do next.
  console.log();
  console.log('─── Recommendation ───');
  if (freshOnlyInStock.length > 0 || cachedOnlyInStock.length > 0 || onlyInFresh.length > 0 || onlyInCached.length > 0) {
    console.log('The catalog cache is out of date. Refresh it:');
    console.log('  touch ~/alasil-bot/tmp/restart.txt   # or wait 5 min for the TTL to expire');
  } else {
    console.log('Cache matches Shopify perfectly. No action needed.');
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
