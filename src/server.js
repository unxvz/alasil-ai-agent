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
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err.message || err) });
  }
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
