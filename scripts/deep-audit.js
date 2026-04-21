#!/usr/bin/env node
// Deep audit: every category + every FAQ topic + edge cases.
// Goal: find root-cause bugs, not cosmetic ones.

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
function hasAll(t, n) { return n.every((x) => has(t, x)); }
function not(t, n) { return !n.some((x) => has(t, x)); }

const SCENARIOS = [
  // === CATEGORIES (16) — each should retrieve products or ask meaningful clarification ===
  { name: 'cat:iphone',  q: 'iphone',  check: (r) => (r.type === 'question' || hasAny(r.message, ['iphone'])) },
  { name: 'cat:ipad',    q: 'ipad',    check: (r) => (r.type === 'question' || hasAny(r.message, ['ipad'])) },
  { name: 'cat:mac',     q: 'mac',     check: (r) => (r.type === 'question' || hasAny(r.message, ['mac', 'macbook'])) },
  { name: 'cat:airpods', q: 'airpods', check: (r) => hasAny(r.message, ['airpods']) },
  { name: 'cat:watch',   q: 'apple watch', check: (r) => hasAny(r.message, ['watch', 'apple watch']) },
  { name: 'cat:vision',  q: 'vision pro', check: (r) => hasAny(r.message, ['vision', 'team', 'check', 'stock']) },
  { name: 'cat:homepod', q: 'homepod', check: (r) => hasAny(r.message, ['homepod', 'speaker']) },
  { name: 'cat:appletv', q: 'apple tv', check: (r) => hasAny(r.message, ['apple tv', 'tv']) },
  { name: 'cat:display', q: 'studio display', check: (r) => hasAny(r.message, ['display', 'studio']) },
  { name: 'cat:dyson',   q: 'dyson airwrap', check: (r) => hasAny(r.message, ['dyson', 'airwrap', 'stock', 'team']) },
  { name: 'cat:speaker-jbl', q: 'jbl speaker', check: (r) => hasAny(r.message, ['jbl', 'speaker']) },
  { name: 'cat:speaker-bose', q: 'bose soundlink', check: (r) => hasAny(r.message, ['bose', 'soundlink', 'speaker', 'stock', 'team']) },
  { name: 'cat:headphone-bose', q: 'bose quietcomfort', check: (r) => hasAny(r.message, ['bose', 'quietcomfort', 'stock', 'team', 'headphone']) },
  { name: 'cat:headphone-sony', q: 'sony wh-1000xm5', check: (r) => hasAny(r.message, ['sony', 'headphone', 'stock', 'team']) },
  { name: 'cat:earbuds',  q: 'beats studio buds', check: (r) => hasAny(r.message, ['beats', 'studio buds', 'earbud', 'stock', 'team']) },
  { name: 'cat:accessory', q: 'apple pencil pro', check: (r) => hasAny(r.message, ['pencil', 'pro', 'AED']) },

  // === SPECIFIC PRODUCTS (20) ===
  { name: 'sp:iphone17-pro-max-256', q: 'iphone 17 pro max 256gb', check: (r) => hasAny(r.message, ['iphone 17 pro max', '256']) },
  { name: 'sp:iphone17-pro', q: 'iphone 17 pro', check: (r) => hasAny(r.message, ['iphone 17 pro']) },
  { name: 'sp:iphone-air', q: 'iphone air', check: (r) => hasAny(r.message, ['iphone air', 'storage', 'which']) },
  { name: 'sp:iphone-17', q: 'iphone 17', check: (r) => hasAny(r.message, ['iphone 17', 'storage', 'which']) },
  { name: 'sp:iphone-16-pro', q: 'iphone 16 pro', check: (r) => hasAny(r.message, ['iphone 16', 'stock', 'team', 'storage']) },
  { name: 'sp:macbook-air-m5', q: 'macbook air m5', check: (r) => hasAny(r.message, ['macbook air', 'storage']) },
  { name: 'sp:macbook-pro-m5-pro', q: 'macbook pro m5 pro', check: (r) => hasAny(r.message, ['macbook pro', 'm5 pro']) },
  { name: 'sp:macbook-pro-16-max', q: 'macbook pro 16 m5 max', check: (r) => hasAny(r.message, ['macbook pro', 'm5 max']) },
  { name: 'sp:mac-mini', q: 'mac mini m4', check: (r) => hasAny(r.message, ['mac mini', 'm4', 'stock', 'team']) },
  { name: 'sp:imac-m4', q: 'imac m4', check: (r) => hasAny(r.message, ['imac', 'stock', 'team']) },
  { name: 'sp:ipad-pro-m5', q: 'ipad pro m5 256', check: (r) => hasAny(r.message, ['ipad pro', 'm5', '256']) },
  { name: 'sp:ipad-air-m4', q: 'ipad air m4 256 purple', check: (r) => hasAny(r.message, ['ipad air', 'm4', '256']) },
  { name: 'sp:ipad-mini', q: 'ipad mini a17', check: (r) => hasAny(r.message, ['ipad mini']) },
  { name: 'sp:airpods-pro-3', q: 'airpods pro 3', check: (r) => hasAny(r.message, ['airpods pro 3', 'aed']) },
  { name: 'sp:airpods-max', q: 'airpods max', check: (r) => hasAny(r.message, ['airpods max']) },
  { name: 'sp:airpods-4', q: 'airpods 4', check: (r) => hasAny(r.message, ['airpods 4']) },
  { name: 'sp:watch-series-11', q: 'apple watch series 11', check: (r) => hasAny(r.message, ['watch series 11', 'watch series']) },
  { name: 'sp:watch-ultra-3', q: 'apple watch ultra 3', check: (r) => hasAny(r.message, ['ultra 3']) },
  { name: 'sp:watch-se-3', q: 'apple watch se 3', check: (r) => hasAny(r.message, ['watch se']) },
  { name: 'sp:apple-pencil-pro', q: 'apple pencil pro', check: (r) => hasAny(r.message, ['pencil pro', 'aed']) },

  // === TYPOS ===
  { name: 'typo:iphoen', q: 'iphoen 17', check: (r) => hasAny(r.message, ['iphone 17']) },
  { name: 'typo:macbbok', q: 'macbbok air', check: (r) => hasAny(r.message, ['macbook air']) },
  { name: 'typo:ippad', q: 'ippad pro', check: (r) => hasAny(r.message, ['ipad pro']) },
  { name: 'typo:air-pods', q: 'air pods pro', check: (r) => hasAny(r.message, ['airpods']) },
  { name: 'typo:promax', q: 'iphone 17 promax', check: (r) => hasAny(r.message, ['pro max']) },

  // === COMPAT (14) ===
  { name: 'compat:pencil1-ipad-air-m4', q: 'Does Apple Pencil 1 work with iPad Air M4?', check: (r) => hasAny(r.message, ['no']) && not(r.message, ['https://']) },
  { name: 'compat:pencil-pro-air-m4', q: 'Is Apple Pencil Pro compatible with iPad Air M4?', check: (r) => hasAny(r.message, ['yes']) },
  { name: 'compat:pencil2-ipad-pro-m4', q: 'Does Pencil 2 work with iPad Pro M4?', check: (r) => hasAny(r.message, ['no']) },
  { name: 'compat:magsafe-iphone-17', q: 'Does iPhone 17 support MagSafe?', check: (r) => hasAny(r.message, ['yes']) },
  { name: 'compat:magsafe-iphone-air', q: 'Does iPhone Air support MagSafe?', check: (r) => hasAny(r.message, ['yes']) },
  { name: 'compat:facetime-uae', q: 'Does UAE iPhone have FaceTime?', check: (r) => hasAny(r.message, ['no', 'disabled']) },
  { name: 'compat:esim-only', q: 'Does iPhone 17 have a physical SIM slot?', check: (r) => hasAny(r.message, ['esim', 'dual', 'no']) },
  { name: 'compat:arabic-keyboard', q: 'Do you have MacBook with Arabic keyboard?', check: (r) => hasAny(r.message, ['keyboard', 'english', 'arabic']) },
  { name: 'compat:usbc-macbook', q: 'Does MacBook charge with USB-C?', check: (r) => hasAny(r.message, ['yes', 'magsafe', 'usb-c']) },
  { name: 'compat:charger-iphone', q: 'Does iPhone 17 come with charger?', check: (r) => hasAny(r.message, ['no', 'cable', 'charge']) },
  { name: 'compat:airpods-case', q: 'Do AirPods Pro 3 come with case?', check: (r) => hasAny(r.message, ['yes', 'magsafe', 'case']) },
  { name: 'compat:pencil-ipad-a16', q: 'Which Pencil for iPad A16?', check: (r) => hasAny(r.message, ['usb-c', 'pencil']) },
  { name: 'compat:ipad-m4-keyboard', q: 'Which keyboard works with iPad Air M4?', check: (r) => hasAny(r.message, ['magic keyboard', 'keyboard']) },
  { name: 'compat:apple-tv-hdr', q: 'Does Apple TV 4K support Dolby Vision?', check: (r) => hasAny(r.message, ['yes', 'dolby', 'support']) },

  // === VERSION / REGION ===
  { name: 'ver:me', q: 'iphone 17 middle east version', check: (r) => hasAny(r.message, ['middle east']) },
  { name: 'ver:intl', q: 'iphone 17 international', check: (r) => hasAny(r.message, ['international']) },
  { name: 'ver:europe-typo', q: 'iphone 17 pro max erupe version', check: (r) => hasAny(r.message, ['international']) },
  { name: 'ver:uk', q: 'iphone 17 uk version', check: (r) => hasAny(r.message, ['international', 'uk']) },
  { name: 'ver:usa', q: 'iphone 17 usa', check: (r) => hasAny(r.message, ['international', 'usa']) },

  // === DELIVERY / SHIPPING ===
  { name: 'deliv:today', q: 'can i get it today?', check: (r) => hasAny(r.message, ['same', '6 pm', 'dubai', 'today']) },
  { name: 'deliv:abu-dhabi', q: 'do you deliver to abu dhabi?', check: (r) => hasAny(r.message, ['yes', 'uae', 'abu dhabi', '1-3', '1–3']) },
  { name: 'deliv:sharjah', q: 'shipping to sharjah?', check: (r) => hasAny(r.message, ['1-3', '1–3', 'business', 'uae']) },
  { name: 'deliv:al-ain', q: 'deliver to al ain?', check: (r) => hasAny(r.message, ['yes', 'uae', 'al ain', '1-3', '1–3']) },
  { name: 'deliv:saudi', q: 'ship to saudi arabia?', check: (r) => hasAny(r.message, ['uae', 'only', 'team']) },
  { name: 'deliv:intl', q: 'do you ship internationally?', check: (r) => hasAny(r.message, ['uae', 'only', 'team']) },
  { name: 'deliv:when-handed', q: 'when will my order be handed to me?', check: (r) => hasAny(r.message, ['tracking', 'same', '6 pm', 'business', 'email', 'whatsapp']) },
  { name: 'deliv:pickup', q: 'can i pick up in store?', check: (r) => hasAny(r.message, ['deira', 'gargash', 'pick', 'store', 'address']) },

  // === PAYMENT ===
  { name: 'pay:tabby', q: 'tabby available?', check: (r) => hasAny(r.message, ['tabby', '4', 'install']) },
  { name: 'pay:tamara', q: 'tamara?', check: (r) => hasAny(r.message, ['tamara']) },
  { name: 'pay:cod', q: 'cash on delivery?', check: (r) => hasAny(r.message, ['cod', 'cash', '1,500', '1500']) },
  { name: 'pay:cod-limit', q: 'can i pay cash for 5000 aed?', check: (r) => hasAny(r.message, ['cash', '1,500', '1500', 'card', 'tabby']) },
  { name: 'pay:apple-pay', q: 'apple pay?', check: (r) => hasAny(r.message, ['apple pay']) },
  { name: 'pay:12-month', q: 'can i pay in 12 months?', check: (r) => hasAny(r.message, ['tabby', 'tamara', 'monthly', '12']) },
  { name: 'pay:6-month', q: '6 month installment?', check: (r) => hasAny(r.message, ['tabby', 'tamara', 'month']) },
  { name: 'pay:bank', q: 'emirates nbd installment plan?', check: (r) => hasAny(r.message, ['tabby', 'tamara', 'bank', 'issuing']) },
  { name: 'pay:card', q: 'do you accept visa?', check: (r) => hasAny(r.message, ['visa', 'card', 'accept']) },
  { name: 'pay:amex', q: 'amex accepted?', check: (r) => hasAny(r.message, ['american express', 'amex']) },

  // === WARRANTY / AUTH ===
  { name: 'warr:1-year', q: 'warranty?', check: (r) => hasAny(r.message, ['1-year', '1 year', 'apple warranty']) },
  { name: 'warr:authentic', q: 'are your products authentic?', check: (r) => hasAny(r.message, ['authentic', '100%', 'apple']) },
  { name: 'warr:brand-new', q: 'brand new?', check: (r) => hasAny(r.message, ['authentic', 'apple', 'yes', 'brand new', 'sealed']) },
  { name: 'warr:refurbished', q: 'do you sell refurbished?', check: (r) => hasAny(r.message, ['new', 'authentic', 'brand', 'only']) },
  { name: 'warr:used', q: 'used iphones?', check: (r) => hasAny(r.message, ['new', 'authentic', 'only']) },

  // === STORE INFO ===
  { name: 'store:address', q: 'where is your shop?', check: (r) => hasAny(r.message, ['deira', 'gargash', 'dubai']) },
  { name: 'store:hours', q: 'what time do you open?', check: (r) => hasAny(r.message, ['10', 'monday', 'saturday']) },
  { name: 'store:phone', q: 'phone number?', check: (r) => hasAny(r.message, ['+971', '288', '5680']) },
  { name: 'store:whatsapp', q: 'whatsapp number?', check: (r) => hasAny(r.message, ['+971', '288', '5680', 'whatsapp']) },

  // === ORDER SUPPORT ===
  { name: 'ord:where', q: 'where is my order?', check: (r) => hasAny(r.message, ['order number', 'tracking', 'team', 'email', 'whatsapp']) },
  { name: 'ord:status', q: 'order status?', check: (r) => hasAny(r.message, ['order', 'team', 'tracking']) },
  { name: 'ord:cancel', q: 'cancel my order', check: (r) => hasAny(r.message, ['team', 'order number', 'support']) },
  { name: 'ord:already-bought', q: 'i already bought', check: (r) => hasAny(r.message, ['order', 'team', 'tracking', 'help']) },

  // === INVOICE / TAX ===
  { name: 'inv:tax-free', q: 'do you make tax free invoice?', check: (r) => hasAny(r.message, ['check', 'team', 'whatsapp', 'confirm']) },
  { name: 'inv:serial', q: 'invoice with serial number?', check: (r) => hasAny(r.message, ['check', 'team', 'whatsapp', 'confirm']) },
  { name: 'inv:vat', q: 'do you charge vat?', check: (r) => hasAny(r.message, ['vat', 'team', 'check']) },
  { name: 'inv:b2b', q: 'do you sell to companies bulk?', check: (r) => hasAny(r.message, ['team', 'bulk', 'check', 'whatsapp']) },

  // === CONTEXT FOLLOW-UPS ===
  { name: 'ctx:how-much-after-pencil', turns: [
    { q: 'apple pencil pro' },
    { q: 'how much?', check: (r) => hasAny(r.message, ['425', 'pencil']) },
  ]},
  { name: 'ctx:colors-after-iphone', turns: [
    { q: 'iphone 17 pro max 256' },
    { q: 'what colors?', check: (r) => hasAny(r.message, ['orange', 'silver', 'blue', 'titanium']) },
  ]},
  { name: 'ctx:warranty-after-macbook', turns: [
    { q: 'macbook air m5' },
    { q: 'warranty?', check: (r) => hasAny(r.message, ['1-year', '1 year', 'warranty']) },
  ]},
  { name: 'ctx:tabby-after-ipad', turns: [
    { q: 'ipad air m4 256 purple' },
    { q: 'tabby?', check: (r) => hasAny(r.message, ['tabby']) },
  ]},

  // === BUY INTENT ===
  { name: 'buy:send-link', turns: [
    { q: 'airpods pro 3' },
    { q: 'send me the link', check: (r) => hasAny(r.message, ['alasil.ae/products', 'airpods pro']) },
  ]},
  { name: 'buy:yes', turns: [
    { q: 'apple pencil pro' },
    { q: 'yes', check: (r) => hasAny(r.message, ['alasil.ae/products', 'pencil']) },
  ]},

  // === NUMERIC / FUZZY PICKS ===
  { name: 'pick:num', turns: [
    { q: 'iphone 17 pro' },
    { q: '256' },
    { q: '1', check: (r) => r.message.length > 10 },
  ]},
  { name: 'pick:color-fuzzy', turns: [
    { q: 'iphone 17 pro max 256' },
    { q: 'blue', check: (r) => hasAny(r.message, ['blue', 'titanium']) },
  ]},

  // === OUT OF SCOPE ===
  { name: 'oos:samsung', q: 'samsung galaxy?', check: (r) => hasAny(r.message, ["don't carry", "don't sell", 'apple', 'team', 'close']) && r.message.length < 500 },
  { name: 'oos:huawei', q: 'huawei phone?', check: (r) => hasAny(r.message, ["don't carry", 'apple', 'bose', 'jbl']) },
  { name: 'oos:weather', q: 'how is the weather?', check: (r) => not(r.message, ['iphone 17', 'ipad', 'macbook']) && r.message.length < 400 },
  { name: 'oos:repair', q: 'fix my screen?', check: (r) => hasAny(r.message, ['repair', 'service', 'authorized', 'team', "don't"]) },
  { name: 'oos:trade-in', q: 'trade in old iphone?', check: (r) => hasAny(r.message, ["don't", 'trade', 'only sell']) },

  // === GREETINGS ===
  { name: 'greet:hi', q: 'hi', check: (r) => hasAny(r.message, ['alasil', 'welcome']) },
  { name: 'greet:hello', q: 'hello', check: (r) => hasAny(r.message, ['alasil', 'welcome']) },
  { name: 'greet:salam', q: 'salam', check: (r) => r.message.length > 0 && r.message.length < 400 },
  { name: 'greet:thanks', q: 'thanks', check: (r) => hasAny(r.message, ['welcome', 'anything else']) },

  // === LANGUAGE ===
  { name: 'lang:farsi-baladi', q: 'farsi baladi?', check: (r) => r.message.length > 0 },
  { name: 'lang:fa-persian', q: 'سلام، آیفون ۱۷ پرو مکس دارید؟', check: (r) => r.message.length > 0 },

  // === HIGHER / LOWER SPEC EXPLORE ===
  { name: 'spec:higher-ram', turns: [
    { q: 'macbook air m5' },
    { q: '512' },
    { q: 'midnight' },
    { q: 'higher ram?', check: (r) => hasAny(r.message, ['24', '16', 'ram']) },
  ]},
  { name: 'spec:bigger-storage', turns: [
    { q: 'iphone 17 pro' },
    { q: '256' },
    { q: 'bigger storage?', check: (r) => hasAny(r.message, ['512', '1tb', '2tb']) },
  ]},
];

async function runScenario(s) {
  const sessionId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let resp = null;
  let check = null;
  if (Array.isArray(s.turns)) {
    for (let i = 0; i < s.turns.length; i++) {
      resp = await ask(sessionId, s.turns[i].q, i === 0);
      if (s.turns[i].check) check = s.turns[i].check;
    }
  } else {
    resp = await ask(sessionId, s.q, true);
    check = s.check;
  }
  return { resp, check };
}

(async () => {
  console.log(`Running ${SCENARIOS.length} scenarios\n`);
  const results = [];
  for (const s of SCENARIOS) {
    const { resp, check } = await runScenario(s);
    const ok = check ? check(resp) : true;
    results.push({ name: s.name, ok, msg: (resp?.message || '').slice(0, 120).replace(/\n+/g, ' ') });
    process.stdout.write(`${ok ? 'OK  ' : 'FAIL'} | ${s.name}\n`);
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} passed ===\n`);
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  FAIL | ${r.name} → "${r.msg}"`);
  }
})();
