#!/usr/bin/env node
// Unit tests for src/tools/index.js — no OpenAI calls, pure catalog.
// Verifies each tool returns sensible shapes and respects filters.
//
// Usage: node scripts/test-tools.js

import 'dotenv/config';
import { executeTool } from '../src/tools/index.js';

let pass = 0;
let fail = 0;

async function check(label, fn) {
  try {
    const ok = await fn();
    if (ok) {
      pass++;
      console.log(`  PASS  ${label}`);
    } else {
      fail++;
      console.log(`  FAIL  ${label}`);
    }
  } catch (err) {
    fail++;
    console.log(`  THROW ${label}  ${err?.message || err}`);
  }
}

async function main() {
  console.log('Testing tools...\n');

  console.log('searchProducts');
  await check('returns products array', async () => {
    const r = await executeTool('searchProducts', { query: 'iphone 17 pro' });
    return Array.isArray(r?.products) && r.products.length > 0;
  });
  await check('product has sku + title + price_aed', async () => {
    const r = await executeTool('searchProducts', { query: 'macbook air', limit: 3 });
    const p = r?.products?.[0];
    return p && typeof p.title === 'string' && typeof p.price_aed === 'number';
  });
  await check('empty query returns error', async () => {
    const r = await executeTool('searchProducts', { query: '' });
    return r?.products?.length === 0;
  });

  console.log('\nfilterCatalog');
  await check('filter by category=iPhone returns iPhones only', async () => {
    const r = await executeTool('filterCatalog', { category: 'iPhone', limit: 20 });
    return r?.products?.length > 0 && r.products.every((p) => p.category === 'iPhone');
  });
  await check('filter by family=iPhone Air returns Air only', async () => {
    const r = await executeTool('filterCatalog', { family: 'iPhone Air', limit: 20 });
    const all = r?.products || [];
    return all.length > 0 && all.every((p) => /\biphone\s*air\b/i.test(p.title || ''));
  });
  await check('max_price_aed caps price', async () => {
    const r = await executeTool('filterCatalog', { category: 'iPhone', max_price_aed: 3000, limit: 20 });
    return (r?.products || []).every((p) => !p.price_aed || p.price_aed <= 3000);
  });
  await check('min_ram_gb filters by RAM floor', async () => {
    const r = await executeTool('filterCatalog', { category: 'Mac', min_ram_gb: 16, limit: 10 });
    return (r?.products || []).every((p) => !p.ram_gb || p.ram_gb >= 16);
  });
  await check('sort=price_asc returns cheapest first', async () => {
    const r = await executeTool('filterCatalog', { category: 'iPhone', sort: 'price_asc', limit: 5 });
    const prices = (r?.products || []).map((p) => p.price_aed || 0);
    for (let i = 1; i < prices.length; i++) if (prices[i] < prices[i - 1]) return false;
    return prices.length > 0;
  });

  console.log('\ngetAvailableOptions');
  await check('field=color returns array of colors', async () => {
    const r = await executeTool('getAvailableOptions', { field: 'color', filters: { category: 'iPhone' } });
    return Array.isArray(r?.values) && r.values.length > 0;
  });
  await check('field=storage_gb returns numbers', async () => {
    const r = await executeTool('getAvailableOptions', { field: 'storage_gb', filters: { category: 'iPhone' } });
    return Array.isArray(r?.values) && r.values.every((v) => typeof v === 'number');
  });

  console.log('\ngetProductByTitle');
  await check('fuzzy match finds airpods 4', async () => {
    const r = await executeTool('getProductByTitle', { title_query: 'airpods 4 with anc' });
    return (r?.products || []).some((p) => /airpods\s*4/i.test(p.title));
  });
  await check('no hit on gibberish', async () => {
    const r = await executeTool('getProductByTitle', { title_query: 'zxqwerty garbage 123' });
    return r?.products?.length === 0;
  });

  console.log('\ngetBySKU');
  await check('unknown sku returns empty', async () => {
    const r = await executeTool('getBySKU', { sku: 'NOT-A-REAL-SKU-ZZ9' });
    return r?.products?.length === 0;
  });

  console.log(`\n──── ${pass} passed, ${fail} failed ────`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
