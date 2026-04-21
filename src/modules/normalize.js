const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function foldDigits(s) {
  let out = '';
  for (const ch of s) {
    const fa = FA_DIGITS.indexOf(ch);
    if (fa !== -1) { out += String(fa); continue; }
    const ar = AR_DIGITS.indexOf(ch);
    if (ar !== -1) { out += String(ar); continue; }
    out += ch;
  }
  return out;
}

const DIRECT_FIXES = {
  iphoen: 'iphone', ihpone: 'iphone', ifone: 'iphone', 'i fone': 'iphone', iphne: 'iphone', iphon: 'iphone',
  appel: 'apple', aple: 'apple', apel: 'apple', apply: 'apple',
  macbok: 'macbook', macbbok: 'macbook', maccbook: 'macbook', 'mac book': 'macbook', 'mac-book': 'macbook', mackbook: 'macbook', mcabook: 'macbook',
  macmini: 'mac mini', 'mac-mini': 'mac mini', macstudio: 'mac studio',
  ipd: 'ipad', 'i pad': 'ipad', ippad: 'ipad',
  airpod: 'airpods', 'air pods': 'airpods', 'air-pods': 'airpods',
  promax: 'pro max', 'bro max': 'pro max', bromax: 'pro max', 'pro-max': 'pro max',
  '256 gb': '256gb', '512 gb': '512gb', '1 tb': '1tb', '2 tb': '2tb',
  '265gb': '256gb', '258gb': '256gb',
  erupe: 'europe', europ: 'europe', 'europ ': 'europe', europian: 'european', erope: 'europe', ereupe: 'europe',
  interntional: 'international', intrnational: 'international', 'int version': 'international version',
};

function applyDirectFixes(s) {
  for (const bad of Object.keys(DIRECT_FIXES).sort((a, b) => b.length - a.length)) {
    const safe = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${safe}\\b`, 'gi');
    s = s.replace(re, DIRECT_FIXES[bad]);
  }
  return s;
}

function splitMergedTokens(s) {
  s = s.replace(/(\d+)(pro|max|plus|mini|ultra|gb|tb|mm|inch)\b/gi, (_, n, u) => `${n} ${u.toLowerCase()}`);
  s = s.replace(/\b(m[1-9])(pro|max|ultra)\b/gi, (_, m, u) => `${m.toLowerCase()} ${u.toLowerCase()}`);
  return s;
}

const FINGLISH_INDICATORS = /\b(baladi|mikhay|mikham|mishe|nemishe|che\s*khabar|salam|mersi|shoma|man|chetor|khoobam|merci|bebakhshid|lotfan|chera|azash|ina|hast|daram|chikar|kojast|farsi|persian|پارسی|فارسی)\b/i;

export function detectLanguage(text) {
  if (!text) return 'en';
  const hasPersian = /[\u0600-\u06FF]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  const hasFinglish = FINGLISH_INDICATORS.test(text || '');
  if (hasPersian && hasLatin) return 'mixed';
  if (hasPersian) return 'fa';
  if (hasFinglish) return 'fa';
  return 'en';
}

export function normalize(raw) {
  if (!raw) return { raw: '', normalized: '', language: 'en' };
  const language = detectLanguage(raw);
  let s = String(raw).trim();
  s = foldDigits(s);
  s = s.toLowerCase();
  s = s.replace(/[\u00A0\u200C\u200D]+/g, ' ');
  s = s.replace(/[!?،,;:]+/g, ' ');
  s = s.replace(/[*_~`]+/g, ' ');
  s = applyDirectFixes(s);
  s = splitMergedTokens(s);
  s = s.replace(/\s+/g, ' ').trim();
  return { raw, normalized: s, language };
}
