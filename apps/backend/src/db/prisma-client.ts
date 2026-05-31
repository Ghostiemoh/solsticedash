// ============================================================
// Prisma Client Singleton
// ============================================================
// Single Prisma client instance for the entire application.
// Prevents connection pool exhaustion during development (tsx watch).
// ============================================================

import { PrismaClient } from '@prisma/client';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('prisma');

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Log slow queries in development
prisma.$on('query' as never, (event: { duration: number; query: string }) => {
  if (event.duration > 100) {
    log.warn(
      { durationMs: event.duration, query: event.query.slice(0, 200) },
      'slow query detected',
    );
  }
});

prisma.$on('error' as never, (event: { message: string }) => {
  log.error({ error: event.message }, 'prisma error');
});
