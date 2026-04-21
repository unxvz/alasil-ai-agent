const VALID_STORAGE = new Set([64, 128, 256, 512, 1024, 2048, 4096]);
const VALID_RAM = new Set([8, 16, 24, 32, 36, 48, 64, 96]);

export function smartSpecFallback(userText) {
  const m = String(userText || '').trim().match(/^(\d+)\s*(gb|tb)?\s*$/i);
  if (!m) return null;
  let n = parseInt(m[1], 10);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'tb') n *= 1024;
  if (VALID_STORAGE.has(n) && !VALID_RAM.has(n)) return `${n >= 1024 ? Math.round(n / 1024) + 'TB' : n + 'GB'} storage`;
  if (VALID_RAM.has(n) && !VALID_STORAGE.has(n)) return `${n}GB ram`;
  if (VALID_STORAGE.has(n) && VALID_RAM.has(n)) return `${n}GB`;
  return null;
}

const ORDINAL_MAP = {
  first: 1, '1st': 1, one: 1, primary: 1,
  second: 2, '2nd': 2, two: 2,
  third: 3, '3rd': 3, three: 3,
  fourth: 4, '4th': 4, four: 4,
  last: -1, final: -1, bottom: -1,
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'one', 'please', 'ok', 'plz',
  'i', 'me', 'my', 'want', 'need', 'like', 'would', 'will', 'can', 'could', 'show', 'give', 'send',
]);

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function resolveOptionPick(userText, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const raw = String(userText || '').trim().toLowerCase();
  if (!raw) return null;

  const numeric = raw.match(/^([1-9])\s*\.?$/);
  if (numeric) {
    const idx = parseInt(numeric[1], 10) - 1;
    if (idx >= 0 && idx < options.length) return options[idx];
  }

  for (const [word, pos] of Object.entries(ORDINAL_MAP)) {
    const re = new RegExp(`\\b${word}\\b`);
    if (re.test(raw)) {
      const idx = pos === -1 ? options.length - 1 : pos - 1;
      if (idx >= 0 && idx < options.length) return options[idx];
    }
  }

  const userTokens = tokenize(raw);
  if (userTokens.length === 0) return null;

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < options.length; i++) {
    const opt = String(options[i] || '').toLowerCase();
    const optTokens = tokenize(opt);
    let score = 0;
    for (const t of userTokens) {
      if (optTokens.includes(t)) score += 2;
      else if (opt.includes(t)) score += 1;
    }
    if (opt.includes(raw) && raw.length >= 3) score += 3;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const minScore = Math.max(2, Math.floor(userTokens.length * 1));
  if (bestIdx >= 0 && bestScore >= minScore) return options[bestIdx];
  return null;
}
