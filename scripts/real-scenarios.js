#!/usr/bin/env node
// Scenarios derived from real customer chats (alAsil Wati export).
// Tests common patterns: PDP templates, availability, versions, payments, delivery, support handoffs.

const BASE = process.env.CHAT_URL || 'http://localhost:3000/chat';

async function ask(sessionId, message, reset = false) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, reset }),
  });
  return r.json();
}

function has(t, n) { return String(t || '').toLowerCase().includes(String(n).toLowerCase()); }
function hasAny(t, n) { return n.some((x) => has(t, x)); }
function notAny(t, n) { return !n.some((x) => has(t, x)); }

const SCENARIOS = [
  // --- PDP templates with emoji (real Wati format) ---
  { name: 'pdp-emoji: iPhone 17 Sage', turns: [
    { q: "Hi 👋 I'd like some assistance with iPhone 17 256GB Sage With FaceTime – alAsil.", expect: (r) => hasAny(r.message, ['iphone 17', 'sage']) },
  ] },
  { name: 'pdp-emoji: iPhone 15 Pro Max', turns: [
    { q: "Hi, I'm interested in iPhone 15 Pro Max 256GB Natural Titanium With FaceTime - International Version. Can you check the availability?", expect: (r) => hasAny(r.message, ['iphone 15 pro max', 'availability', 'stock']) },
  ] },
  { name: 'pdp-emoji: HomePod mini', turns: [
    { q: "Hi 👋 I'd like some assistance with HomePod mini Blue – alAsil.", expect: (r) => hasAny(r.message, ['homepod']) },
  ] },
  { name: 'pdp-emoji: Location for delivery', turns: [
    { q: "Hi 👋 I'd like some assistance with Location for delivery – alAsil.", expect: (r) => hasAny(r.message, ['delivery', 'address', 'emirate', 'dubai', 'team']) },
  ] },

  // --- availability questions ---
  { name: 'avail: when will be back in stock', turns: [
    { q: "Can I know when will the iPhone 17 512GB be on your store? (Nano Sim+eSim)", expect: (r) => hasAny(r.message, ['check', 'team', 'notify', 'stock']) },
  ] },
  { name: 'avail: have iphone 17 pro max 256gb', turns: [
    { q: "You have iphone 17 pro max 256gb", expect: (r) => hasAny(r.message, ['iphone 17 pro max']) },
  ] },

  // --- brand new / authenticity ---
  { name: 'auth: brand new', turns: [
    { q: "Brand new", expect: (r) => hasAny(r.message, ['authentic', 'brand new', 'apple', 'yes', 'sealed']) },
  ] },
  { name: 'auth: original?', turns: [
    { q: "Are your products original?", expect: (r) => hasAny(r.message, ['authentic', '100%', 'original', 'apple']) },
  ] },

  // --- version ---
  { name: 'ver: but international right?', turns: [
    { q: "But its international right?", expect: (r) => hasAny(r.message, ['international', 'version', 'face']) },
  ] },
  { name: 'ver: UAE no facetime?', turns: [
    { q: "And what you get here in the apple store is the uae version without facetime?", expect: (r) => hasAny(r.message, ['uae', 'middle east', 'no', 'disabled', 'without']) },
  ] },

  // --- payment variants ---
  { name: 'pay: can I buy with Tabby', turns: [
    { q: "Can i buy with Tabby", expect: (r) => hasAny(r.message, ['tabby']) },
  ] },
  { name: 'pay: cash on delivery for items', turns: [
    { q: "Can i pay cash on delivery for my items?", expect: (r) => hasAny(r.message, ['cod', 'cash', '1,500', '1500']) },
  ] },
  { name: 'pay: installment', turns: [
    { q: "At installment", expect: (r) => hasAny(r.message, ['tabby', 'tamara', 'installment']) },
  ] },

  // --- delivery-timing questions (real) ---
  { name: 'deliv: how long if i purchase today', turns: [
    { q: "How long it takes to deliver this item if i purchase today?", expect: (r) => hasAny(r.message, ['same', '6 pm', '1-3', '1–3', 'business', 'today']) },
  ] },
  { name: 'deliv: will i get today', turns: [
    { q: "Will I get the order today as it was mentioned on the website?", expect: (r) => hasAny(r.message, ['same', '6 pm', 'yes', 'dubai']) },
  ] },
  { name: 'deliv: in evening', turns: [
    { q: "Can u get my order in the evening?", expect: (r) => hasAny(r.message, ['team', 'check', 'same', 'dispatch']) },
  ] },

  // --- address sharing ---
  { name: 'addr: aljada sharjah', turns: [
    { q: "Aljada sharjah", expect: (r) => hasAny(r.message, ['sharjah', '1-3', '1–3', 'business', 'delivery', 'address']) },
  ] },
  { name: 'addr: deira', turns: [
    { q: "And this person is in deira", expect: (r) => hasAny(r.message, ['deira', 'dubai', 'same', 'delivery']) },
  ] },

  // --- store info ---
  { name: 'store: do you have physical store', turns: [
    { q: "Do you have physical store to visit?", expect: (r) => hasAny(r.message, ['deira', 'gargash', 'address', 'dubai']) },
  ] },
  { name: 'store: can i come to shop', turns: [
    { q: "Can I come to your shop?", expect: (r) => hasAny(r.message, ['deira', 'gargash', 'dubai', 'hours']) },
  ] },

  // --- used / refurbished (should deflect: we only sell new/authentic) ---
  { name: 'used: do you offer used', turns: [
    { q: "Do you offer used items?", expect: (r) => hasAny(r.message, ['new', 'authentic', 'only', 'brand']) },
  ] },
  { name: 'used: refurbished', turns: [
    { q: "Do you have refurbished iphones?", expect: (r) => hasAny(r.message, ['new', 'authentic', 'brand', 'only']) },
  ] },

  // --- order tracking ---
  { name: 'order: any update on my order', turns: [
    { q: "Any update on my order?", expect: (r) => hasAny(r.message, ['order', 'number', 'team', 'tracking', 'share']) },
  ] },
  { name: 'order: check my order number', turns: [
    { q: "Can you check my order number?", expect: (r) => hasAny(r.message, ['order', 'share', 'team', 'number']) },
  ] },
  { name: 'order: cancel due late', turns: [
    { q: "please cancel the order due to late delivery", expect: (r) => hasAny(r.message, ['team', 'cancel', 'order', 'support']) },
  ] },

  // --- call / contact ---
  { name: 'contact: can i call you', turns: [
    { q: "Can I call you?", expect: (r) => hasAny(r.message, ['+971', '288', '5680', 'call', 'phone']) },
  ] },

  // --- out of scope ---
  { name: 'oos: asus laptop', turns: [
    { q: "ASUS Laptop ROG Sins G17", expect: (r) => hasAny(r.message, ['apple', 'only', "don't", 'focus']) && r.message.length < 400 },
  ] },
  { name: 'oos: noon marketplace', turns: [
    { q: "Can i find the shop name on noon?", expect: (r) => hasAny(r.message, ['alasil.ae', 'website', 'our store', 'only']) },
  ] },
  { name: 'oos: farsi rude', turns: [
    { q: "Boro be zendegit beres", expect: (r) => r.message.length < 400 && r.message.length > 0 },
  ] },

  // --- ambiguous short inputs ---
  { name: 'ambig: Blue ?', turns: [
    { q: "iphone 17" },
    { q: "Blue?", expect: (r) => hasAny(r.message, ['blue', 'iphone']) },
  ] },
  { name: 'ambig: size?', turns: [
    { q: "ipad air" },
    { q: "size?", expect: (r) => hasAny(r.message, ['11', '13', 'inch']) },
  ] },

  // --- cellular / sim ---
  { name: 'sim: ipad A16 cellular', turns: [
    { q: "Am looking for iPad 11th generation A16 cellular type", expect: (r) => hasAny(r.message, ['a16', 'ipad', 'cellular']) },
  ] },
  { name: 'sim: which sim iphone 17', turns: [
    { q: "iphone 17" },
    { q: "which SIM?", expect: (r) => hasAny(r.message, ['esim', 'dual', 'nano']) },
  ] },

  // --- price concerns / objections ---
  { name: 'price: official price', turns: [
    { q: "Because the official price is just 3400 for iphone 17", expect: (r) => hasAny(r.message, ['price', 'stock', 'aed', 'team', 'check']) },
  ] },

  // --- color ---
  { name: 'color: change just color same phone', turns: [
    { q: "iphone 17 pro max" },
    { q: "I wasn't sure if it's possible to change just color same phone?", expect: (r) => hasAny(r.message, ['color', 'available', 'orange', 'silver', 'deep blue', 'team']) },
  ] },

  // --- buy confirmation flow ---
  { name: 'buy: send me the link', turns: [
    { q: "airpods pro 3" },
    { q: "send me the link", expect: (r) => hasAny(r.message, ['alasil.ae/products', 'airpods pro']) },
  ] },
  { name: 'buy: yes after single product', turns: [
    { q: "apple pencil pro" },
    { q: "yes", expect: (r) => hasAny(r.message, ['alasil.ae/products', 'pencil']) },
  ] },

  // --- multilingual greetings ---
  { name: 'lang: salaams', turns: [
    { q: "Salaams", expect: (r) => hasAny(r.message, ['hi', 'welcome', 'salam', 'alaikum', 'looking']) && r.message.length < 350 },
  ] },
  { name: 'lang: hola', turns: [
    { q: "hola", expect: (r) => hasAny(r.message, ['hi', 'welcome', 'looking']) && r.message.length < 350 },
  ] },
  { name: 'lang: هلا', turns: [
    { q: "هلا", expect: (r) => r.message.length > 0 && r.message.length < 350 },
  ] },
];

(async () => {
  console.log(`Running ${SCENARIOS.length} real-world scenarios\n`);
  const results = [];
  for (const s of SCENARIOS) {
    const sessionId = `real-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let finalResp = null, finalExpect = null;
    for (let i = 0; i < s.turns.length; i++) {
      const resp = await ask(sessionId, s.turns[i].q, i === 0);
      finalResp = resp;
      if (s.turns[i].expect) finalExpect = s.turns[i].expect;
    }
    const status = finalExpect ? (finalExpect(finalResp) ? 'PASS' : 'FAIL') : 'PASS';
    results.push({ name: s.name, status, msg: (finalResp?.message || '').slice(0, 200).replace(/\n+/g, ' ') });
    console.log(`${status === 'PASS' ? 'OK  ' : 'FAIL'} | ${s.name}`);
  }
  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n=== ${pass}/${results.length} passed ===\n`);
  for (const r of results.filter((r) => r.status === 'FAIL')) {
    console.log(`  FAIL | ${r.name} → "${r.msg}"`);
  }
})();
