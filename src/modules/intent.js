const INTENTS = Object.freeze({
  PRODUCT_INQUIRY:  'product_inquiry',
  COMPARISON:       'comparison',
  GENERAL_QUESTION: 'general_question',
  SUPPORT:          'support',
});

const SUPPORT_PATTERNS = [
  /\b(refund|return|exchange|broken|damaged|defect(ive)?|complaint|agent|human|manager|ticket|help me|problem)\b/i,
  /\b(order\s*status|where\s*is\s*my\s*order|track(ing)?\s*(number|link|order)?|cancel(l?ed)?\s*(my|the)?\s*order)\b/i,
  /\b(replace|replacement)\b/i,
];

const GENERAL_PATTERNS = [
  /\b(hours|open|closed|close|location|address|store|branch|phone|whatsapp|contact|call\s*(you|me|us)?|physical\s*store|visit(\s*(your|the)\s*(shop|store))?|your\s*shop)\b/i,
  /\b(payment|pay|cod|cash on delivery|tabby|tamara|installment|instalment|bnpl|apple pay|google pay|samsung pay|card|visa|mastercard|amex|american\s*express|diners|discover|jcb)\b/i,
  /\b(authentic|genuine|original|fake|warranty|brand\s*new|sealed|refurbish(ed)?|used|second[-\s]?hand)\b/i,
  /\b(policy|terms|conditions)\b/i,
  /\b(deliver|delivery|ship|shipping|courier|same[-\s]?day|arrive|today|tomorrow|when\s*(will|can|do)|how\s*(long|soon)|hand(ed)?\s*(to|over)|when\s*.*\border|pickup|pick[-\s]?up|collection|in[-\s]?store|evening|morning|afternoon)\b/i,
  /\b(invoice|tax[-\s]?free|vat|serial\s*number|receipt|export|commercial\s*invoice|bulk|b2b)\b/i,
  /\b(latest|newest|most\s*recent|current(ly\s*sold)?|just\s*(launched|released)|newly\s*released|lineup|line[-\s]?up)\b/i,
  /\b(abu\s*dhabi|sharjah|ajman|fujairah|ras\s*al\s*khaimah|umm\s*al\s*quwain|al\s*ain|uae|emirates|dubai|deira|bur\s*dubai|jumeirah|marina|jvc|jbr|al\s*[a-z]{3,})\b/i,
  /\b(compatib(le|ility)|work(s|ing)?\s*with|fit(s)?\s*(my|the)?|support(s|ed)?\s*(pencil|magsafe|esim|face\s*time))\b/i,
  /\b(com(es|e)\s*with|includes|included|in\s*the\s*box|what'?s\s*in|charges?\s*with|charging\s*via|charge\s*with)\b/i,
  /\b(trade[-\s]?in|trade\s*my|sell\s*my|buy\s*my|exchange\s*my)\b/i,
  /\b(fix|repair|fixed|broken|cracked|damaged|service|replace\s*(screen|battery))\b/i,
  /\bwhich\s+(pencil|keyboard|charger|cable|case|stand|accessory|sim|color|model|variant|version)\b/i,
  /\b(face\s*time|esim|sim\s*card|middle\s*east|international|eu\s*version|us\s*version|uk\s*version|europe(an)?|me\s*version|arabic\s*keyboard)\b/i,
  /\b(my\s*order|update\s*on\s*(my|the)\s*order|any\s*update|order\s*update|check\s*my\s*order)\b/i,
  /\b(noon|amazon|carrefour|sharaf\s*dg|another\s*(shop|store|seller)|competitor)\b/i,
];

// Strong signals that OVERRIDE product_inquiry when present (even if "buy" word appears, like "buy with Tabby")
const STRONG_GENERAL_OVERRIDE = /\b(tabby|tamara|cod|cash\s*on\s*delivery|apple\s*pay|installment|instalment|bnpl|invoice|tax[-\s]?free|vat|warranty|refund|return|shipping|delivery|face\s*time|middle\s*east|international|authentic|brand\s*new|refurbish|used|order\s*(status|number|update)|update\s*on\s*(my|the)\s*order|my\s*order|physical\s*store|your\s*(shop|store)|visit|trade[-\s]?in|trade\s*my|sell\s*my|buy\s*my|fix|repair|broken|cracked|damaged|service)\b/i;

const COMPARISON_PATTERNS = [
  /\b(vs|versus|compare|comparison|difference|better than|worse than|which is better)\b/i,
  /\b(cheaper|more expensive|bigger|smaller|lighter|heavier|faster|slower|best for)\b/i,
  /\bwhich\s+(is\s+)?(good|best|right)\s+for\s+me\b/i,
];

const PRODUCT_PATTERNS = [
  /\b(iphone|ipad|mac|macbook|imac|airpods|airtag|apple watch|watch|pencil|magsafe|homepod)\b/i,
  /\b(buy|need|looking for|interested|want|show me|searching|find)\b/i,
];

const QUESTION_INDICATORS = [
  /^\s*(do|does|did|is|are|was|were|can|could|will|would|should|what|how|why|which|who|when|where)\b/i,
  /\?\s*$/,
  /\b(compatib(le|ility)|work(s|ing)?\s*with|fit(s)?\s*(my|the|it)\b|support(s|ed)?\s*(pencil|magsafe|esim|face\s*time|sim))\b/i,
  /\bdifference\s*between\b/i,
  /\b(latest|newest|most\s*recent|current(ly\s*sold)?|just\s*(launched|released)|newly\s*released)\b/i,
];

function scorePatterns(text, patterns) {
  let score = 0;
  for (const re of patterns) if (re.test(text)) score += 1;
  return score;
}

function isQuestion(text) {
  return QUESTION_INDICATORS.some((re) => re.test(text));
}

export function detectIntent(normalizedText) {
  const t = normalizedText || '';
  if (!t.trim()) {
    return { intent: INTENTS.GENERAL_QUESTION, confidence: 0 };
  }

  const scores = {
    [INTENTS.SUPPORT]:          scorePatterns(t, SUPPORT_PATTERNS),
    [INTENTS.GENERAL_QUESTION]: scorePatterns(t, GENERAL_PATTERNS),
    [INTENTS.COMPARISON]:       scorePatterns(t, COMPARISON_PATTERNS),
    [INTENTS.PRODUCT_INQUIRY]:  scorePatterns(t, PRODUCT_PATTERNS),
  };

  if (scores[INTENTS.SUPPORT] >= 1) {
    return { intent: INTENTS.SUPPORT, confidence: scores[INTENTS.SUPPORT] };
  }

  const q = isQuestion(t);
  const hasBuyIntent = /\b(buy|order|purchase|get|want\s+to\s+buy|want\s+it|add\s+to\s+cart|show\s+me|price|how\s*much)\b/i.test(t);
  const hasStrongGeneral = STRONG_GENERAL_OVERRIDE.test(t);

  if (hasStrongGeneral && scores[INTENTS.GENERAL_QUESTION] >= 1) {
    return { intent: INTENTS.GENERAL_QUESTION, confidence: scores[INTENTS.GENERAL_QUESTION] + 2 };
  }

  if (q && !hasBuyIntent && scores[INTENTS.GENERAL_QUESTION] >= 1) {
    return { intent: INTENTS.GENERAL_QUESTION, confidence: scores[INTENTS.GENERAL_QUESTION] + 1 };
  }

  if (scores[INTENTS.COMPARISON] >= 1 && scores[INTENTS.PRODUCT_INQUIRY] >= 1) {
    return { intent: INTENTS.COMPARISON, confidence: scores[INTENTS.COMPARISON] + scores[INTENTS.PRODUCT_INQUIRY] };
  }
  if (scores[INTENTS.COMPARISON] >= 1) {
    return { intent: INTENTS.COMPARISON, confidence: scores[INTENTS.COMPARISON] };
  }

  if (q && !hasBuyIntent && scores[INTENTS.PRODUCT_INQUIRY] === 0) {
    return { intent: INTENTS.GENERAL_QUESTION, confidence: 1 };
  }

  if (scores[INTENTS.PRODUCT_INQUIRY] >= 1) {
    return { intent: INTENTS.PRODUCT_INQUIRY, confidence: scores[INTENTS.PRODUCT_INQUIRY] };
  }
  if (scores[INTENTS.GENERAL_QUESTION] >= 1) {
    return { intent: INTENTS.GENERAL_QUESTION, confidence: scores[INTENTS.GENERAL_QUESTION] };
  }
  return { intent: INTENTS.PRODUCT_INQUIRY, confidence: 0 };
}

export { INTENTS };
