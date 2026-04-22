#!/usr/bin/env node
// End-to-end eval harness for the LLM tool-calling agent.
//
// Runs ~30 real-world scenarios through runAgent() and checks:
//   1. At least one of the expected tools was called (when specified).
//   2. Response text contains certain keywords (when specified).
//   3. Response text does NOT contain forbidden keywords (e.g. "we only carry Apple"
//      when we DO have JBL products in stock).
//   4. If expect_product_contains is set, at least one returned product's
//      title contains that substring.
//
// Usage:
//   node scripts/eval-agent.js             # run all
//   node scripts/eval-agent.js 0 10        # run scenarios 0..9 only
//   node scripts/eval-agent.js --only=12   # run scenario index 12 only
//   node scripts/eval-agent.js --verbose
//
// Requires real OPENAI_API_KEY and Shopify creds (uses the live stack).

import 'dotenv/config';
import { runAgent } from '../src/modules/agent.js';

const SCENARIOS = [
  // ── iPhone ──
  {
    input: 'salam, iphone 17 pro max 256 mikham',
    language: 'mixed',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    expect_text_any_of: ['iPhone 17 Pro Max', '256'],
    forbid_text: ['Samsung', "don't carry"],
    expect_product_title_contains: '17 Pro Max',
  },
  {
    input: 'do you have iphone Air?',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    expect_text_any_of: ['iPhone Air', 'Air'],
    forbid_text: ['iPhone 17 Pro', 'sorry'],
  },
  {
    input: 'iphone 17 pro cosmic orange middle east',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    expect_text_any_of: ['Cosmic Orange', 'Orange'],
  },
  {
    input: 'ye iphone arzoon mikham zire 2500',
    language: 'mixed',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    expect_text_any_of: ['AED'],
  },
  {
    input: 'does UAE iphone have FaceTime?',
    expect_tools_none: true, // spec/policy — no tool call
    expect_text_any_of: ['No', 'FaceTime'],
  },

  // ── iPad ──
  {
    input: 'ipad pro m4 11 inch',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    expect_text_any_of: ['iPad Pro', 'M4'],
  },
  {
    input: 'does apple pencil 1 work with ipad air m4?',
    expect_tools_none: true,
    expect_text_any_of: ['No', 'Pencil Pro', 'USB-C'],
  },
  {
    input: 'what storage sizes do you have for ipad pro m5?',
    expect_tools_any_of: ['getAvailableOptions', 'filterCatalog', 'searchProducts'],
  },

  // ── Mac ──
  {
    input: 'macbook air m4 15 inch',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    expect_text_any_of: ['MacBook Air', 'M4'],
  },
  {
    input: "what's the latest macbook?",
    // "latest" questions answer from APPLE CURRENT LINEUP — tool call is optional
    expect_text_any_of: ['M5', 'MacBook'],
  },
  {
    input: 'mac studio m4 max 64gb ram',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    expect_text_any_of: ['Mac Studio'],
  },

  // ── AirPods ──
  {
    input: 'airpods 4 with anc',
    expect_tools_any_of: ['filterCatalog', 'searchProducts', 'getProductByTitle'],
    expect_text_any_of: ['AirPods 4'],
  },
  {
    input: 'price of airpods pro 3?',
    expect_tools_any_of: ['filterCatalog', 'searchProducts', 'getProductByTitle'],
    expect_text_any_of: ['AirPods Pro 3', 'AED', '795'],
  },

  // ── Apple Watch ──
  {
    input: 'apple watch ultra mojoude?',
    language: 'mixed',
    expect_tools_any_of: ['filterCatalog', 'searchProducts', 'getProductByTitle'],
    expect_text_any_of: ['Ultra', 'ultra'],
  },
  {
    input: 'apple watch series 11',
    expect_tools_any_of: ['filterCatalog', 'searchProducts', 'getProductByTitle'],
    expect_text_any_of: ['Series 11', 'Watch'],
  },

  // ── Non-Apple brands (carried) ──
  {
    input: 'JBL speaker',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    forbid_text: ["we only carry Apple", "don't carry"],
  },
  {
    input: 'Bose quietcomfort headphones',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    forbid_text: ['we only carry Apple', "we don't carry bose", "don't stock bose"],
  },
  {
    input: 'dyson airwrap',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
    forbid_text: ["we only carry Apple"],
  },

  // ── Non-carried brands ──
  {
    input: 'samsung galaxy s24',
    expect_tools_none: true,
    expect_text_any_of: ["don't carry", 'Apple', 'alAsil'],
  },
  {
    input: 'huawei matepad',
    expect_tools_none: true,
    expect_text_any_of: ["don't", 'carry', 'Apple', 'iPad', 'stock', 'alAsil'],
  },

  // ── Policy / support ──
  {
    input: 'warranty?',
    expect_tools_none: true,
    expect_text_any_of: ['1-Year', 'Apple Warranty'],
  },
  {
    input: 'can I pay with tabby?',
    expect_tools_none: true,
    expect_text_any_of: ['Tabby'],
  },
  {
    input: 'where is my order?',
    expect_tools_none: true,
    expect_text_any_of: ['order number', 'WhatsApp', 'team'],
  },

  // ── Greetings / thanks ──
  {
    input: 'hi',
    expect_tools_none: true,
    expect_text_any_of: ['alAsil', 'Apple', 'help', 'Hi', 'Hey', 'hello', 'how can'],
  },
  {
    input: 'thanks',
    expect_tools_none: true,
    forbid_text: ['AED'],
  },

  // ── Follow-up context ──
  {
    input: 'how much is it?',
    last_products: [
      {
        sku: 'MYMJ3AE/A',
        title: 'iPhone 17 Pro Max 256GB Deep Blue (Middle East, Dual eSIM)',
        price_aed: 5139,
        in_stock: true,
        url: 'https://alasil.ae/products/iphone-17-pro-max-256gb-deep-blue',
      },
    ],
    expect_text_any_of: ['5,139', '5139', 'AED'],
  },
  {
    input: 'higher ram?',
    last_products: [
      {
        sku: 'MXYZ1AE/A',
        title: 'MacBook Pro 14-inch M4 Pro 16GB 512GB',
        price_aed: 8500,
        in_stock: true,
        ram_gb: 16,
        storage_gb: 512,
        chip: 'M4 Pro',
        family: 'MacBook Pro',
        screen_inch: 14,
      },
    ],
    expect_tools_any_of: ['filterCatalog', 'searchProducts', 'getAvailableOptions'],
  },

  // ── Tricky / edge cases ──
  {
    input: 'cheapest iphone',
    expect_tools_any_of: ['filterCatalog', 'searchProducts'],
  },
  {
    input: 'MYMJ3AE/A',
    expect_tools_any_of: ['getBySKU', 'searchProducts', 'getProductByTitle'],
  },
  {
    input: 'i want an iphone',
    // vague — agent might call a tool OR ask a clarifying question; either is fine
    expect_text_any_of: ['?', 'Pro', 'storage', 'color', 'iPhone'],
  },
];

function argFlag(name) {
  const pfx = `--${name}=`;
  const a = process.argv.find((x) => x.startsWith(pfx));
  return a ? a.slice(pfx.length) : null;
}

function pickRange() {
  const only = argFlag('only');
  if (only !== null) {
    const i = parseInt(only, 10);
    return [i, i + 1];
  }
  const positional = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (positional.length >= 2) return [parseInt(positional[0], 10), parseInt(positional[1], 10)];
  return [0, SCENARIOS.length];
}

function lower(s) {
  return String(s || '').toLowerCase();
}

function textContainsAny(text, needles) {
  const t = lower(text);
  return needles.some((n) => t.includes(lower(n)));
}

function textContainsAll(text, needles) {
  const t = lower(text);
  return needles.every((n) => t.includes(lower(n)));
}

async function runOne(idx, sc, verbose) {
  const t0 = Date.now();
  let result;
  try {
    result = await runAgent({
      userMessage: sc.input,
      language: sc.language || 'en',
      history: sc.history || [],
      lastProducts: sc.last_products || [],
      sessionId: `eval-${idx}`,
    });
  } catch (err) {
    return { idx, pass: false, reason: `threw: ${err?.message || err}`, ms: Date.now() - t0 };
  }

  const text = result.text || '';
  const tools = (result.toolCalls || []).map((t) => t.name);
  const fails = [];

  if (sc.expect_tools_any_of && !sc.expect_tools_any_of.some((n) => tools.includes(n))) {
    fails.push(`expected one of tools [${sc.expect_tools_any_of.join(', ')}], got [${tools.join(', ') || 'none'}]`);
  }
  if (sc.expect_tools_none && tools.length > 0) {
    fails.push(`expected no tool calls, got [${tools.join(', ')}]`);
  }
  if (sc.expect_text_any_of && !textContainsAny(text, sc.expect_text_any_of)) {
    fails.push(`text missing any of [${sc.expect_text_any_of.join(' | ')}]`);
  }
  if (sc.expect_text_all_of && !textContainsAll(text, sc.expect_text_all_of)) {
    fails.push(`text missing all of [${sc.expect_text_all_of.join(' & ')}]`);
  }
  if (sc.forbid_text && textContainsAny(text, sc.forbid_text)) {
    fails.push(`text contains forbidden [${sc.forbid_text.join(' | ')}]`);
  }
  if (sc.expect_product_title_contains) {
    const hit = (result.products || []).some((p) =>
      lower(p.title).includes(lower(sc.expect_product_title_contains))
    );
    if (!hit) fails.push(`no product title contains "${sc.expect_product_title_contains}"`);
  }

  const pass = fails.length === 0;
  const ms = Date.now() - t0;
  return {
    idx,
    pass,
    reason: pass ? '' : fails.join('; '),
    ms,
    tools,
    iterations: result.iterations,
    products: (result.products || []).length,
    text,
  };
}

async function main() {
  const [start, end] = pickRange();
  const verbose = process.argv.includes('--verbose');
  const results = [];
  const total = Math.min(end, SCENARIOS.length) - start;
  let idx = 0;
  const delayMs = parseInt(argFlag('delay') || '500', 10);
  for (let i = start; i < Math.min(end, SCENARIOS.length); i++) {
    idx++;
    const sc = SCENARIOS[i];
    process.stdout.write(`[${idx}/${total}] #${i} "${sc.input.slice(0, 50)}" ... `);
    const r = await runOne(i, sc, verbose);
    results.push(r);
    if (idx < total && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (r.pass) {
      process.stdout.write(`PASS (${r.ms}ms, tools=[${r.tools.join(',')}])\n`);
    } else {
      process.stdout.write(`FAIL — ${r.reason}\n`);
      if (verbose) {
        console.log(`   tools: [${r.tools.join(',')}]`);
        console.log(`   text:  ${String(r.text || '').slice(0, 200)}`);
      }
    }
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  const rate = results.length ? ((pass / results.length) * 100).toFixed(1) : '0.0';
  const avgMs = results.length ? Math.round(results.reduce((a, b) => a + b.ms, 0) / results.length) : 0;

  console.log('\n──────────── SUMMARY ────────────');
  console.log(`Total:  ${results.length}`);
  console.log(`Pass:   ${pass}`);
  console.log(`Fail:   ${fail}`);
  console.log(`Rate:   ${rate}%`);
  console.log(`Avg ms: ${avgMs}`);

  if (fail > 0) {
    console.log('\nFailed scenarios:');
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  #${r.idx}  "${SCENARIOS[r.idx].input}"`);
      console.log(`       ${r.reason}`);
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
