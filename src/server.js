import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './logger.js';
import { chatRouter } from './routes/chat.js';
import { telegramRouter } from './routes/telegram.js';
import { errorHandler } from './utils/errors.js';
import { closeRedis } from './modules/context.js';
import { pingShopify } from './modules/shopify.js';
import { getCatalog, catalogStatus } from './modules/catalog.js';
import { snapshotMetrics, readRecentTurns } from './modules/agent-metrics.js';
import { listCorrections, addCorrection, deleteCorrection } from './modules/corrections.js';
import { generateCorrectReply } from './modules/correction-generator.js';
import { openaiLimiter } from './modules/agent.js';
import { DASHBOARD_HTML } from './dashboard-html.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: '64kb' }));

app.use((req, _res, next) => {
  req._start = Date.now();
  next();
});
app.use((req, res, next) => {
  res.on('finish', () => {
    const ms = Date.now() - req._start;
    logger.debug({ method: req.method, path: req.path, status: res.statusCode, ms }, 'http');
  });
  next();
});

// Support URL_BASE_PATH for sub-URI deployments (e.g. cPanel Passenger at /agent)
let BASE_PATH = (process.env.URL_BASE_PATH || process.env.PASSENGER_BASE_URI || '').trim().replace(/\/$/, '');
if (BASE_PATH && !BASE_PATH.startsWith('/')) BASE_PATH = '/' + BASE_PATH;
if (BASE_PATH) logger.info({ BASE_PATH }, 'URL_BASE_PATH set');

const router = express.Router();

router.get('/', (_req, res) => res.json({ ok: true, service: 'alasil-ai-agent', version: '0.1.0' }));

router.get('/health', async (_req, res) => {
  try {
    const shopify = await pingShopify();
    res.json({
      ok: true,
      shopify,
      catalog: catalogStatus(),
      agent: {
        enabled: config.USE_AGENT,
        model: config.AGENT_MODEL || config.OPENAI_MODEL,
        max_iterations: config.AGENT_MAX_ITERATIONS,
      },
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err.message || err) });
  }
});

router.get('/agent/stats', (_req, res) => {
  res.json({ ...snapshotMetrics(), openai_limiter: openaiLimiter.stats() });
});

router.get('/agent/recent', (req, res) => {
  const n = Math.min(100, Math.max(1, parseInt(req.query.n, 10) || 25));
  res.json({ turns: readRecentTurns(n) });
});

// Corrections (owner feedback). Shares DASHBOARD_SECRET gate with the dashboard.
function checkDashboardSecret(req, res) {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected) return true;
  const got = req.get('x-dashboard-secret') || req.query.secret || '';
  if (got !== expected) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid secret' } });
    return false;
  }
  return true;
}
router.get('/agent/corrections', (req, res) => {
  if (!checkDashboardSecret(req, res)) return;
  res.json({ corrections: listCorrections() });
});
router.post('/agent/corrections', express.json(), (req, res) => {
  if (!checkDashboardSecret(req, res)) return;
  const { user_msg, wrong_reply, correct_reply, note } = req.body || {};
  if (!user_msg && !wrong_reply && !correct_reply && !note) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'empty correction' } });
  }
  try {
    const row = addCorrection({ user_msg, wrong_reply, correct_reply, note });
    res.json({ ok: true, correction: row });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL', message: String(err?.message || err) } });
  }
});
router.delete('/agent/corrections/:id', (req, res) => {
  if (!checkDashboardSecret(req, res)) return;
  const ok = deleteCorrection(req.params.id);
  res.json({ ok });
});

// Generate the suggested correct reply for a flagged turn (calls OpenAI).
router.post('/agent/corrections/generate', express.json(), async (req, res) => {
  if (!checkDashboardSecret(req, res)) return;
  const { user_msg, wrong_reply, what_wrong, note, language } = req.body || {};
  if (!user_msg) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'user_msg is required' } });
  }
  try {
    const generated = await generateCorrectReply({ user_msg, wrong_reply, what_wrong, note, language });
    res.json({ ok: true, generated });
  } catch (err) {
    logger.error({ err: String(err?.message || err) }, 'generate correct reply failed');
    res.status(500).json({ error: { code: 'GENERATOR_FAILED', message: String(err?.message || err) } });
  }
});

// Monitoring dashboard. Gated by DASHBOARD_SECRET env var (optional).
// If set, URL is /dashboard/:secret; if unset, /dashboard is public.
// CSP is relaxed for this route to allow the inline script/style bundled
// into the HTML page — helmet's default CSP (`script-src 'self'`) would
// otherwise block it.
function sendDashboard(res) {
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
  );
  res.type('html').send(DASHBOARD_HTML);
}
router.get('/dashboard', (_req, res) => {
  if (process.env.DASHBOARD_SECRET) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  }
  sendDashboard(res);
});
router.get('/dashboard/:secret', (req, res) => {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected) {
    return res.redirect('/dashboard');
  }
  if (req.params.secret !== expected) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid dashboard secret' } });
  }
  sendDashboard(res);
});

const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
});

router.use('/chat', chatLimiter, chatRouter);
router.use('/webhook/telegram', express.json({ limit: '128kb' }), telegramRouter);

// Mount the router at both root and BASE_PATH so same code works locally and under Passenger sub-URI.
app.use(router);
if (BASE_PATH) app.use(BASE_PATH, router);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

app.use(errorHandler(logger));

const server = app.listen(config.PORT, async () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'AI Support Agent listening');
  try {
    const items = await getCatalog();
    logger.info({ count: items.length }, 'Shopify catalog warmed');
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'Initial catalog warm failed (will retry on demand)');
  }
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    try { await closeRedis(); } catch (err) { logger.warn({ err }, 'redis close failed'); }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
