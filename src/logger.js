import pino from 'pino';
import { config } from './config.js';

// In production (e.g. Passenger), write logs to stderr so Passenger captures them
// into stderr.log. In dev, use pino-pretty on stdout for readable console output.
const destination = config.NODE_ENV === 'production' ? pino.destination(2) : undefined;

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
