#!/usr/bin/env node
// Comprehensive scenario test for the AI agent.
// Runs ~80 realistic customer scenarios across categories + edge cases + out-of-scope.
// Grades each as PASS / FAIL with a short reason. Prints a summary at the end.

const BASE = process.env.CHAT_URL || 'http://localhost:3000/chat';

async function ask(sessionId, message, reset = false) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, reset }),
  });
  return r.json();
}

async function runFlow(sessionId, turns) {
  const responses = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const reset = i === 0 ? true : false;
    const resp = await ask(sessionId, turn.q, reset);
    responses.push({ q: turn.q, resp });
  }
  return responses;
}

function contains(text, needles) {
  const t = String(text || '').toLowerCase();
  return needles.every((n) => t.includes(String(n).toLowerCase()));
}

function containsAny(text, needles) {
  const t = String(text || '').toLowerCase();
  return needles.some((n) => t.includes(String(n).toLowerCase()));
}

function notContains(text, needles) {
  const t = String(text || '').toLowerCase();
  return !needles.some((n) => t.includes(String(n).toLowerCase()));
}

const SCENARIOS = [
  // --- greetings ---
  { name: 'greet: hi', turns: [{ q: 'hi', expect: (r) => containsAny(r.message, ['welcome', 'alasil']) }] },
  { name: 'greet: hello', turns: [{ q: 'hello', expect: (r) => containsAny(r.message, ['welcome', 'alasil']) }] },
  { name: 'greet: salam', turns: [{ q: 'salam', expect: (r) => containsAny(r.message, ['welcome', 'alasil', 'خوش']) }] },
  { name: 'greet: *Hi*', turns: [{ q: '*Hi*', expect: (r) => containsAny(r.message, ['welcome', 'alasil']) }] },
  { name: 'thanks', turns: [{ q: 'thank you', expect: (r) => containsAny(r.message, ['welcome', 'anything else']) }] },

  // --- broad product queries ---
  { name: 'broad: iphone', turns: [{ q: 'iphone', expect: (r) => r.products && r.products.length >= 1 && containsAny(r.message, ['iphone']) }] },
  { name: 'broad: ipad', turns: [{ q: 'ipad', expect: (r) => r.products && r.products.length >= 1 && containsAny(r.message, ['ipad']) }] },
  { name: 'broad: macbook', turns: [{ q: 'macbook', expect: (r) => r.products && r.products.length >= 1 && containsAny(r.message, ['macbook']) }] },
  { name: 'broad: airpods', turns: [{ q: 'airpods', expect: (r) => containsAny(r.message, ['airpods', 'which line']) }] },
  { name: 'broad: apple watch', turns: [{ q: 'apple watch', expect: (r) => containsAny(r.message, ['watch', 'which']) }] },

  // --- specific product queries ---
  { name: 'specific: iphone 17 pro max', turns: [{ q: 'iphone 17 pro max', expect: (r) => containsAny(r.message, ['17 pro max']) }] },
  { name: 'specific: ipad air m4 256', turns: [{ q: 'ipad air m4 256gb', expect: (r) => containsAny(r.message, ['ipad air', 'm4', '256']) }] },
  { name: 'specific: macbook pro 16 m5 max 2tb', turns: [{ q: 'macbook pro 16 m5 max 2tb', expect: (r) => containsAny(r.message, ['macbook pro', 'm5 max']) }] },
  { name: 'specific: airpods pro', turns: [{ q: 'airpods pro', expect: (r) => containsAny(r.message, ['airpods pro', 'which']) }] },

  // --- typos ---
  { name: 'typo: iphoen', turns: [{ q: 'iphoen 17', expect: (r) => containsAny(r.message, ['iphone 17']) }] },
  { name: 'typo: macbbok', turns: [{ q: 'macbbok air', expect: (r) => containsAny(r.message, ['macbook air']) }] },
  { name: 'typo: ippad', turns: [{ q: 'ippad pro', expect: (r) => containsAny(r.message, ['ipad pro']) }] },
  { name: 'typo: air pods', turns: [{ q: 'air pods pro', expect: (r) => containsAny(r.message, ['airpods']) }] },

  // --- SKU lookup ---
  { name: 'sku: MQKJ3', turns: [{ q: 'MQKJ3', expect: (r) => containsAny(r.message, ['usb-c', 'cable', '60w']) }] },
  { name: 'sku embedded: assistance with (MQKJ3)', turns: [{ q: "Hi! I'd like some assistance with 60W USB-C Charge Cable (MQKJ3) – Apple – alAsil", expect: (r) => containsAny(r.message, ['60w', 'cable']) }] },

  // --- PDP paste ---
  { name: 'pdp paste: iPad Air M4', turns: [{ q: "Hi! I would like some assistance with iPad Air M4 11 inch 256GB Purple | alAsil", expect: (r) => containsAny(r.message, ['ipad air', 'm4', 'purple']) }] },

  // --- compatibility questions (should answer, not list products) ---
  { name: 'compat: pencil 1 + ipad air m4', turns: [{ q: 'Does Apple Pencil 1 work with iPad Air M4?', expect: (r) => (r.products || []).length === 0 && containsAny(r.message, ['no']) && notContains(r.message, ['https://']) }] },
  { name: 'compat: pencil pro + ipad air m4', turns: [{ q: 'Is Apple Pencil Pro compatible with iPad Air M4?', expect: (r) => containsAny(r.message, ['yes']) }] },
  { name: 'compat: magsafe on iphone 17', turns: [{ q: 'Does iPhone 17 support MagSafe?', expect: (r) => containsAny(r.message, ['yes']) }] },
  { name: 'compat: facetime on UAE iphone', turns: [{ q: 'Does UAE iPhone have FaceTime?', expect: (r) => containsAny(r.message, ['no', 'disabled']) }] },

  // --- version/region ---
  { name: 'region: middle east version', turns: [{ q: 'show me iPhone 17 middle east version', expect: (r) => containsAny(r.message, ['middle east', 'face']) }] },
  { name: 'region: international', turns: [{ q: 'iPhone 17 international version', expect: (r) => containsAny(r.message, ['international']) }] },
  { name: 'region: europe typo', turns: [{ q: 'iPhone 17 pro max erupe version', expect: (r) => containsAny(r.message, ['international']) }] },

  // --- delivery/shipping ---
  { name: 'shipping: today delivery', turns: [{ q: 'can I get it today?', expect: (r) => containsAny(r.message, ['same', 'today', '6 pm', 'dubai']) }] },
  { name: 'shipping: abu dhabi', turns: [{ q: 'do you deliver to abu dhabi?', expect: (r) => containsAny(r.message, ['yes', 'uae', 'abu dhabi', '1-3', '1–3']) }] },
  { name: 'shipping: saudi arabia', turns: [{ q: 'do you ship to saudi arabia?', expect: (r) => containsAny(r.message, ['uae', 'only', 'contact', 'team']) }] },
  { name: 'shipping: when handed', turns: [{ q: 'when will my order be handed to me?', expect: (r) => containsAny(r.message, ['tracking', 'email', 'whatsapp', 'same day', '6 pm', 'business day']) }] },
  { name: 'shipping: sharjah', turns: [{ q: 'shipping time to sharjah?', expect: (r) => containsAny(r.message, ['1-3', '1–3', 'business']) }] },

  // --- payment ---
  { name: 'pay: tabby', turns: [{ q: 'can i pay with tabby?', expect: (r) => containsAny(r.message, ['tabby', '4', 'pay']) }] },
  { name: 'pay: tamara', turns: [{ q: 'tamara available?', expect: (r) => containsAny(r.message, ['tamara']) }] },
  { name: 'pay: cash on delivery', turns: [{ q: 'cash on delivery?', expect: (r) => containsAny(r.message, ['cod', 'cash', '1,500', '1500']) }] },
  { name: 'pay: apple pay', turns: [{ q: 'apple pay?', expect: (r) => containsAny(r.message, ['apple pay']) }] },
  { name: 'pay: 12 month installment', turns: [{ q: 'can i pay in 12 months?', expect: (r) => containsAny(r.message, ['tabby', 'tamara', 'monthly', '12']) }] },

  // --- warranty / policy ---
  { name: 'warranty: general', turns: [{ q: 'warranty?', expect: (r) => containsAny(r.message, ['1-year', '1 year', 'apple warranty']) }] },
  { name: 'policy: return', turns: [{ q: 'can i return a product?', expect: (r) => containsAny(r.message, ['return', 'team', 'policy', 'portal']) }] },
  { name: 'policy: authentic', turns: [{ q: 'are your products authentic?', expect: (r) => containsAny(r.message, ['authentic', '100%', 'apple']) }] },

  // --- store info ---
  { name: 'store: address', turns: [{ q: 'where is your store?', expect: (r) => containsAny(r.message, ['deira', 'gargash', 'dubai']) }] },
  { name: 'store: hours', turns: [{ q: 'what are your hours?', expect: (r) => containsAny(r.message, ['10', '9', 'monday', 'saturday', 'sunday']) }] },
  { name: 'store: phone', turns: [{ q: 'your phone number?', expect: (r) => containsAny(r.message, ['+971', '288', '5680']) }] },

  // --- invoice (new "check with team" behavior) ---
  { name: 'invoice: tax free', turns: [{ q: 'do you make invoice for tax free?', expect: (r) => containsAny(r.message, ['check', 'team', 'whatsapp', 'confirm']) }] },
  { name: 'invoice: serial number', turns: [{ q: 'can i have invoice with serial number?', expect: (r) => containsAny(r.message, ['check', 'team', 'whatsapp', 'confirm']) }] },
  { name: 'invoice: vat', turns: [{ q: 'do you charge vat?', expect: (r) => containsAny(r.message, ['vat', 'team', 'check']) }] },

  // --- accessory queries (fixed now) ---
  {
    name: 'accessory: iphone case after iphone 17 pro max',
    turns: [
      { q: 'iphone 17 pro max' },
      { q: 'iphone case you have?', expect: (r) => containsAny(r.message, ['case']) && notContains(r.message, ['iphone 17 pro max 256gb deep blue']) },
    ],
  },
  { name: 'accessory: apple pencil pro', turns: [{ q: 'apple pencil pro', expect: (r) => containsAny(r.message, ['pencil', '425']) }] },
  { name: 'accessory: screen protector for ipad', turns: [{ q: 'screen protector for ipad', expect: (r) => containsAny(r.message, ['protector', 'ipad']) }] },
  { name: 'accessory: magic mouse', turns: [{ q: 'magic mouse', expect: (r) => containsAny(r.message, ['magic mouse']) }] },

  // --- contextual follow-up ---
  {
    name: 'followup: how much is it',
    turns: [
      { q: 'apple pencil pro' },
      { q: 'how much is it?', expect: (r) => containsAny(r.message, ['425', 'pencil pro']) },
    ],
  },
  {
    name: 'followup: any discount',
    turns: [
      { q: 'apple pencil pro' },
      { q: 'any discount?', expect: (r) => containsAny(r.message, ['425', '529', 'discount']) },
    ],
  },
  {
    name: 'followup: whats in the box iphone 17 pro max',
    turns: [
      { q: 'iphone 17 pro max' },
      { q: "what's in the box?", expect: (r) => containsAny(r.message, ['cable', 'usb-c', 'documentation']) },
    ],
  },

  // --- narrowing flow (best behaviour: no links on multi) ---
  {
    name: 'narrow: mac then m4',
    turns: [
      { q: 'macbook air' },
      { q: 'I want the M4 one', expect: (r) => containsAny(r.message, ['m4']) },
    ],
  },
  {
    name: 'narrow: ipad air then 256 purple',
    turns: [
      { q: 'show me ipad air' },
      { q: '256gb purple', expect: (r) => containsAny(r.message, ['purple']) },
    ],
  },

  // --- chip / product-line intelligence ---
  { name: 'chip: iphone with m4', turns: [{ q: 'do you have iphone with m4 chip?', expect: (r) => containsAny(r.message, ['iphone', 'a-series', 'a19', 'no']) }] },
  { name: 'chip: latest macbook air', turns: [{ q: 'what is the latest macbook air?', expect: (r) => containsAny(r.message, ['m5']) }] },
  { name: 'chip: latest ipad pro', turns: [{ q: 'latest ipad pro?', expect: (r) => containsAny(r.message, ['m5']) }] },

  // --- quantity / family ---
  { name: 'family: 2 ipads for kids', turns: [{ q: 'I am looking for 2 iPads for my kids', expect: (r) => (r.products || []).length >= 1 && containsAny(r.message, ['ipad']) }] },
  { name: 'family: student laptop', turns: [{ q: 'which macbook for student?', expect: (r) => containsAny(r.message, ['macbook air', 'student']) }] },

  // --- out of scope (should deflect politely, short) ---
  { name: 'oos: samsung', turns: [{ q: 'do you sell samsung phones?', expect: (r) => containsAny(r.message, ['apple', 'only', "don't sell", 'samsung']) && r.message.length < 400 }] },
  { name: 'oos: weather', turns: [{ q: 'how is the weather in dubai?', expect: (r) => !containsAny(r.message, ['iphone 17', 'ipad air']) && r.message.length < 400 }] },
  { name: 'oos: stock market', turns: [{ q: 'should i buy apple stock?', expect: (r) => !containsAny(r.message, ['ipad air', 'macbook pro']) && r.message.length < 400 }] },
  { name: 'oos: repair service', turns: [{ q: 'can you fix my broken iphone screen?', expect: (r) => containsAny(r.message, ['repair', 'authorized', 'apple', 'service', 'team', "don't"]) }] },
  { name: 'oos: trade-in', turns: [{ q: 'can i trade in my old iphone?', expect: (r) => containsAny(r.message, ["don't", 'trade', 'only sell', 'team']) }] },

  // --- comparisons ---
  { name: 'compare: m3 vs m4', turns: [{ q: 'whats the difference between M3 and M4?', expect: (r) => containsAny(r.message, ['m3', 'm4']) }] },
  { name: 'compare: ipad pro vs air', turns: [{ q: 'ipad pro vs ipad air?', expect: (r) => containsAny(r.message, ['pro', 'air']) }] },

  // --- language ---
  { name: 'fa: salam', turns: [{ q: 'سلام', expect: (r) => r.message.length > 0 }] },
  { name: 'fa: aipod', turns: [{ q: 'airpods mikham', expect: (r) => containsAny(r.message, ['airpods']) }] },

  // --- price sensitive ---
  { name: 'price: cheapest iphone', turns: [{ q: 'cheapest iphone?', expect: (r) => containsAny(r.message, ['iphone']) && (r.products || []).length >= 1 }] },
  { name: 'price: budget laptop', turns: [{ q: 'budget laptop under 3000 aed', expect: (r) => containsAny(r.message, ['macbook']) }] },

  // --- ambiguous one-word ---
  { name: 'ambig: pro', turns: [{ q: 'pro', expect: (r) => r.message.length > 0 }] },
  { name: 'ambig: 256', turns: [{ q: '256gb', expect: (r) => r.message.length > 0 }] },
  { name: 'ambig: black', turns: [{ q: 'black', expect: (r) => r.message.length > 0 }] },
];

function grade(resp, expectFn) {
  try {
    return expectFn(resp) ? 'PASS' : 'FAIL';
  } catch {
    return 'FAIL';
  }
}

(async () => {
  console.log(`Running ${SCENARIOS.length} scenarios against ${BASE}\n`);
  const results = [];
  const start = Date.now();
  let idx = 0;
  for (const s of SCENARIOS) {
    idx++;
    const sessionId = `stest-${Date.now()}-${idx}`;
    let finalResp = null;
    let finalExpect = null;
    for (let i = 0; i < s.turns.length; i++) {
      const reset = i === 0;
      const turn = s.turns[i];
      const r = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: turn.q, reset }),
      }).then((x) => x.json());
      finalResp = r;
      if (turn.expect) finalExpect = turn.expect;
    }
    const status = finalExpect ? grade(finalResp, finalExpect) : 'PASS';
    results.push({ name: s.name, status, msg: (finalResp?.message || '').slice(0, 140).replace(/\n+/g, ' ') });
    console.log(`${status === 'PASS' ? 'OK  ' : 'FAIL'} | ${s.name}`);
  }
  const ms = Date.now() - start;
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.length - pass;
  console.log(`\n=== ${pass}/${results.length} passed (${fail} failed) in ${(ms / 1000).toFixed(1)}s ===\n`);
  if (fail > 0) {
    console.log('Failed scenarios:');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`  - ${r.name} → "${r.msg}"`);
    }
  }
})();
