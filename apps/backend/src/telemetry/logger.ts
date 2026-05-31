// ============================================================
// Structured Logger (Pino)
// ============================================================
// JSON-structured logging with child loggers per module.
// Redacts sensitive fields (private keys, API keys).
// ============================================================

import pino from 'pino';
import { env } from '../config/env.js';

const redactPaths = [
  'WALLET_PRIVATE_KEY',
  'GEMINI_API_KEY',
  'YELLOWSTONE_GRPC_TOKEN',
  'privateKey',
  'secretKey',
  'apiKey',
  'authorization',
  'cookie',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  base: {
    service: 'solstice-backend',
    env: env.NODE_ENV,
  },
});

export function createChildLogger(module: string): pino.Logger {
  return logger.child({ module });
}
