#!/usr/bin/env node
// Walk the full Shopify catalog and flag every enrichment that looks suspect:
//   - null category / family / model_key on a well-known product
//   - duplicate category_path across different SKUs (lossy breadcrumb)
//   - colors that look wrong (e.g. "Titanium" suffix on aluminum bodies)
//   - iPhone family that doesn't match the title
//   - Accessory misclassified as a phone
//
// Usage:
//   node scripts/audit-catalog.js               # full report
//   node scripts/audit-catalog.js --bad-only    # only print flagged rows
//   node scripts/audit-catalog.js --summary     # counts only, no details

import 'dotenv/config';
import { getCatalog } from '../src/modules/catalog.js';

const ONLY_BAD = process.argv.includes('--bad-only');
const SUMMARY = process.argv.includes('--summary');

function checkProduct(p) {
  const flags = [];
  const title = String(p.title || '').toLowerCase();

  // Title-vs-category sanity
  if (/\biphone\b/.test(title) && !/case|cover|folio|strap|band|charger|adapter|cable|pencil|magsafe/.test(title)) {
    if (p.category && p.category !== 'iPhone') flags.push('iphone-titled product not in iPhone category');
  }
  if (/\bmacbook|imac|mac\s*mini|mac\s*studio\b/.test(title) && p.category && p.category !== 'Mac') {
    flags.push('mac-titled product not in Mac category');
  }

  // Must-have fields for primary products
  if (p.category && p.category !== 'Accessory' && p.category !== 'Gift Card') {
    if (!p.family) flags.push('missing family');
    if (!p.model_key) flags.push('missing model_key');
  }

  // iPhone 17 Pro colors should be one of: Silver / Cosmic Orange / Deep Blue
  if (p.model_key === 'iPhone 17 Pro Max' || p.model_key === 'iPhone 17 Pro') {
    const ok = ['Silver', 'Cosmic Orange', 'Deep Blue'];
    if (p.color && !ok.includes(p.color)) {
      flags.push(`iPhone 17 Pro color unexpected: "${p.color}" (expected one of ${ok.join(', ')})`);
    }
    if (p.material && p.material !== 'aluminum') {
      flags.push(`iPhone 17 Pro material should be aluminum, got "${p.material}"`);
    }
  }

  // iPhone Air colors: Space Black / Cloud White / Light Gold / Sky Blue
  if (p.model_key === 'iPhone Air') {
    const ok = ['Space Black', 'Cloud White', 'Light Gold', 'Sky Blue'];
    if (p.color && !ok.includes(p.color)) {
      flags.push(`iPhone Air color unexpected: "${p.color}"`);
    }
  }

  // iPhone 16 Pro should be titanium
  if (p.model_key === 'iPhone 16 Pro' || p.model_key === 'iPhone 16 Pro Max') {
    if (p.material && p.material !== 'titanium') {
      flags.push(`iPhone 16 Pro material should be titanium, got "${p.material}"`);
    }
  }

  // Storage that's not a known Apple storage size
  const VALID_STORAGE = new Set([64, 128, 256, 512, 1024, 2048, 4096, 8192]);
  if (p.storage_gb && !VALID_STORAGE.has(p.storage_gb)) {
    flags.push(`storage_gb=${p.storage_gb} is not a standard Apple size`);
  }

  // Region on non-iPhone products
  if (p.region && p.category !== 'iPhone' && p.category !== 'iPad') {
    flags.push(`region="${p.region}" set on non-phone/tablet category ${p.category}`);
  }

  return flags;
}

async function main() {
  const catalog = await getCatalog();
  console.log(`Catalog total: ${catalog.length}`);

  const byCategory = new Map();
  const pathCounts = new Map();
  const flaggedProducts = [];

  for (const p of catalog) {
    byCategory.set(p.category || 'null', (byCategory.get(p.category || 'null') || 0) + 1);
    if (p.category_path) {
      if (!pathCounts.has(p.category_path)) pathCounts.set(p.category_path, []);
      pathCounts.get(p.category_path).push(p);
    }
    const flags = checkProduct(p);
    if (flags.length > 0) flaggedProducts.push({ p, flags });
  }

  const duplicatePaths = [...pathCounts.entries()].filter(([, arr]) => arr.length > 1);

  console.log();
  console.log('=== By category ===');
  for (const [c, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(c).padEnd(18)} ${n}`);
  }

  console.log();
  console.log(`=== Duplicate category_paths (${duplicatePaths.length}) ===`);
  if (!SUMMARY) {
    for (const [path, arr] of duplicatePaths.slice(0, 10)) {
      console.log(`  "${path}" × ${arr.length}`);
      for (const p of arr.slice(0, 3)) console.log(`    sku=${p.sku || '?'}  ${String(p.title || '').slice(0, 80)}`);
    }
    if (duplicatePaths.length > 10) console.log(`  … and ${duplicatePaths.length - 10} more`);
  }

  console.log();
  console.log(`=== Flagged (${flaggedProducts.length} of ${catalog.length}) ===`);
  if (!SUMMARY) {
    const limit = ONLY_BAD ? flaggedProducts.length : 40;
    for (const { p, flags } of flaggedProducts.slice(0, limit)) {
      console.log(`  ${String(p.title || '').slice(0, 80)}`);
      console.log(`    category=${p.category} family=${p.family} model_key=${p.model_key || '—'} color=${p.color || '—'}`);
      for (const f of flags) console.log(`    ⚠ ${f}`);
    }
    if (flaggedProducts.length > limit) console.log(`  … and ${flaggedProducts.length - limit} more`);
  }

  console.log();
  console.log('=== Summary ===');
  console.log(`  Total:     ${catalog.length}`);
  console.log(`  Clean:     ${catalog.length - flaggedProducts.length}`);
  console.log(`  Flagged:   ${flaggedProducts.length} (${((flaggedProducts.length / catalog.length) * 100).toFixed(1)}%)`);
  console.log(`  Duplicate category_paths: ${duplicatePaths.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
