import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_TTL_SECONDS: z.coerce.number().default(1800),

  PG_HOST: z.string().default('localhost'),
  PG_PORT: z.coerce.number().default(5432),
  PG_USER: z.string().default('ai_support'),
  PG_PASSWORD: z.string().default('ai_support_pw'),
  PG_DATABASE: z.string().default('ai_support'),

  CORS_ORIGIN: z.string().default('*'),

  SHOPIFY_SHOP_DOMAIN: z.string().min(1, 'SHOPIFY_SHOP_DOMAIN is required'),
  SHOPIFY_STOREFRONT_TOKEN: z.string().min(1, 'SHOPIFY_STOREFRONT_TOKEN is required'),
  // Admin API (optional — if set, catalog prefers it over Storefront for
  // metafields, real per-location inventory, collections, and options).
  SHOPIFY_ADMIN_TOKEN: z.string().optional(),
  SHOPIFY_ADMIN_SHOP_HANDLE: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default('2024-01'),
  SHOPIFY_CACHE_TTL_SECONDS: z.coerce.number().default(300),
  SHOPIFY_CATALOG_MAX: z.coerce.number().default(1000),
  FEATURE_LIVE_SEARCH: z.coerce.boolean().default(true),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_PUBLIC_URL: z.string().optional(),
  TELEGRAM_ADMIN_USERS: z.string().optional(),

  // Feature flag: route requests through the LLM tool-calling agent.
  // When false, the legacy response.js pipeline is used.
  USE_AGENT: z.coerce.boolean().default(false),
  AGENT_MAX_ITERATIONS: z.coerce.number().default(5),
  AGENT_MODEL: z.string().default(''),

  // Concurrency + retry for OpenAI calls under load (see src/utils/concurrency.js).
  // Tier 1 (Free/default paid): ~500 RPM / 200k TPM for gpt-4o-mini. With agent
  // turns averaging ~15k tokens, max safe concurrency is ~5-6 to stay under TPM.
  AGENT_MAX_CONCURRENT: z.coerce.number().default(5),
  AGENT_MAX_RETRIES: z.coerce.number().default(5),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const data = { ...parsed.data };
data.TELEGRAM_ADMIN_USER_IDS = new Set(
  (data.TELEGRAM_ADMIN_USERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

export const config = Object.freeze(data);
