import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const sqlPath = path.resolve(__dirname, '..', 'db', 'seed.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  logger.info({ sqlPath }, 'Seeding products');
  await pool.query(sql);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  logger.info({ count: rows[0].n }, 'Seed complete');
  await pool.end();
}

run().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
