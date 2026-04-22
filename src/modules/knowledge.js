import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '..', '..', 'config');

const FILES = {
  custom_answers:      'custom_answers.md',
  policies:            'policies.md',
  apple_specs:         'apple_specs.md',
  apple_current_lineup:'apple_current_lineup.md',
  payment_methods:     'payment_methods.md',
  catalog_taxonomy:    'catalog_taxonomy.md',
};

let _knowledge = null;

function loadKnowledge() {
  const out = {};
  for (const [key, name] of Object.entries(FILES)) {
    const full = path.join(CONFIG_DIR, name);
    try {
      out[key] = fs.readFileSync(full, 'utf8');
    } catch (err) {
      logger.warn({ file: name, err: String(err?.message || err) }, 'Knowledge file missing');
      out[key] = '';
    }
  }
  return out;
}

export function getKnowledge() {
  if (!_knowledge) _knowledge = loadKnowledge();
  return _knowledge;
}

export function reloadKnowledge() {
  _knowledge = loadKnowledge();
  return _knowledge;
}

export function knowledgeBlock() {
  const k = getKnowledge();
  const parts = [];
  if (k.custom_answers?.trim()) {
    parts.push('=== CUSTOM_ANSWERS (HIGHEST PRIORITY — if customer question matches, answer exactly as written) ===');
    parts.push(k.custom_answers.trim());
  }
  if (k.policies?.trim()) {
    parts.push('\n=== STORE POLICIES & VERSION RULES ===');
    parts.push(k.policies.trim());
  }
  if (k.apple_specs?.trim()) {
    parts.push('\n=== APPLE PRODUCT SPECS (authoritative — quote verbatim) ===');
    parts.push(k.apple_specs.trim());
  }
  if (k.apple_current_lineup?.trim()) {
    parts.push('\n=== APPLE CURRENT LINEUP (auto-synced from apple.com/ae — this is the freshest source for which models Apple currently sells) ===');
    parts.push(k.apple_current_lineup.trim());
  }
  if (k.payment_methods?.trim()) {
    parts.push('\n=== PAYMENT METHODS REFERENCE ===');
    parts.push(k.payment_methods.trim());
  }
  if (k.catalog_taxonomy?.trim()) {
    parts.push('\n=== CATALOG TAXONOMY (auto-generated from Shopify — use for orientation, not precise stock) ===');
    parts.push(k.catalog_taxonomy.trim());
  }
  return parts.join('\n');
}
