// Generate a corrected reply for a flagged turn.
//
// The owner flags a wrong agent reply and tells us (in plain English/Arabic)
// WHAT was wrong. We send that context to the same LLM + knowledge base the
// agent uses, so the generated reply follows the store's tone and rules.

import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { knowledgeBlock } from './knowledge.js';
import { correctionsBlock } from './corrections.js';
import { limitedRetry } from '../utils/concurrency.js';
import { openaiLimiter } from './agent.js';

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
const MAX_RETRIES = Math.max(0, Math.min(6, Number(config.AGENT_MAX_RETRIES) || 3));

const GENERATE_SYSTEM = `You are the senior support lead for alAsil (100% authentic Apple store in Dubai, UAE). A junior agent just gave a WRONG reply to a customer. The store owner is now telling you what was wrong. Your job: write the CORRECT reply the junior agent should have given.

OUTPUT RULES:
- Plain text only. No markdown. No emojis. No decorative bullets.
- Customer-facing voice — friendly, professional, concise. 2-5 short lines max.
- Match the customer's language: reply in Arabic if they wrote Arabic script; otherwise reply in English. Never Finglish or Persian.
- Never invent prices, stock, or products. If the fix depends on facts you don't have, write a short safe reply like "Let me check with our team — WhatsApp us at +971 4 288 5680."
- Follow store policies, payment rules, and product specs from the knowledge base provided.
- If the owner's feedback says "never say X" or "don't do Y" — make sure your correct reply avoids that pattern.
- Produce ONLY the corrected customer-facing reply. No preamble, no explanation, no "here's the correct reply:" — just the reply itself, ready to copy.
`;

export async function generateCorrectReply({ user_msg, wrong_reply, what_wrong, note, language }) {
  if (!user_msg) throw new Error('user_msg is required');

  const knowledge = knowledgeBlock();
  const pastCorrections = correctionsBlock();

  const langHint = language === 'ar'
    ? 'OUTPUT LANGUAGE: Arabic (the customer wrote in Arabic).'
    : 'OUTPUT LANGUAGE: English (the customer wrote in a non-Arabic language).';

  const userPrompt = [
    '# CUSTOMER MESSAGE',
    String(user_msg),
    '',
    '# WRONG REPLY (what the junior agent actually sent)',
    String(wrong_reply || '(no reply captured)'),
    '',
    '# WHY IT WAS WRONG (owner feedback)',
    String(what_wrong || note || '(no specific reason — just fix it)'),
    '',
    langHint,
    '',
    'Now write the correct reply the junior agent should have sent.',
  ].join('\n');

  try {
    const resp = await limitedRetry(
      openaiLimiter,
      () =>
        client.chat.completions.create({
          model: config.AGENT_MODEL || config.OPENAI_MODEL,
          temperature: 0.3,
          max_tokens: 400,
          messages: [
            { role: 'system', content: GENERATE_SYSTEM },
            { role: 'system', content: knowledge },
            ...(pastCorrections ? [{ role: 'system', content: pastCorrections }] : []),
            { role: 'user', content: userPrompt },
          ],
        }),
      { retries: MAX_RETRIES, label: 'corrections.generate' }
    );
    const text = (resp.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('empty generator response');
    return stripFormatting(text);
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'generateCorrectReply failed');
    throw err;
  }
}

function stripFormatting(text) {
  let s = String(text || '');
  s = s.replace(/^\s*here['']?s\s+(the\s+)?(correct|corrected|right)\s+reply:\s*/i, '');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1 $2');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  s = s.replace(/^[\s]*[•◆▪●○▶►]\s+/gm, '- ');
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
