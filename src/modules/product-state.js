// Product-discovery state machine.
//
// Every shopping turn needs a deterministic answer to: "what has the customer
// told us so far, and what's still missing?" Without this, the LLM has to
// re-read the full conversation every turn and sometimes forgets a spec the
// customer already gave — leading to re-asked questions and wrong narrowing.
//
// This module owns the structured state. On each turn we:
//   1. Take the customer's latest message + the prior conversation history.
//   2. Run extractors over every user message to pull out specs.
//   3. Merge them into one state object (later values override only if set).
//   4. Report which attributes are missing for the current category.
//
// The state object lives in-memory per-turn (derived from history) and is
// rendered into the context block for the LLM to consume.

const CATEGORY_MINIMUMS = {
  iPhone:        ['family', 'storage_gb'],
  Mac:           ['family', 'chip'],
  iPad:          ['family', 'chip'],
  'Apple Watch': ['family', 'case_size'],
  AirPods:       ['family'],
  Accessory:     ['family'],
};

// Per-category full question order (from SYSTEM_PROMPT). State is considered
// "complete" when every field in the list is filled.
const CATEGORY_ORDER = {
  iPhone:        ['family', 'storage_gb', 'color', 'sim', 'region'],
  Mac:           ['family', 'chip', 'screen_size', 'ram_gb', 'storage_gb', 'color'],
  iPad:          ['family', 'chip', 'screen_size', 'connectivity', 'storage_gb', 'color'],
  'Apple Watch': ['family', 'case_size', 'connectivity', 'case_material', 'band'],
  AirPods:       ['family', 'sub_model', 'charging', 'color'],
  Accessory:     ['family', 'compatible_device', 'variant', 'color'],
};

// Category detection. Mirrors the keyword logic in tools/index.js so the LLM
// and the state machine agree on what category a phrase refers to.
function detectCategory(msg) {
  const s = msg.toLowerCase();
  // Accessory cues are checked first because "iphone 17 case" should become
  // Accessory, not iPhone.
  if (/\b(case|cover|folio|sleeve|band|strap|loop|charger|cable|adapter|screen\s*protector|tempered\s*glass|airtag|dock|stand|grip|kickstand|pencil|magic\s*(keyboard|mouse|trackpad)|magsafe)\b/.test(s)) {
    return 'Accessory';
  }
  if (/\biphone\b/.test(s)) return 'iPhone';
  if (/\bipad\b/.test(s)) return 'iPad';
  // Mac patterns include both formal ("MacBook Pro") and casual abbreviations
  // customers actually use ("mac air", "macair", "mac pro" — once the
  // category is Mac, "pro" means MacBook Pro). Order: more-specific first.
  if (
    /\b(macbook|imac)\b/.test(s) ||
    /\bmac\s*(mini|studio|air|pro|neo)\b/.test(s) ||
    /\b(macair|macpro|macneo)\b/.test(s) ||
    /\blaptop\b/.test(s)
  ) {
    return 'Mac';
  }
  if (/\bapple\s*watch\b|\bwatch\s*(ultra|series|se)\b/.test(s)) return 'Apple Watch';
  if (/\bairpods?\b/.test(s)) return 'AirPods';
  if (/\bvision\s*pro\b/.test(s)) return 'Vision Pro';
  if (/\bhomepod\b/.test(s)) return 'HomePod';
  return null;
}

// Family detection per category. Uses the specific family name the customer
// used, so "iPhone 17 Pro Max" → family "iPhone 17 Pro Max" (not just "iPhone 17").
function detectFamily(msg, category) {
  const s = msg.toLowerCase();
  if (category === 'iPhone') {
    if (/\biphone\s*air\b/.test(s)) return 'iPhone Air';
    if (/\biphone\s*se\b/.test(s)) return 'iPhone SE';
    const m = s.match(/\biphone\s*(\d{1,2})\s*(pro\s*max|pro|plus|mini|e)?\b/);
    if (m) {
      const base = `iPhone ${m[1]}`;
      if (!m[2]) return base;
      const suf = m[2].replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `${base} ${suf}`;
    }
  }
  if (category === 'Mac') {
    // Full names
    if (/\bmacbook\s*pro\b/.test(s)) return 'MacBook Pro';
    if (/\bmacbook\s*air\b/.test(s)) return 'MacBook Air';
    if (/\bmacbook\s*neo\b/.test(s)) return 'MacBook Neo';
    if (/\bmac\s*mini\b/.test(s)) return 'Mac mini';
    if (/\bmac\s*studio\b/.test(s)) return 'Mac Studio';
    if (/\bimac\b/.test(s)) return 'iMac';
    // Casual abbreviations Mohammad's customers use ("mac air", "macair",
    // "mac pro" — the latter only makes sense once we already know the
    // category is Mac, so a bare "pro" here means MacBook Pro).
    if (/\b(mac\s*air|macair)\b/.test(s)) return 'MacBook Air';
    if (/\b(mac\s*pro|macpro)\b/.test(s)) return 'MacBook Pro';
    if (/\b(mac\s*neo|macneo)\b/.test(s)) return 'MacBook Neo';
  }
  if (category === 'iPad') {
    if (/\bipad\s*pro\b/.test(s)) return 'iPad Pro';
    if (/\bipad\s*air\b/.test(s)) return 'iPad Air';
    if (/\bipad\s*mini\b/.test(s)) return 'iPad mini';
    if (/\bipad\b/.test(s)) return 'iPad';
  }
  if (category === 'Apple Watch') {
    const ultra = s.match(/\bultra\s*(\d+)?\b/);
    if (ultra) return ultra[1] ? `Apple Watch Ultra ${ultra[1]}` : 'Apple Watch Ultra';
    const ser = s.match(/\bseries\s*(\d+)\b/);
    if (ser) return `Apple Watch Series ${ser[1]}`;
    if (/\bwatch\s*se\b/.test(s)) return 'Apple Watch SE';
  }
  if (category === 'AirPods') {
    if (/\bairpods\s*pro\s*(\d+)?\b/.test(s)) {
      const m = s.match(/\bairpods\s*pro\s*(\d+)?\b/);
      return m[1] ? `AirPods Pro ${m[1]}` : 'AirPods Pro';
    }
    if (/\bairpods\s*max\b/.test(s)) return 'AirPods Max';
    const gen = s.match(/\bairpods\s*(\d+)\b/);
    if (gen) return `AirPods ${gen[1]}`;
  }
  return null;
}

// Chip / M-series / A-series detection. Captures "M5 Pro", "M4 Max", "A18 Pro".
function detectChip(msg) {
  const s = msg.toLowerCase();
  let m = s.match(/\bm([1-9])\s*(pro\s*max|pro|max|ultra)\b/);
  if (m) {
    const suf = m[2].replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `M${m[1]} ${suf}`;
  }
  m = s.match(/\bm([1-9])\b/);
  if (m) return `M${m[1]}`;
  m = s.match(/\ba(1[4-9]|20)\s*(pro|bionic)?\b/);
  if (m) {
    const base = `A${m[1]}`;
    return m[2] ? `${base} ${m[2].replace(/\b\w/g, (c) => c.toUpperCase())}` : base;
  }
  return null;
}

// Storage parsing. "256gb", "1tb", "512 gb". Skips matches immediately
// preceded or followed by "ram"/"memory" so they don't pollute storage.
// Picks the LAST storage-looking value (to handle "24GB RAM 1TB" → 1TB).
function detectStorage(msg) {
  const s = msg.toLowerCase();
  const matches = [...s.matchAll(/\b(\d+(?:\.\d+)?)\s*(gb|tb)\b/g)];
  if (matches.length === 0) return null;
  // Filter out RAM/memory-labelled matches.
  const nonRam = matches.filter((m) => {
    const before = s.slice(Math.max(0, m.index - 10), m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 15);
    if (/\b(ram|memory)\b/.test(before + ' ')) return false;
    if (/^\s*(ram|memory|unified)\b/.test(after)) return false;
    return true;
  });
  const winner = nonRam.length > 0 ? nonRam[nonRam.length - 1] : matches[matches.length - 1];
  const n = parseFloat(winner[1]);
  return winner[2] === 'tb' ? Math.round(n * 1024) : Math.round(n);
}

// Bare-number storage inference. When the whole message is basically a
// standalone number like "256" or "512" or "1" and we already have a
// category in the state, treat it as storage. Only called when the plain
// detectStorage returned null and the message has no other strong signal.
function detectStorageFromBareNumber(msg, knownCategory) {
  if (!knownCategory) return null;
  const s = msg.trim().toLowerCase();
  const m = s.match(/^(\d{2,4})\s*(gb)?\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // Common Apple storage sizes.
  if ([64, 128, 256, 512, 1024, 2048, 4096, 8192].includes(n)) return n;
  // "1" or "2" → TB, bare
  const tbMatch = s.match(/^(\d+)\s*tb\s*$/);
  if (tbMatch) return parseInt(tbMatch[1], 10) * 1024;
  return null;
}

// RAM parsing. "16gb ram" / "24gb memory" — requires the "ram"/"memory"
// keyword so we don't confuse it with storage.
function detectRam(msg) {
  const s = msg.toLowerCase();
  const m = s.match(/\b(\d+)\s*gb\s*(ram|memory)\b/);
  if (m) return parseInt(m[1], 10);
  // Also catch bare "24gb" only if accompanied with a MacBook/iPad context
  // word AND storage already detected. Skipped for safety.
  return null;
}

// Screen size for Mac/iPad. Recognises 11-27 inch + common Mac 13.6/15.3.
function detectScreenSize(msg) {
  const s = msg.toLowerCase();
  const m = s.match(/\b(1[1-9]|2[0-7])(?:\.(\d))?\s*(?:inch|in|"|”)?\b(?!\s*(?:gb|tb|ram|memory|ssd|hdd))/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if ([11, 13, 14, 15, 16, 24, 27].includes(n)) return n;
  return null;
}

// Apple Watch case size: 41mm / 45mm / 46mm / 49mm.
function detectCaseSize(msg) {
  const m = msg.toLowerCase().match(/\b(41|42|44|45|46|49)\s*mm\b/);
  return m ? `${m[1]}mm` : null;
}

// Connectivity for iPad / Watch. "cellular" → Wi-Fi + Cellular, bare "wifi" → Wi-Fi.
function detectConnectivity(msg) {
  const s = msg.toLowerCase();
  if (/\bwi-?fi\s*\+\s*cellular\b|\bcellular\b|\bsim\b|\b5g\b/.test(s)) {
    // If GPS also mentioned → GPS + Cellular (for Watch)
    if (/\bgps\b/.test(s)) return 'GPS + Cellular';
    return 'Wi-Fi + Cellular';
  }
  if (/\bwi-?fi\b(?!\s*\+)/.test(s)) {
    if (/\bgps\b/.test(s)) return 'GPS';
    return 'Wi-Fi';
  }
  if (/\bgps\s*\+\s*cellular\b/.test(s)) return 'GPS + Cellular';
  if (/\bgps\b/.test(s)) return 'GPS';
  return null;
}

// Region / Middle East vs International.
function detectRegion(msg) {
  const s = msg.toLowerCase();
  if (/\bmiddle\s*east\b|\bme\s*version\b|\buae\s*version\b|\btdra\b/.test(s)) return 'Middle East';
  if (/\binternational\b|\bint[l\s]*\b|\bfacetime\b/.test(s)) return 'International';
  return null;
}

// SIM type.
function detectSim(msg) {
  const s = msg.toLowerCase();
  if (/\bdual\s*esim\b/.test(s)) return 'Dual eSIM';
  if (/\bnano\s*sim\s*\+\s*esim\b/.test(s)) return 'Nano SIM + eSIM';
  if (/\besim\b/.test(s)) return 'eSIM';
  return null;
}

// Colour detection — broad list covers every colour used in the catalog.
// Order matters: multi-word compounds come FIRST so "Sky Blue" matches as
// "Sky Blue" before the loop tries the single-word "blue".
const COLOR_WORDS = [
  // Multi-word compounds (ordered first so they win priority)
  'rose\\s*gold','sierra\\s*blue','alpine\\s*green','pacific\\s*blue','deep\\s*blue',
  'natural\\s*titanium','desert\\s*titanium','cosmic\\s*orange','sky\\s*blue',
  'light\\s*gold','cloud\\s*white','jet\\s*black','space\\s*black','space\\s*(gray|grey)',
  // Single-word colors (matched only if no compound hit)
  'titanium','midnight','starlight','graphite','lavender','mint','champagne',
  'black','white','silver','gold','rose','pink','blue','red','green',
  'yellow','purple','orange','teal'
];
function detectColor(msg) {
  const s = msg.toLowerCase();
  for (const c of COLOR_WORDS) {
    const re = new RegExp('\\b(' + c + ')\\b');
    const m = s.match(re);
    if (m) return m[1].replace(/\s+/g, ' ');
  }
  return null;
}

// Sub-model / special feature (AirPods 4 ANC, Magic Keyboard, etc.)
function detectSubModel(msg, category) {
  const s = msg.toLowerCase();
  if (category === 'AirPods') {
    if (/\b(anc|active\s*noise\s*cancell?ation)\b/.test(s)) return 'with ANC';
    if (/\bstandard\b|\bwithout\s*anc\b/.test(s)) return 'Standard';
  }
  return null;
}

// Charging type (AirPods Lightning vs USB-C).
function detectCharging(msg) {
  const s = msg.toLowerCase();
  if (/\busb[-\s]?c\b/.test(s)) return 'USB-C';
  if (/\blightning\b/.test(s)) return 'Lightning';
  return null;
}

// Apple Watch case material.
function detectCaseMaterial(msg) {
  const s = msg.toLowerCase();
  if (/\btitanium\b/.test(s)) return 'Titanium';
  if (/\baluminum\b|\baluminium\b/.test(s)) return 'Aluminum';
  if (/\bstainless\s*steel\b/.test(s)) return 'Stainless Steel';
  return null;
}

// Parse all specs out of a single user message.
export function extractSpecsFromMessage(msg) {
  if (!msg || typeof msg !== 'string') return {};
  const specs = {};
  const category = detectCategory(msg);
  if (category) specs.category = category;
  if (category) {
    const fam = detectFamily(msg, category);
    if (fam) specs.family = fam;
  }
  const chip = detectChip(msg);
  if (chip) specs.chip = chip;
  const storage = detectStorage(msg);
  if (storage) specs.storage_gb = storage;
  const ram = detectRam(msg);
  if (ram) specs.ram_gb = ram;
  const screen = detectScreenSize(msg);
  if (screen) specs.screen_size = screen;
  const caseSize = detectCaseSize(msg);
  if (caseSize) specs.case_size = caseSize;
  const conn = detectConnectivity(msg);
  if (conn) specs.connectivity = conn;
  const region = detectRegion(msg);
  if (region) specs.region = region;
  const sim = detectSim(msg);
  if (sim) specs.sim = sim;
  const color = detectColor(msg);
  if (color) specs.color = color;
  const sub = detectSubModel(msg, category);
  if (sub) specs.sub_model = sub;
  const charging = detectCharging(msg);
  if (charging) specs.charging = charging;
  const caseMat = detectCaseMaterial(msg);
  if (caseMat) specs.case_material = caseMat;
  return specs;
}

// Merge specs into the running state. Later specs override earlier ones ONLY
// if they are present (never clobber a known value with null).
export function mergeState(state, specs) {
  const next = { ...state };
  for (const [k, v] of Object.entries(specs)) {
    if (v !== null && v !== undefined && v !== '') next[k] = v;
  }
  return next;
}

// Build the full state by replaying every user message in order.
//
// Family/category change detection: when a customer pivots from one family
// to another mid-conversation ("MacBook Pro M1 Pro 32GB" → "what about
// mac air"), the OLD attributes (chip, ram, storage, etc.) no longer make
// sense and would produce wrong filters. On every family/category change
// we RESET the attribute slate so the bot re-asks from scratch — exactly
// as Mohammad wants: "family change = start fresh check with customer".
export function buildStateFromHistory(history, latestMessage) {
  const emptyState = () => ({
    category: null,
    family: null,
    chip: null,
    screen_size: null,
    case_size: null,
    ram_gb: null,
    storage_gb: null,
    color: null,
    connectivity: null,
    region: null,
    sim: null,
    sub_model: null,
    charging: null,
    case_material: null,
    confirmed: false,
    link_requested: false,
  });
  let state = emptyState();
  const userMessages = [
    ...(history || []).filter((h) => h.role === 'user').map((h) => String(h.text || '')),
    String(latestMessage || ''),
  ].filter(Boolean);
  for (const msg of userMessages) {
    const specs = extractSpecsFromMessage(msg);
    // Context-aware bare-number storage inference. If the message was just
    // "256" / "512" / "1TB" and we already have a category known, treat it
    // as storage.
    if (!specs.storage_gb) {
      const bare = detectStorageFromBareNumber(msg, state.category);
      if (bare) specs.storage_gb = bare;
    }
    // Family / category CHANGE detection. If this turn specifies a family
    // or category different from the running state, reset the
    // attribute slate so the customer is re-asked for specs under the new
    // family. Confirmation / link flags are category-scoped too and reset.
    const newFamilyDiffers = specs.family && state.family && specs.family !== state.family;
    const newCategoryDiffers = specs.category && state.category && specs.category !== state.category;
    if (newFamilyDiffers || newCategoryDiffers) {
      state = emptyState();
    }
    state = mergeState(state, specs);
  }

  // Confirmation heuristic: latest message is a short confirmation phrase.
  // Keep the set broad — customers commonly type "y", "yep", "aha", etc.
  const latest = String(latestMessage || '').trim().toLowerCase().replace(/[.!?]+$/, '');
  const CONFIRM_WORDS = new Set([
    'yes','y','yep','yeah','yah','ya','aha','uh-huh',
    'ok','okay','k','kk','sure','right','correct','exactly',
    'confirm','confirmed','proceed','go ahead','go',
    'that is the one','thats the one','that one','this one',
    'yes please','ok please','yes sure','yes confirm',
    // Farsi / Arabic / Finglish variants
    'بله','اوکی','درسته','همینه','نعم','تمام','صح','اه','آره','are','areh',
    'باشه','نعم نعم','حسناً','تايد','هست','hast','bale','baleh',
  ]);
  if (CONFIRM_WORDS.has(latest)) state.confirmed = true;

  // Link-requested heuristic
  if (/\blink\b|\bsend\b|\burl\b/i.test(latest)) state.link_requested = true;

  return state;
}

// What attributes are still missing from the current state for the bot to
// proceed? Returns the list in priority order per category.
export function missingAttributes(state) {
  if (!state.category) return ['category'];
  const order = CATEGORY_ORDER[state.category] || [];
  return order.filter((attr) => !state[attr]);
}

// Next attribute to ask the customer about — first missing in the order.
export function nextAttribute(state) {
  const missing = missingAttributes(state);
  return missing[0] || null;
}

// Has the minimum needed to quote availability / price?
export function hasMinimumSpecs(state) {
  const mins = CATEGORY_MINIMUMS[state.category] || [];
  return mins.every((attr) => Boolean(state[attr]));
}

// Detect whether the latest message contains Apple-product HINTS that the
// regex-based extractor may have missed (typos, transliterations, mixed
// scripts). Used by the prompt to tell the LLM "state looks empty but the
// message might still be shopping — call findProduct to verify."
export function messageLooksLikeShoppingDespiteEmptyState(msg, state) {
  if (state.category) return false; // state not empty, no need
  const s = String(msg || '').toLowerCase();
  // Transliteration / typo / non-Latin hints for Apple products
  const HINTS = [
    'iphon', 'aifon', 'ayfon',        // iPhone typos / Finglish
    'ای فون', 'ايفون', 'آيفون',       // Farsi / Arabic iPhone
    'ipad', 'ai ped', 'ai pad',        // iPad typos
    'macbook', 'makbook', 'makbuk',    // MacBook typos
    'ماك بوك', 'مک بوک',              // Arabic/Farsi MacBook
    'airpod', 'ear pod', 'earpod',     // AirPods typos
    'apple watch', 'i watch', 'iwatch',// Watch typos
    'mac mini', 'imac', 'mac studio',
    'vision pro', 'homepod', 'apple tv'
  ];
  for (const h of HINTS) {
    if (s.includes(h)) return true;
  }
  return false;
}

// Produce a compact human-readable state summary the LLM can read verbatim
// and use for decisions. Kept short to save context tokens.
export function formatStateForPrompt(state) {
  const lines = ['# PRODUCT STATE (auto-tracked from the conversation)'];
  const known = {
    Category: state.category,
    Family: state.family,
    Chip: state.chip,
    'Screen size': state.screen_size ? `${state.screen_size}"` : null,
    'Case size': state.case_size,
    RAM: state.ram_gb ? `${state.ram_gb}GB` : null,
    Storage: state.storage_gb
      ? state.storage_gb >= 1024
        ? `${state.storage_gb / 1024}TB`
        : `${state.storage_gb}GB`
      : null,
    Color: state.color,
    Connectivity: state.connectivity,
    Region: state.region,
    SIM: state.sim,
    'Sub-model': state.sub_model,
    Charging: state.charging,
    'Case material': state.case_material,
  };
  for (const [k, v] of Object.entries(known)) {
    lines.push(`${k.padEnd(13)}: ${v || '—'}`);
  }
  lines.push('');
  lines.push(`Confirmed: ${state.confirmed ? 'YES' : 'no'}`);
  lines.push(`Link requested: ${state.link_requested ? 'YES' : 'no'}`);
  lines.push('');
  const missing = missingAttributes(state);
  if (missing.length === 0) {
    lines.push('Missing: (none — all attributes gathered)');
  } else {
    lines.push(`Missing (priority order): ${missing.join(' → ')}`);
    lines.push(`Next to ask: **${missing[0]}**`);
  }
  lines.push('');
  lines.push(
    hasMinimumSpecs(state)
      ? 'Minimum specs gathered — findProduct results can be used for availability/price.'
      : 'Minimum specs NOT yet gathered — ask the customer for the missing attribute first.'
  );
  return lines.join('\n');
}
