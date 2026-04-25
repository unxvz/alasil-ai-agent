// UTM tagging for product URLs sent to customers.
//
// Mohammad wants every link the AI agent sends to be attributable in
// Shopify analytics, so when a customer clicks → adds to cart → checks out,
// the order shows up under "support_assistant" attribution and we can
// quantify the bot's revenue impact.
//
// Standard pattern:
//   utm_source   = where the click came from (alasil_ai_bot)
//   utm_medium   = how it reached them (chat)
//   utm_campaign = which initiative (support_assistant)
//
// The function preserves any existing query string and is a no-op for
// non-alasil URLs (we never tag third-party links).

import { config } from '../config.js';

const ALASIL_HOST_RE = /(^https?:\/\/(www\.)?alasil\.ae)/i;

export function withUtm(url, extras = {}) {
  if (!url || typeof url !== 'string') return url;
  // Only tag alasil.ae product URLs. Leave Apple support / wiki / external
  // links untouched.
  if (!ALASIL_HOST_RE.test(url)) return url;

  // Build the param set; SKIP keys whose configured value is an empty
  // string so URLs stay short. Default config: only utm_source is set.
  const candidates = {
    utm_source: extras.utm_source ?? config.UTM_SOURCE,
    utm_medium: extras.utm_medium ?? config.UTM_MEDIUM,
    utm_campaign: extras.utm_campaign ?? config.UTM_CAMPAIGN,
    utm_content: extras.utm_content,
    utm_term: extras.utm_term,
  };
  const params = Object.fromEntries(
    Object.entries(candidates).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  if (Object.keys(params).length === 0) return url; // nothing to add

  let tagged;
  try {
    const u = new URL(url);
    // If URL already has utm_source, do not duplicate — assume previously tagged.
    if (u.searchParams.has('utm_source')) return url;
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, String(v));
    }
    tagged = u.toString();
  } catch {
    // URL parsing failed — fall back to manual append.
    const sep = url.includes('?') ? '&' : '?';
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    tagged = `${url}${sep}${qs}`;
  }
  return tagged;
}

// Strip UTM parameters from a URL (used when comparing URLs for equality —
// e.g. the URL hallucination guard checks against catalog URLs which DON'T
// have UTM, but the LLM may receive UTM-tagged URLs from briefProduct).
export function stripUtm(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    [...u.searchParams.keys()].forEach((k) => {
      if (k.startsWith('utm_')) u.searchParams.delete(k);
    });
    const cleaned = u.toString();
    // URL.toString() leaves trailing "?" if all params removed — clean that.
    return cleaned.endsWith('?') ? cleaned.slice(0, -1) : cleaned;
  } catch {
    return url;
  }
}
