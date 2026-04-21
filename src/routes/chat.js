import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { normalize } from '../modules/normalize.js';
import { detectIntent, INTENTS } from '../modules/intent.js';
import { extractEntities } from '../modules/entities.js';
import { getSession, saveSession, resetSession, mergeProfile, appendHistory } from '../modules/context.js';
import { buildResponse } from '../modules/response.js';
import { resolveOptionPick, smartSpecFallback } from '../modules/option-match.js';
import { ValidationError } from '../utils/errors.js';
import { logger } from '../logger.js';

const chatSchema = z.object({
  sessionId: z.string().trim().min(1).max(128).optional(),
  message: z.string().min(1, 'message is required').max(2000),
  reset: z.boolean().optional(),
});

export const chatRouter = Router();

chatRouter.post('/', async (req, res, next) => {
  const parse = chatSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    return next(new ValidationError('Invalid request body', parse.error.flatten()));
  }
  const { sessionId: incoming, message, reset } = parse.data;
  const sessionId = incoming || uuidv4();

  try {
    if (reset) await resetSession(sessionId);
    const session = await getSession(sessionId);
    session.turns = (session.turns || 0) + 1;

    let effectiveText = message;
    if (Array.isArray(session.last_options) && session.last_options.length) {
      const picked = resolveOptionPick(message, session.last_options);
      if (picked) effectiveText = picked;
      else {
        const fallback = smartSpecFallback(message);
        if (fallback) effectiveText = fallback;
      }
    }

    const { normalized, language } = normalize(effectiveText);
    session.language = language === 'mixed' ? (session.language || 'en') : language;

    const { intent, confidence } = detectIntent(normalized);
    const entities = extractEntities(normalized);
    session.profile = mergeProfile(session.profile || {}, entities, normalized);
    if (!session.profile.category && entities.category) session.profile.category = entities.category;
    session.intent = intent;

    appendHistory(session, 'user', message);

    const responsePayload = await buildResponse({
      intent,
      profile: session.profile,
      language: session.language,
      userMessage: normalized,
      history: session.history || [],
      lastProducts: session.last_products || [],
    });

    if (responsePayload.type === 'question') {
      session.last_question = responsePayload.field;
      session.asked_fields = Array.from(new Set([...(session.asked_fields || []), responsePayload.field]));
      session.last_options = (responsePayload.options || []).map((o) => {
        if (typeof o === 'number') {
          if (responsePayload.field === 'storage_gb') return o >= 1024 ? `${Math.round(o / 1024)}TB` : `${o}GB`;
          if (responsePayload.field === 'ram_gb') return `${o}GB`;
          if (responsePayload.field === 'screen_inch') return `${o} inch`;
        }
        return String(o);
      });
    } else {
      session.last_question = null;
      session.last_options = [];
    }
    if (Array.isArray(responsePayload.products) && responsePayload.products.length > 0) {
      session.last_products = responsePayload.products.slice(0, 4);
    }

    appendHistory(session, 'assistant', responsePayload.text);
    await saveSession(sessionId, session);

    logger.info({
      sessionId, intent, confidence, language: session.language,
      profile: session.profile, responseType: responsePayload.type,
    }, 'chat turn');

    return res.json({
      sessionId,
      intent,
      language: session.language,
      profile: session.profile,
      type: responsePayload.type,
      message: responsePayload.text,
      ...(responsePayload.field ? { field: responsePayload.field } : {}),
      ...(responsePayload.options ? { options: responsePayload.options } : {}),
      ...(responsePayload.products
        ? {
            products: responsePayload.products.map((p) => ({
              sku: p.sku,
              title: p.title,
              price_aed: Number(p.price_aed),
              was_aed: p.compare_at_aed !== null && p.compare_at_aed !== undefined ? Number(p.compare_at_aed) : null,
              in_stock: p.in_stock,
              url: p.url,
            })),
          }
        : {}),
    });
  } catch (err) {
    return next(err);
  }
});

chatRouter.delete('/:sessionId', async (req, res, next) => {
  try {
    await resetSession(req.params.sessionId);
    res.json({ ok: true, sessionId: req.params.sessionId, reset: true });
  } catch (err) {
    next(err);
  }
});
