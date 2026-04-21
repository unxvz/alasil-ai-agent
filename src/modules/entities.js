const CATEGORY_MAP = [
  { re: /\b(macbook\s*pro|mbp)s?\b/i,          category: 'Mac',    family: 'MacBook Pro' },
  { re: /\b(macbook\s*air|mba)s?\b/i,          category: 'Mac',    family: 'MacBook Air' },
  { re: /\b(macbook|mac\s*book)s?\b/i, category: 'Mac', family: 'MacBook Air' },
  { re: /\bmac\s*mini\b/i,                     category: 'Mac',    family: 'Mac mini' },
  { re: /\bmac\s*studio\b/i,                   category: 'Mac',    family: 'Mac Studio' },
  { re: /\bimacs?\b/i,                         category: 'Mac',    family: 'iMac' },
  { re: /\bmac\b/i,                            category: 'Mac',    family: null },
  { re: /\b(ipad\s*pro|ipad-pro)s?\b/i,        category: 'iPad',   family: 'iPad Pro' },
  { re: /\b(ipad\s*air|ipad-air)s?\b/i,        category: 'iPad',   family: 'iPad Air' },
  { re: /\b(ipad\s*mini|ipad-mini)s?\b/i,      category: 'iPad',   family: 'iPad mini' },
  { re: /\bipads?\b/i,                         category: 'iPad',   family: 'iPad' },
  { re: /\biphone\s*air\b/i,                   category: 'iPhone', family: 'iPhone Air' },
  { re: /\biphone\s*se\s*(\d+)\b/i,            category: 'iPhone', family: null, familyFn: (m) => `iPhone SE ${m[1]}` },
  { re: /\biphone\s*se\b/i,                    category: 'iPhone', family: 'iPhone SE' },
  { re: /\biphone\s*(\d{1,2})e\b/i,            category: 'iPhone', family: null, familyFn: (m) => `iPhone ${m[1]}e` },
  { re: /\biphone\s*(\d{1,2})\b/i,             category: 'iPhone', family: null, familyFn: (m) => `iPhone ${m[1]}` },
  { re: /\biphones?\b/i,                       category: 'iPhone', family: null },
  { re: /\bhomepod\s*mini\b/i,                 category: 'HomePod',family: 'HomePod mini' },
  { re: /\bhomepod\b/i,                        category: 'HomePod',family: 'HomePod' },
  { re: /\b(apple\s*)?vision\s*pro\b/i,        category: 'Vision Pro', family: 'Apple Vision Pro' },
  { re: /\bairpods\s*max\s*(\d+)\b/i,          category: 'AirPods',family: null, familyFn: (m) => `AirPods Max ${m[1]}` },
  { re: /\bairpods\s*max\b/i,                  category: 'AirPods',family: 'AirPods Max' },
  { re: /\bairpods\s*pro\s*(\d+)\b/i,          category: 'AirPods',family: null, familyFn: (m) => `AirPods Pro ${m[1]}` },
  { re: /\bairpods\s*pro\b/i,                  category: 'AirPods',family: null },
  { re: /\bairpods\s*(\d+)\b/i,                category: 'AirPods',family: null, familyFn: (m) => `AirPods ${m[1]}` },
  { re: /\bairpods\b/i,                        category: 'AirPods',family: null },
  { re: /\b(apple\s*)?watch\s*ultra\s*(\d+)\b/i,  category: 'Apple Watch', family: null, familyFn: (m) => `Apple Watch Ultra ${m[2]}` },
  { re: /\b(apple\s*)?watch\s*ultra\b/i,          category: 'Apple Watch', family: 'Apple Watch Ultra' },
  { re: /\b(apple\s*)?watch\s*series\s*(\d+)\b/i, category: 'Apple Watch', family: null, familyFn: (m) => `Apple Watch Series ${m[2]}` },
  { re: /\b(apple\s*)?watch\s*se\s*(\d+)\b/i,     category: 'Apple Watch', family: null, familyFn: (m) => `Apple Watch SE ${m[2]}` },
  { re: /\b(apple\s*)?watch\s*se\b/i,             category: 'Apple Watch', family: 'Apple Watch SE' },
  { re: /\bapple\s*watch|\bwatch\b/i,             category: 'Apple Watch', family: null },

  { re: /\b(vision\s*pro)\b/i,                    category: 'Vision Pro', family: 'Vision Pro' },
  { re: /\bhomepod\s*mini\b/i,                    category: 'HomePod', family: 'HomePod mini' },
  { re: /\bhomepod\b/i,                           category: 'HomePod', family: 'HomePod' },
  { re: /\bapple\s*tv\s*4k\b/i,                   category: 'Apple TV', family: 'Apple TV 4K' },
  { re: /\bapple\s*tv\b/i,                        category: 'Apple TV', family: 'Apple TV' },
  { re: /\bstudio\s*display\b/i,                  category: 'Display', family: 'Studio Display' },
  { re: /\bpro\s*display\s*xdr\b/i,               category: 'Display', family: 'Pro Display XDR' },
  { re: /\bpro\s*display\b/i,                     category: 'Display', family: 'Pro Display XDR' },

  { re: /\bjbl\s+(boombox|charge|flip|xtreme|partybox|clip|go|pulse)\s*(\d+)?\b/i, category: 'Speaker', family: null, familyFn: (m) => `JBL ${m[1][0].toUpperCase()+m[1].slice(1)}${m[2]?' '+m[2]:''}` },
  { re: /\bjbl\s+(tune|live|quantum)\s*(flex|beam|\d+)?\b/i, category: 'Earbuds', family: null, familyFn: (m) => `JBL ${m[1][0].toUpperCase()+m[1].slice(1)}${m[2]?' '+m[2]:''}` },
  { re: /\bjbl\b/i,                               category: 'Speaker', family: 'JBL' },
  { re: /\bbose\s+(quietcomfort\s*earbuds|qc\s*earbuds)\b/i, category: 'Earbuds', family: 'Bose QuietComfort Earbuds' },
  { re: /\bbose\s+(quietcomfort|qc)\s*(\d+)?\b/i, category: 'Headphones', family: null, familyFn: (m) => `Bose QuietComfort${m[2]?' '+m[2]:''}` },
  { re: /\bbose\s+(soundlink|soundbar|home)\s*(\w+)?\b/i, category: 'Speaker', family: null, familyFn: (m) => `Bose ${m[1][0].toUpperCase()+m[1].slice(1)}${m[2]?' '+m[2]:''}` },
  { re: /\bbose\b/i,                              category: 'Headphones', family: 'Bose' },
  { re: /\bharman\s*kardon\b/i,                   category: 'Speaker', family: 'Harman Kardon' },
  { re: /\bsony\s+(wh|wf)-?([a-z0-9]+)/i,         category: 'Headphones', family: null, familyFn: (m) => `Sony ${m[1].toUpperCase()}-${m[2].toUpperCase()}` },
  { re: /\bsony\s+playstation\b/i,                category: 'Accessory', family: 'Sony PlayStation' },
  { re: /\bsony\b/i,                              category: 'Headphones', family: 'Sony' },
  { re: /\bshokz\b/i,                             category: 'Headphones', family: 'Shokz' },

  { re: /\bbeats\s+studio\s*buds\s*(\d+|\+|plus|pro)?\b/i, category: 'Earbuds',   family: null, familyFn: (m) => `Beats Studio Buds${m[1]?' '+m[1]:''}` },
  { re: /\bbeats\s+solo\s*(\d+|buds|pro)?\b/i,    category: 'Headphones', family: null, familyFn: (m) => `Beats Solo${m[1]?' '+m[1]:''}` },
  { re: /\bbeats\s+studio\s*(\d+|pro)?\b/i,       category: 'Headphones', family: null, familyFn: (m) => `Beats Studio${m[1]?' '+m[1]:''}` },
  { re: /\b(power\s*beats|beats\s+powerbeats)\s*(\d+|pro)?\b/i, category: 'Earbuds', family: null, familyFn: (m) => `Powerbeats${m[2]?' '+m[2]:''}` },
  { re: /\bbeats\s+fit\s*pro\b/i,                 category: 'Earbuds',   family: 'Beats Fit Pro' },
  { re: /\bbeats\s+flex\b/i,                      category: 'Earbuds',   family: 'Beats Flex' },
  { re: /\bbeats\s+pill\b/i,                      category: 'Speaker',   family: 'Beats Pill' },
  { re: /\bbeats\b/i,                             category: 'Headphones', family: null },

  { re: /\bdyson\s+(airwrap|supersonic|corrale|airstrait|v\d+|v1\d)\b/i, category: 'Dyson', family: null, familyFn: (m) => `Dyson ${m[1][0].toUpperCase()+m[1].slice(1)}` },
  { re: /\bdyson\b/i,                             category: 'Dyson', family: null },

  { re: /\b(air\s*fryer|ninja|cosori|instant\s*pot)\b/i, category: 'Home Appliance', family: null },
  { re: /\b(projector|formovie)\b/i,              category: 'Projector', family: null },
  { re: /\b(gift\s*card|giftcard)\b/i,            category: 'Gift Card', family: null },

  { re: /\b(speaker|boombox|soundbar|boom\s*box)\b/i, category: 'Speaker', family: null },
  { re: /\b(earbuds?|in[-\s]?ear|true\s*wireless|tws)\b/i, category: 'Earbuds', family: null },
  { re: /\b(headphones?|over[-\s]?ear|on[-\s]?ear)\b/i, category: 'Headphones', family: null },
  { re: /\bearpods\b/i,                           category: 'Accessory', family: 'EarPods' },
];

function extractCategoryFamily(text) {
  for (const entry of CATEGORY_MAP) {
    const m = entry.re.exec(text);
    if (m) {
      const family = entry.familyFn ? entry.familyFn(m) : entry.family;
      return { category: entry.category, family };
    }
  }
  return { category: null, family: null };
}

function extractIphoneModel(text) {
  if (/\biphone\s*air\b/i.test(text)) return { model: 'Air', variant: 'Air' };
  let m = text.match(/\biphone\s*(\d{1,2})\s*(e|se|pro\s*max|pro|plus|mini)?\b/i);
  if (m) {
    const num = m[1];
    const suffix = (m[2] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const model = suffix ? `${num} ${suffix.replace(/\s+/g, ' ')}`.trim() : num;
    let variant = null;
    if (suffix === 'pro max') variant = 'Pro Max';
    else if (suffix === 'pro') variant = 'Pro';
    else if (suffix === 'plus') variant = 'Plus';
    else if (suffix === 'mini') variant = 'mini';
    else if (suffix === 'e') variant = 'e';
    else if (suffix === 'se') variant = 'SE';
    else variant = 'Standard';
    return { model: model.replace(/\bpro max\b/, 'Pro Max').replace(/\bpro\b/, 'Pro'), variant };
  }
  m = text.match(/\b(pro\s*max|pro|plus|mini)\b/i);
  if (m) {
    const s = m[1].toLowerCase();
    if (s === 'pro max') return { model: null, variant: 'Pro Max' };
    if (s === 'pro')     return { model: null, variant: 'Pro' };
    if (s === 'plus')    return { model: null, variant: 'Plus' };
    if (s === 'mini')    return { model: null, variant: 'mini' };
  }
  return { model: null, variant: null };
}

function extractMacChip(text) {
  const m = text.match(/\bm([1-9])\s*(pro|max|ultra)?\b/i);
  if (!m) return null;
  const base = `M${m[1]}`;
  const suffix = m[2] ? ' ' + m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : '';
  return `${base}${suffix}`;
}

const VALID_STORAGE_GB = new Set([64, 128, 256, 512, 1024, 2048, 4096, 8192]);
const VALID_RAM_GB = new Set([8, 16, 24, 32, 36, 48, 64, 96, 128]);

function extractStorageGb(text) {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(gb|tb)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const gb = unit === 'tb' ? Math.round(n * 1024) : Math.round(n);
  const hasRamMarker = /\b(ram|memory|unified\s*memory)\b/i.test(text);
  if (hasRamMarker && VALID_RAM_GB.has(gb) && !VALID_STORAGE_GB.has(gb)) return null;
  if (VALID_RAM_GB.has(gb) && !VALID_STORAGE_GB.has(gb) && /\b(macbook|mac|ipad\s*pro|ram)\b/i.test(text)) return null;
  return gb;
}

function extractRamGb(text) {
  const explicit = text.match(/\b(\d+)\s*gb\s*(ram|memory|unified\s*memory)\b/i);
  if (explicit) return parseInt(explicit[1], 10);
  const ramBefore = text.match(/\b(ram|memory|unified\s*memory)\s*:?\s*(\d+)\s*gb\b/i);
  if (ramBefore) return parseInt(ramBefore[2], 10);
  const numMatch = text.match(/\b(\d+)\s*gb\b/i);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (VALID_RAM_GB.has(n) && !VALID_STORAGE_GB.has(n)) return n;
  }
  return null;
}

function extractScreenInch(text) {
  const m = text.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:["'""]|-?\s*inch(?:es)?|-?\s*in\b)/i);
  if (!m) return null;
  return parseFloat(m[1]);
}

const KNOWN_COLORS = [
  'space black','space gray','space grey','natural titanium','desert titanium',
  'black titanium','deep blue titanium','deep blue','sky blue','cloud white',
  'light gold','cosmic orange','mist blue','rose gold','jet black',
  'silver','gold','black','white','blue','red','green','purple','pink',
  'yellow','midnight','starlight','orange','sage','lavender','titanium',
].sort((a, b) => b.length - a.length);

const COLOR_ALIASES = {
  'blk': 'Black', 'wht': 'White', 'wh': 'White', 'blu': 'Blue', 'grn': 'Green',
  'slv': 'Silver', 'gld': 'Gold', 'pur': 'Purple', 'pnk': 'Pink',
  'grey': 'Gray', 'titan': 'Titanium',
};

function extractColor(text) {
  for (const c of KNOWN_COLORS) {
    const safe = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${safe}\\b`, 'i').test(text)) return c.replace(/\b\w/g, (m) => m.toUpperCase());
  }
  for (const [alias, canonical] of Object.entries(COLOR_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(text)) return canonical;
  }
  return null;
}

function extractRegion(text) {
  if (/\b(middle\s*east|me\s*version|uae\s*version)\b/i.test(text)) return 'Middle East';
  if (/\b(international|int\s*version|with\s*face\s*time|face\s*time|europe(an)?|eu\s*version|uk\s*version|usa\s*version|us\s*version)\b/i.test(text)) return 'International';
  return null;
}

function extractSim(text) {
  if (/\bdual\s*esim\b/i.test(text))          return 'Dual eSIM';
  if (/\bnano\s*sim\s*\+?\s*esim\b/i.test(text)) return 'Nano SIM + eSIM';
  if (/\besim\s*only\b/i.test(text))          return 'eSIM Only';
  return null;
}

function extractKeyboard(text) {
  if (/\barabic\s*keyboard\b/i.test(text) || /\b(english\s*\/\s*arabic|english\s*and\s*arabic)\s*keyboard\b/i.test(text)) {
    return 'English/Arabic';
  }
  if (/\benglish\s*keyboard\b/i.test(text)) return 'English';
  return null;
}

function extractBudget(text) {
  const m = text.match(/\b(aed|د\.إ|درهم|\$|usd)\s*(\d{3,6})\b/i)
         || text.match(/\b(\d{3,6})\s*(aed|د\.إ|درهم|usd|\$)\b/i)
         || text.match(/\bbudget\s*(?:is|of|about|around)?\s*(\d{3,6})\b/i)
         || text.match(/\bunder\s*(\d{3,6})\b/i);
  if (!m) return null;
  const amount = parseInt(m[2] || m[1], 10);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: 'AED' };
}

const FEATURE_WORDS = [
  ['camera',      ['camera','photography','photo','zoom','telephoto']],
  ['battery',     ['battery','long battery','all day']],
  ['gaming',      ['gaming','gamer','game','games']],
  ['student',     ['student','school','college','university']],
  ['video',       ['video','editing','4k','pro res','prores']],
  ['portability', ['light','lightweight','thin','slim','portable','travel']],
  ['performance', ['powerful','fast','heavy lifting','performance']],
  ['budget',      ['budget','cheap','cheapest','affordable','lowest price']],
];

function extractFeatures(text) {
  const out = [];
  for (const [name, words] of FEATURE_WORDS) {
    if (words.some((w) => new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))) {
      out.push(name);
    }
  }
  return out;
}

function extractSizePreference(text) {
  if (/\b(smallest|smaller|small|compact|mini\b)/i.test(text))   return 'small';
  if (/\b(biggest|bigger|big|largest|large)\b/i.test(text))      return 'large';
  return null;
}

function extractUsage(text) {
  if (/\bvideo\s*editing\b/i.test(text))        return 'video_editing';
  if (/\bphoto(graphy)?\b/i.test(text))         return 'photography';
  if (/\bgaming|game(s)?\b/i.test(text))         return 'gaming';
  if (/\bstudent|school|college|university\b/i.test(text)) return 'school';
  if (/\btravel|portable\b/i.test(text))         return 'travel';
  if (/\bwork|office|business\b/i.test(text))    return 'office';
  return null;
}

export function extractEntities(normalizedText) {
  const text = normalizedText || '';
  const { category, family } = extractCategoryFamily(text);
  const entities = {
    category,
    family,
    model: null,
    variant: null,
    chip: null,
    storage_gb: null,
    ram_gb: null,
    screen_inch: null,
    color: extractColor(text),
    region: extractRegion(text),
    sim: extractSim(text),
    keyboard_layout: extractKeyboard(text),
    budget: extractBudget(text),
    size_preference: extractSizePreference(text),
    usage: extractUsage(text),
    features: extractFeatures(text),
  };

  if (category === 'iPhone') {
    const { model, variant } = extractIphoneModel(text);
    if (model) entities.model = model;
    if (variant) entities.variant = variant;
  }
  const chip = extractMacChip(text);
  if (chip) {
    entities.chip = chip;
    if (category === 'Mac') entities.model = chip;
  }

  const storage = extractStorageGb(text);
  if (storage !== null) entities.storage_gb = storage;
  const ram = extractRamGb(text);
  if (ram !== null) entities.ram_gb = ram;
  const screen = extractScreenInch(text);
  if (screen !== null) entities.screen_inch = screen;

  for (const k of Object.keys(entities)) {
    if (entities[k] === null || entities[k] === undefined) delete entities[k];
    if (Array.isArray(entities[k]) && entities[k].length === 0) delete entities[k];
  }
  return entities;
}
