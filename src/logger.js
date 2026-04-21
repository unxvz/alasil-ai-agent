import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// In production (Passenger), write logs to a file we control so we can always
// find them. In dev, use pino-pretty on stdout for readable console output.
function productionDestination() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const logDir = path.resolve(__dirname, '..', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'app.log');
    return pino.destination({ dest: logFile, sync: false, mkdir: true });
  } catch {
    return pino.destination(2); // fall back to stderr
  }
}

const destination = config.NODE_ENV === 'production' ? productionDestination() : undefined;

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', singleLine: false },
        },
    base: { service: 'ai-support-agent' },
  },
  destination,
);
