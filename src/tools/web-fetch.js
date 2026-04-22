// webFetch tool — let the agent pull from a short allow-list of Apple
// reference sources when apple_specs.md doesn't cover a question.
//
// Allowed domains (hardcoded — model cannot hit arbitrary sites):
//   - apple.com, www.apple.com (incl. /ae/)
//   - support.apple.com
//   - developer.apple.com
//   - theapplewiki.com
//   - www.gsmarena.com
//
// Results are cached in-memory for 24h so repeated lookups are fast and
// free. The tool strips HTML/scripts/styles and returns the first ~4000
// characters of cleaned text, which is enough for a spec page.

import { logger } from '../logger.js';

const CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONTENT_CHARS = 4000;
const FETCH_TIMEOUT_MS = 12_000;

const ALLOWED_HOST_RE = /^(www\.)?(apple\.com|support\.apple\.com|developer\.apple\.com|theapplewiki\.com|gsmarena\.com|www\.gsmarena\.com)$/i;

// Curated shortcut URLs for the most-asked Apple topics. All URLs below have
// been verified to return HTTP 200. Apple shuffles support.apple.com article
// IDs fairly often; if one goes 404, remove it from the list and add a
// replacement here. The LLM can also pass a raw URL on any allowed host.
const KNOWN_URLS = {
  // iPhone
  iphone_17_pro_specs: 'https://support.apple.com/en-us/125091',
  iphone_17_specs: 'https://support.apple.com/en-us/125089',
  iphone_air_specs: 'https://support.apple.com/en-us/125092',
  iphone_17e_specs: 'https://www.apple.com/ae/iphone-17e/specs/',
  // iPad — product spec pages list Apple Pencil / Keyboard compat on the page itself
  ipad_pro_m5_specs: 'https://support.apple.com/en-us/125407',
  ipad_air_specs: 'https://www.apple.com/ae/ipad-air/specs/',
  ipad_mini_specs: 'https://www.apple.com/ae/ipad-mini/specs/',
  // Mac
  macbook_pro_m5_specs: 'https://support.apple.com/en-us/126318',
  macbook_air_m4_specs: 'https://support.apple.com/en-us/122209',
  // Apple Watch
  apple_watch_series_11_specs: 'https://support.apple.com/en-us/125093',
  apple_watch_ultra_3_specs: 'https://support.apple.com/en-us/125095',
  // Audio
  airpods_pro_3_specs: 'https://support.apple.com/en-us/125135',
  // Announcements / general AE
  apple_newsroom_ae: 'https://www.apple.com/ae/newsroom/',
  apple_accessories: 'https://www.apple.com/ae/shop/ipad/ipad-accessories',
};

function stripHtml(html) {
  return String(html || '')
    // Drop scripts, styles, and JSON-LD chunks
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    // Drop nav/footer/header boilerplate that's common on apple.com
    .replace(/<(header|footer|nav)[\s\S]*?<\/(header|footer|nav)>/gi, ' ')
    // Preserve line breaks on block-level tags before stripping
    .replace(/<\/?(?:p|div|li|tr|br|h[1-6]|section|article)[^>]*>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'invalid URL' };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, error: 'only http/https allowed' };
  }
  if (!ALLOWED_HOST_RE.test(parsed.host)) {
    return { ok: false, error: `host not allowed: ${parsed.host}. Allowed: apple.com, support.apple.com, developer.apple.com, theapplewiki.com, gsmarena.com.` };
  }
  return { ok: true, url: parsed.toString() };
}

export async function webFetch({ url, topic }) {
  // Resolve topic shortcut
  let target = url;
  if (!target && topic && KNOWN_URLS[topic]) target = KNOWN_URLS[topic];
  if (!target) {
    return {
      error: 'provide either a url or a known topic',
      known_topics: Object.keys(KNOWN_URLS),
    };
  }

  const v = validateUrl(target);
  if (!v.ok) return { error: v.error, url: target };
  const finalUrl = v.url;

  // Cache hit?
  const cached = CACHE.get(finalUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return {
      url: finalUrl,
      cached: true,
      fetched_at: new Date(cached.ts).toISOString(),
      content: cached.content,
    };
  }

  // Fetch with timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(finalUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'alAsil-AI-Bot/1.0 (+https://alasil.ae)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}`, url: finalUrl };
    }
    const html = await resp.text();
    const text = stripHtml(html);
    const content = text.length > MAX_CONTENT_CHARS ? text.slice(0, MAX_CONTENT_CHARS) + '\n…[truncated]' : text;
    CACHE.set(finalUrl, { ts: Date.now(), content });
    logger.info({ url: finalUrl, chars: content.length }, 'webFetch cached');
    return {
      url: finalUrl,
      cached: false,
      fetched_at: new Date().toISOString(),
      content,
    };
  } catch (err) {
    return { error: String(err?.message || err), url: finalUrl };
  }
}

export function webFetchCacheStats() {
  return { size: CACHE.size, max_age_ms: CACHE_TTL_MS };
}

export const WEB_FETCH_KNOWN_TOPICS = Object.keys(KNOWN_URLS);
