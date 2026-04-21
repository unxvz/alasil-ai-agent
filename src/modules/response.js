import { INTENTS } from './intent.js';
import { nextClarification, isProfileComplete } from './clarification.js';
import { retrieveProducts, retrieveForComparison, retrieveWithRelaxation } from './retrieval.js';
import { phraseAnswer } from './llm.js';
import { getCatalog, matchesFilter } from './catalog.js';
import { resolveOptionPick } from './option-match.js';
import { logger } from '../logger.js';

const SKU_STANDALONE = /^[A-Z0-9]{4,8}(?:LL\/A|ZP\/A|AE\/A|AB\/A|B\/A)?$/i;
const SKU_EMBEDDED = /\b([A-Z][A-Z0-9]{3,6})\b/gi;
const SKU_BLOCKLIST = /^(USB|USBC|USBCC|MAC|IPAD|IMAC|GPS|SSD|HDD|RAM|WIFI|LTE|NFC|MAGSAFE|MAGS|OLED|LCD|AMOLED|MINI|PRO|MAX|PLUS|ULTRA|AIR|SILVER|GOLD|BLACK|WHITE|BLUE|GREEN|PURPLE|PINK|RED|YELLOW|ORANGE|PROMAX|TB|MB|KB|MM|CM|INCH|FACETIME|ESIM|SIM|AED|UAE|LL|ZP|AB|APPLE|ALASIL|ONLY)$/i;

async function skuLookup(userMessage) {
  const raw = String(userMessage || '').trim();
  if (!raw) return null;

  const candidates = new Set();
  if (SKU_STANDALONE.test(raw) && raw.length <= 12 && /[0-9]/.test(raw) && /[a-z]/i.test(raw) && !SKU_BLOCKLIST.test(raw)) {
    candidates.add(raw.toLowerCase());
  }
  let m;
  const re = new RegExp(SKU_EMBEDDED.source, 'gi');
  while ((m = re.exec(raw)) !== null) {
    const t = m[1];
    if (!/[0-9]/.test(t)) continue;
    if (!/[a-z]/i.test(t)) continue;
    if (SKU_BLOCKLIST.test(t)) continue;
    candidates.add(t.toLowerCase());
  }
  if (candidates.size === 0) return null;

  const catalog = await getCatalog();
  const hit = new Map();
  for (const needle of candidates) {
    for (const p of catalog) {
      const sku = String(p.sku || '').toLowerCase();
      if (sku === needle && p.in_stock !== false) {
        hit.set(p.id, { p, score: 10 });
      }
    }
  }
  if (hit.size === 0) return null;
  const sorted = Array.from(hit.values()).sort((a, b) => b.score - a.score).map((x) => x.p);
  return sorted.slice(0, 4);
}

const ASSIST_PREFIX = /^(hi+|hello+|hey|yo|salam)[^a-z]*(i['']?m|i'?d\s+like|i\s+need|i\s+want|i\s+would|i'?d)\s+(some\s+)?(assistance|help|support|information|info)\s+(with|about|on|regarding)\s+/i;
const ALASIL_SUFFIX = /\s*[|\-–—]\s*(apple\s*[|\-–—]\s*)?alasil\s*$/i;

const ACCESSORY_KW_MAP = [
  ['case',             /\b(case|folio\s*case)\b/i,           /\bcase\b/i],
  ['cover',            /\b(cover|folio)\b/i,                 /\b(cover|folio)\b/i],
  ['screen_protector', /\b(screen\s*protector|tempered\s*glass)\b/i, /\b(screen\s*protector|tempered\s*glass)\b/i],
  ['charger',          /\b(charger|magsafe\s*charger|power\s*adapter)\b/i, /\b(charger|magsafe\s*charger|power\s*adapter|watt\s*adapter)\b/i],
  ['cable',            /\b(cable|cord|lead)\b/i,              /\bcable\b/i],
  ['pencil',           /\b(pencil)\b/i,                      /\bpencil\b/i],
  ['keyboard',         /\b(keyboard|magic\s*keyboard)\b/i,    /\b(magic\s*keyboard|smart\s*keyboard|keyboard\s*folio)\b/i],
  ['mouse',            /\b(mouse)\b/i,                       /\bmagic\s*mouse\b/i],
  ['band',             /\b(band|strap|loop)\b/i,             /\b(band|loop|strap)\b/i],
  ['stand',            /\b(stand|dock)\b/i,                  /\b(stand|dock)\b/i],
  ['airtag',           /\b(airtag|tracker)\b/i,              /\bairtag\b/i],
];

const ACCESSORY_PRODUCT_NAMES = /\b(apple\s*pencil(\s*(pro|1|one|2|usb-?c))?|magic\s*(mouse|keyboard|trackpad)|airtag|magsafe\s*charger|smart\s*folio|smart\s*cover|usb-?c\s*cable|lightning\s*cable|power\s*adapter|apple\s*watch\s*band|apple\s*pencil\s*tips)\b/i;

const COMPAT_QUESTION_RE = /\b(does|do|is|are|can|will|work(s|ing)?\s*with|compat(ible|ibility)|fit(s)?|support(s|ed)?\s*(with|by|for)|difference|vs|versus)\b/i;

async function accessoryLookup(userMessage, profile, lastProducts) {
  const msg = String(userMessage || '');
  if (COMPAT_QUESTION_RE.test(msg)) return null;
  let matched = null;
  for (const [key, askRe, titleRe] of ACCESSORY_KW_MAP) {
    if (askRe.test(msg)) { matched = { key, titleRe }; break; }
  }
  const productNameMatch = msg.match(ACCESSORY_PRODUCT_NAMES);
  if (!matched && !productNameMatch) return null;

  const catalog = await getCatalog();
  const deviceFamily = profile?.family || (lastProducts?.[0]?.family) || null;
  const deviceCategory = profile?.category || (lastProducts?.[0]?.category) || null;
  const deviceTerms = [];
  if (deviceFamily) deviceTerms.push(deviceFamily);
  if (deviceCategory && deviceCategory !== deviceFamily) deviceTerms.push(deviceCategory);
  const devRes = deviceTerms.map((t) => new RegExp(t.replace(/\s+/g, '\\s*'), 'i'));

  if (productNameMatch) {
    const nameTokens = productNameMatch[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    const scored = [];
    for (const p of catalog) {
      if (!p.in_stock) continue;
      if (p.category !== 'Accessory') continue;
      const title = String(p.title || '').toLowerCase();
      let score = 0;
      for (const t of nameTokens) {
        if (title.includes(t)) score += 2;
      }
      if (score >= Math.max(4, nameTokens.length)) scored.push({ p, score });
    }
    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score || (a.p.price_aed || 0) - (b.p.price_aed || 0));
      return scored.slice(0, 4).map((x) => x.p);
    }
  }

  if (!matched) return null;

  const hits = catalog.filter((p) => {
    if (!p.in_stock) return false;
    if (p.category !== 'Accessory') return false;
    const title = String(p.title || '');
    if (!matched.titleRe.test(title)) return false;
    if (devRes.length === 0) return true;
    return devRes.some((re) => re.test(title));
  });

  if (hits.length === 0) return null;
  hits.sort((a, b) => (a.price_aed || 0) - (b.price_aed || 0));
  return hits.slice(0, 4);
}

function extractPdpPhrase(raw) {
  let s = String(raw || '').trim();
  const pre = s.match(ASSIST_PREFIX);
  if (pre) s = s.slice(pre[0].length);
  s = s.replace(ALASIL_SUFFIX, '');
  s = s.replace(/\s*[|\-–—]\s*apple\s*$/i, '');
  return s.trim();
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) === false || t.length >= 2);
}

const STOPWORDS = new Set([
  'a','an','the','of','for','with','and','or','in','on','at','to','from','by','as','is','are','my','your','our','their','this','that','these','those','it','its','all','any','some','more','i','we','you','he','she','they','me','us','them',
  'hi','hello','hey','assistance','help','support','info','information','details','regarding','about','like','need','want','would','looking','please','thanks','thank','apple','alasil','authentic','original','genuine',
  'kids','kid','child','children','mom','dad','wife','husband','brother','sister','friend','colleague','sale','offer','new','today','tomorrow',
]);

async function titleLookup(userMessage) {
  const raw = String(userMessage || '');
  const hasPdpPrefix = ASSIST_PREFIX.test(raw) || ALASIL_SUFFIX.test(raw);
  if (!hasPdpPrefix) return null;

  const phrase = extractPdpPhrase(userMessage);
  if (!phrase || phrase.length < 5) return null;
  const rawTokens = phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const tokens = rawTokens.filter((t) => !STOPWORDS.has(t));
  if (tokens.length < 2) return null;
  const hasAppleKw = tokens.some((t) => /^(iphone|ipad|macbook|imac|airpods|airtag|pencil|magsafe|homepod|watch|vision|studio|mini|pro|max|air|cable|charger|adapter|keyboard|mouse|magsafe)$/i.test(t));
  if (!hasAppleKw) return null;

  const catalog = await getCatalog();
  const scored = [];
  for (const p of catalog) {
    const title = String(p.title || '').toLowerCase();
    const handle = String(p.handle || '').toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 2;
      else if (handle.includes(t)) score += 1;
    }
    const threshold = Math.max(6, Math.ceil(tokens.length * 1.5));
    if (score >= threshold) scored.push({ p, score });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || a.p.price_aed - b.p.price_aed);
  const best = scored[0];
  const equals = scored.filter((s) => s.score === best.score);
  return equals.slice(0, 4).map((x) => x.p);
}

function staticReply(language, key) {
  const en = {
    no_results:    "I couldn't find a matching product in stock right now. Could you adjust one option (storage, color, or region)?",
    empty_message: 'Could you tell me what you are looking for? (iPhone, iPad, or Mac)',
    support:       "I'll connect you with our team — please share your order number so we can follow up.",
    faq_fallback:  'Our store delivers across the UAE, accepts card / Apple Pay / Tabby / Tamara, and Cash on Delivery for orders under AED 1,500. Which of these would you like more detail on?',
  };
  const fa = {
    no_results:    'همین الان محصولی مطابق این مشخصات در انبار ندارم. اگر یکی از گزینه‌ها (حافظه، رنگ یا نسخه) را تغییر دهید کمک می‌کنم.',
    empty_message: 'چه محصولی دنبالش هستید؟ (آیفون، آیپد، یا مک)',
    support:       'برای پیگیری دقیق‌تر، لطفاً شماره سفارشتان را بفرستید تا تیم ما با شما تماس بگیرد.',
    faq_fallback:  'ارسال در سراسر امارات داریم، کارت / Apple Pay / Tabby / Tamara، و COD برای سفارش‌های زیر ۱۵۰۰ درهم. روی کدوم توضیح بیشتر بدم؟',
  };
  const pack = language === 'fa' ? fa : en;
  return pack[key] || pack.empty_message;
}

function productInquiryPath({ profile, intent, language, userMessage, history, lastProducts }) {
  return async () => {
    if (!profile.category) {
      const clarify = await nextClarification(profile, intent, language);
      if (clarify) {
        return { type: 'question', text: clarify.text, field: clarify.field, options: clarify.options };
      }
    }

    const catalog = await getCatalog();
    const matchCount = catalog.filter((p) => matchesFilter(p, profile)).length;

    if (matchCount > 4) {
      const clarify = await nextClarification(profile, intent, language);
      if (clarify) {
        return { type: 'question', text: clarify.text, field: clarify.field, options: clarify.options };
      }
    }

    const { products, relaxed } = await retrieveWithRelaxation(profile, { limit: 3 });
    if (products && products.length > 0) {
      const text = await phraseAnswer({
        userMessage, profile, products, intent, language, relaxed, history, lastProducts,
      });
      return { type: 'answer', text, products };
    }

    const clarify = await nextClarification(profile, intent, language);
    if (clarify) {
      return { type: 'question', text: clarify.text, field: clarify.field, options: clarify.options };
    }
    return { type: 'answer', text: staticReply(language, 'no_results'), products: [] };
  };
}

function comparisonPath({ profile, intent, language, userMessage, history, lastProducts }) {
  return async () => {
    const products = await retrieveForComparison(profile, { limit: 4 });
    if (!products || products.length === 0) {
      const clarify = await nextClarification(profile, intent, language);
      if (clarify) {
        return { type: 'question', text: clarify.text, field: clarify.field, options: clarify.options };
      }
      return { type: 'answer', text: staticReply(language, 'no_results'), products: [] };
    }
    const text = await phraseAnswer({ userMessage, profile, products, intent, language, history, lastProducts });
    return { type: 'answer', text, products };
  };
}

function generalQuestionPath({ profile, intent, language, userMessage, history, lastProducts }) {
  return async () => {
    const text = await phraseAnswer({
      userMessage, profile, products: [], intent, language, history, lastProducts,
    }).catch(() => staticReply(language, 'faq_fallback'));
    return { type: 'answer', text, products: [] };
  };
}

function supportPath({ language }) {
  return async () => ({ type: 'answer', text: staticReply(language, 'support'), products: [] });
}

const GREETING_PATTERN = /^(hi|hello|hey|hola|yo|heya|good\s*(morning|afternoon|evening|day)|salam|salaam|سلام|hii+|helo+)[\s.!?]*$/i;
const THANKS_PATTERN = /^(thanks|thank\s*you|thx|ty|mersi|merci|merc|مرسی|شكرا|shokran|tnx|cheers)[\s.!?]*$/i;

function greetingReply(language) {
  if (language === 'fa') {
    return 'سلام 👋 خیلی خوشحالم که پیام دادید! من ای‌آی ایجنت alAsil هستم — اینجام تا برای انتخاب بهترین محصول Apple کمکتون کنم. امروز دنبال چی می‌گردید؟ (iPhone / iPad / Mac / AirPods / Apple Watch)';
  }
  return "Hey! 👋 Great to hear from you — I'm the alAsil AI agent, here to help you find the perfect Apple product. What are you looking for today? (iPhone / iPad / Mac / AirPods / Apple Watch)";
}

function thanksReply(language) {
  if (language === 'fa') return 'قابلی نداشت! چیز دیگه‌ای لازم داری؟';
  return "You're welcome! Anything else I can help with?";
}

const PRONOUN_PATTERN = /\b(it|this|that|this\s+one|that\s+one|this\s+product|that\s+product|the\s+same|they|them|these|those)\b/i;

const FOLLOWUP_KEYWORDS = /\b(price|cost|how\s*much|discount|cheaper|colors?|sizes?|storage|capacity|chip|ram|battery|specs?|box|in\s*the\s*box|pencil|keyboard|case|cover|charger|cable|adapter|accessor(y|ies)|warranty|return|refund|exchange|compat(ible|ibility)|work(s|ing)?|fit(s)?|support(s|ed)?|stock|available|today|tomorrow|arrive|delivery|ship|tabby|tamara|cod|cash|installment|face\s*time|esim|sim|arabic|english|keyboard\s*layout|region|me\s*version|international|face\s*to\s*face|inspect|trade[-\s]?in|try|dubai|abu\s*dhabi|m[1-9](?:\s*(?:pro|max|ultra))?|a1[0-9](?:\s*pro)?|link|url|buy|purchase|order|checkout|proceed|take\s*it|send\s*(me\s*)?(the\s*)?link)\b/i;

const BUY_INTENT_RE = /\b(send\s*(me\s*)?(the\s*)?(link|url)|i\s*(want\s*to\s*)?buy|purchase(\s*it)?|place\s*(an\s*)?order|order\s*(it|now|please)|add\s*to\s*cart|checkout|proceed\s*(with|to)|take\s*it|i['']?ll\s*take|i\s*want\s*it|confirm\s*(order|purchase|it)|buy\s*now)\b/i;
const HIGHER_SPEC_RE = /\b(higher|more|bigger|max(imum)?|largest|greater|better|other|any\s*other|different|another)\s*(ram|memory|unified\s*memory|storage|ssd|capacity|disk|screen|display|size|chip|cpu|gpu|battery|version|option)\b/i;
const LOWER_SPEC_RE = /\b(lower|less|smaller|min(imum)?|cheapest|least|minimum)\s*(ram|memory|storage|ssd|capacity|disk|screen|display|size|chip|price)\b/i;
const SPEC_FIELD_MAP = { ram: 'ram_gb', memory: 'ram_gb', 'unified memory': 'ram_gb', storage: 'storage_gb', ssd: 'storage_gb', capacity: 'storage_gb', disk: 'storage_gb', screen: 'screen_inch', display: 'screen_inch', size: 'screen_inch', chip: 'chip' };
const ORDER_SUPPORT_RE = /\b(where\s*is\s*my\s*order|order\s*status|track(ing)?\s*(number|my\s*order|order)|my\s*order\s*(where|status|hasn'?t)|already\s*(bought|purchased|ordered))\b/i;
const YES_RE = /^\s*(y|yes|yep|yeah|sure|ok|okay|confirm|proceed|go\s*ahead|do\s*it|bale|ok\s*send|okay\s*send)[\s.!]*$/i;

function isShortQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const wc = t.split(/\s+/).length;
  return wc <= 7 && (/\?/.test(t) || /^(do|does|is|are|can|will|would|should|what|how|why|which|when|where|any|got|have)\b/i.test(t));
}

function isFollowUp(text, hasLastProduct) {
  if (!hasLastProduct) return false;
  if (PRONOUN_PATTERN.test(text)) return true;
  if (isShortQuestion(text) && FOLLOWUP_KEYWORDS.test(text)) return true;
  return false;
}

function matchLastProductPick(userMessage, lastProducts) {
  if (!Array.isArray(lastProducts) || lastProducts.length < 2) return null;
  const titles = lastProducts.map((p) => String(p.title || ''));
  const picked = resolveOptionPick(userMessage, titles);
  if (!picked) return null;
  const idx = titles.indexOf(picked);
  return idx >= 0 ? lastProducts[idx] : null;
}

export async function buildResponse({ intent, profile, language, userMessage, history, lastProducts }) {
  if (!userMessage || !String(userMessage).trim()) {
    return { type: 'question', text: staticReply(language, 'empty_message'), field: 'category' };
  }

  const trimmed = String(userMessage).trim();
  if (GREETING_PATTERN.test(trimmed)) {
    return { type: 'answer', text: greetingReply(language), products: [] };
  }
  if (THANKS_PATTERN.test(trimmed)) {
    return { type: 'answer', text: thanksReply(language), products: [] };
  }

  const NON_CARRIED_BRANDS = /\b(samsung|galaxy|xiaomi|mi\s*pad|redmi|oppo|vivo|realme|oneplus|huawei|honor|nothing\s*phone|google\s*pixel|pixel\s*\d|asus|acer|lenovo|thinkpad|dell|xps|hp\s*(laptop|omen|pavilion|elitebook|envy)|omen|pavilion|elitebook|msi|razer|sony\s*xperia|nokia|nubia|tecno|infinix|itel|alcatel|blackberry|zte|sennheiser|jabra|anker|soundcore)\b/i;
  if (NON_CARRIED_BRANDS.test(trimmed)) {
    const msg = language === 'fa'
      ? 'این برند رو نداریم. ما Apple, Beats, Bose, JBL, Sony, Harman Kardon, Dyson و لوازم خانگی منتخب داریم — اگر مشابهش خواستید کمک می‌کنم.'
      : "We don't carry that brand. We stock Apple, Beats, Bose, JBL, Sony, Harman Kardon, Dyson, and select home appliances — happy to suggest a close alternative.";
    return { type: 'answer', text: msg, products: [] };
  }

  const lastProductsArr = Array.isArray(lastProducts) ? lastProducts : [];
  const historyArr = Array.isArray(history) ? history : [];
  const hasContext = lastProductsArr.length > 0;
  const followUp = isFollowUp(trimmed, hasContext);

  if (ORDER_SUPPORT_RE.test(trimmed)) {
    const supportText = language === 'fa'
      ? 'لطفاً شماره سفارشتون رو بفرستید تا تیم ما وضعیت رو چک کنه. همچنین لینک tracking با ایمیل و واتساپ بعد از ارسال می‌رسه — Spam رو هم چک کنید.'
      : 'Please share your order number so our team can check the status. A tracking link is also sent by email and WhatsApp once your order is dispatched — check your spam folder if you don\'t see it.';
    return { type: 'answer', text: supportText, products: [] };
  }

  const buyIntent = BUY_INTENT_RE.test(trimmed) || YES_RE.test(trimmed);

  const pickFromLast = matchLastProductPick(trimmed, lastProductsArr);
  if (pickFromLast) {
    const text = await phraseAnswer({
      userMessage,
      profile,
      products: [pickFromLast],
      intent: buyIntent ? 'buy_confirm' : 'product_confirm',
      language,
      history: historyArr,
      lastProducts: [],
    }).catch(() => staticReply(language, 'faq_fallback'));
    return { type: 'answer', text, products: [pickFromLast] };
  }

  const higherMatch = trimmed.match(HIGHER_SPEC_RE);
  const lowerMatch = trimmed.match(LOWER_SPEC_RE);
  const specExplore = higherMatch || lowerMatch;
  let specField = null;
  if (specExplore) {
    const specWord = (specExplore[specExplore.length - 1] || '').toLowerCase();
    specField = SPEC_FIELD_MAP[specWord] || null;
  }

  if (followUp || (buyIntent && hasContext) || (specExplore && hasContext)) {
    const narrowFilter = {};
    const skipFields = new Set();
    if (specField) {
      skipFields.add(specField);
      if (specField === 'ram_gb') skipFields.add('storage_gb');
      if (specField === 'storage_gb') skipFields.add('ram_gb');
    }
    for (const k of ['chip', 'storage_gb', 'ram_gb', 'screen_inch', 'color', 'variant', 'family']) {
      if (skipFields.has(k)) continue;
      if (profile && profile[k] !== undefined && profile[k] !== null && profile[k] !== '') {
        narrowFilter[k] = profile[k];
      }
    }
    const hasNarrow = Object.keys(narrowFilter).length > 0;
    let narrowed = lastProductsArr;
    if (specExplore) {
      const { retrieveProducts } = await import('./retrieval.js');
      const fresh = await retrieveProducts(narrowFilter, { limit: 10 });
      narrowed = fresh.length > 0 ? fresh : lastProductsArr;
    } else if (hasNarrow) {
      narrowed = lastProductsArr.filter((p) => matchesFilter(p, narrowFilter));
      if (narrowed.length === 0) narrowed = lastProductsArr;
    }

    const lastAssistantMsg = [...historyArr].reverse().find((h) => h.role === 'assistant')?.text || '';
    if (buyIntent && !specExplore && narrowed.length > 1 && lastAssistantMsg) {
      const pickByTitle = narrowed.find((p) => {
        const title = String(p.title || '').toLowerCase();
        const kw = title.replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((t) => t.length >= 3);
        const lam = lastAssistantMsg.toLowerCase();
        const hits = kw.filter((w) => lam.includes(w)).length;
        return hits >= Math.max(3, Math.floor(kw.length * 0.4));
      });
      if (pickByTitle) narrowed = [pickByTitle];
    }

    const productsForLLM = narrowed.slice(0, 4);
    const isNarrowedPick = narrowed.length === 1;
    const isBuyConfirm = buyIntent && narrowed.length === 1;
    const text = await phraseAnswer({
      userMessage,
      profile,
      products: productsForLLM,
      intent: isBuyConfirm ? 'buy_confirm' : (isNarrowedPick ? 'product_confirm' : intent),
      language,
      history: historyArr,
      lastProducts: isNarrowedPick ? [] : lastProductsArr,
    }).catch(() => staticReply(language, 'faq_fallback'));
    return { type: 'answer', text, products: narrowed.length === 1 ? narrowed : [] };
  }

  const accessoryMatches = await accessoryLookup(userMessage, profile, lastProductsArr);
  if (accessoryMatches && accessoryMatches.length > 0) {
    const text = await phraseAnswer({
      userMessage, profile, products: accessoryMatches, intent, language, history: historyArr, lastProducts: lastProductsArr,
    }).catch(() => null);
    if (text) return { type: 'answer', text, products: accessoryMatches };
  }

  const skuMatches = await skuLookup(userMessage);
  if (skuMatches && skuMatches.length > 0) {
    const text = await phraseAnswer({
      userMessage, profile, products: skuMatches, intent, language, history: historyArr, lastProducts: lastProductsArr,
    }).catch(() => null);
    if (text) return { type: 'answer', text, products: skuMatches };
  }

  const titleMatches = await titleLookup(userMessage);
  if (titleMatches && titleMatches.length > 0) {
    const text = await phraseAnswer({
      userMessage, profile, products: titleMatches, intent, language, history: historyArr, lastProducts: lastProductsArr,
    }).catch(() => null);
    if (text) return { type: 'answer', text, products: titleMatches };
  }

  let runner;
  switch (intent) {
    case INTENTS.PRODUCT_INQUIRY:
      runner = productInquiryPath({ profile, intent, language, userMessage, history: historyArr, lastProducts: lastProductsArr });
      break;
    case INTENTS.COMPARISON:
      runner = comparisonPath({ profile, intent, language, userMessage, history: historyArr, lastProducts: lastProductsArr });
      break;
    case INTENTS.GENERAL_QUESTION:
      runner = generalQuestionPath({ profile, intent, language, userMessage, history: historyArr, lastProducts: lastProductsArr });
      break;
    case INTENTS.SUPPORT:
      runner = supportPath({ language });
      break;
    default:
      runner = productInquiryPath({ profile, intent, language, userMessage, history: historyArr, lastProducts: lastProductsArr });
  }
  return await runner();
}
