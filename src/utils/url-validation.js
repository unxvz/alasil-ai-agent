// URL validation for the agent reply pipeline.
//
// The LLM emits text containing zero or more URLs. We must keep only URLs
// whose handle was actually surfaced this turn (via tool results) or in a
// previous turn (via session.last_products). Any URL with a handle outside
// this allow-set is hallucinated — strip it and append a WhatsApp fallback
// so the customer doesn't end up clicking a broken link.
//
// Compared to the old `stripUrlsForMultiProduct` (which strips ALL URLs
// when more than one product is in the reply), this validator:
//  - works for ANY product count (including 1-product replies)
//  - never substitutes URLs (no fuzzy matching, no token overlap)
//  - preserves UTM / fragment / query params on validated URLs
//    (UTM is implicit-stripped during HANDLE comparison, but the original
//    URL the LLM emitted is what flows through to the user)

const DEFAULT_FALLBACK =
  'Please contact us on WhatsApp +971 4 288 5680 for the link.';

// URL regex: starts with http(s)://, runs until whitespace or a common
// terminator. After `stripFormatting` runs first in the pipeline, markdown
// link syntax `[text](url)` has already been converted to `text url`,
// so we only see bare URLs at this stage.
const URL_RE = /https?:\/\/[^\s<>"\)\]]+/g;

// Trim trailing sentence-ending punctuation that the regex sometimes
// includes (e.g. "Visit https://x.com/foo." would otherwise capture the
// trailing period as part of the URL).
const TRAILING_PUNCT = /[.,!?;:]+$/;

// Extract the product handle from any URL whose path is /products/<handle>.
// Returns null on:
//   - malformed URLs (URL constructor throws)
//   - non-/products/ paths (handle = null)
//   - empty/missing handle segment
//
// Side effect: query params and fragment are stripped automatically by the
// URL constructor, so UTM-tagged URLs return the bare handle.
export function extractHandleFromUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  const trimmed = url.replace(TRAILING_PUNCT, '');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const m = parsed.pathname.match(/\/products\/([^/]+)/);
  if (!m) return null;
  const handle = m[1];
  return handle && handle.length > 0 ? handle : null;
}

// Validate URLs in `text` against `allowedHandles`. Each URL whose handle
// is in the set is kept verbatim (preserves UTM, fragment, etc.). Each URL
// whose handle is missing or not in the set is replaced with empty string,
// and a single fallback message is appended at the end if any URL was
// stripped.
//
// Returns:
//   - { text: string, stripped: string[] } where stripped is the array of
//     URLs that were removed (caller can log for observability).
export function validateUrls(text, allowedHandles, options = {}) {
  if (typeof text !== 'string' || !text) {
    return { text: '', stripped: [] };
  }
  const fallback = options.fallbackMessage || DEFAULT_FALLBACK;
  const allow = allowedHandles instanceof Set ? allowedHandles : new Set();

  const stripped = [];
  const next = text.replace(URL_RE, (match) => {
    const cleanUrl = match.replace(TRAILING_PUNCT, '');
    const handle = extractHandleFromUrl(cleanUrl);
    if (handle && allow.has(handle)) {
      // Keep the URL exactly as the LLM emitted it (UTM and all). Strip
      // any trailing punctuation we trimmed for handle extraction so the
      // user doesn't get "https://x.com/foo." style trailing dot weirdness;
      // the punctuation lives in the surrounding text via match-replace.
      const trailingMatch = match.match(TRAILING_PUNCT);
      return cleanUrl + (trailingMatch ? trailingMatch[0] : '');
    }
    stripped.push(cleanUrl);
    return '';
  });

  if (stripped.length === 0) {
    return { text: next, stripped: [] };
  }

  // Collapse blank lines/spaces left where URLs were removed, then append
  // the fallback message once.
  const cleaned = next
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    text: `${cleaned}\n\n${fallback}`.trim(),
    stripped,
  };
}
