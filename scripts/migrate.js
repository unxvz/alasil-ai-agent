import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const sqlPath = path.resolve(__dirname, '..', 'db', 'schema.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  logger.info({ sqlPath }, 'Applying schema');
  await pool.query(sql);
  logger.info('Schema applied');
  await pool.end();
}

run().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
