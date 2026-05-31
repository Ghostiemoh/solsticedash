// ============================================================
// BullMQ Queue Definitions
// ============================================================
// Queue definitions for async job processing: retry scheduling,
// bundle submission, telemetry persistence.
// ============================================================

import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('queues');

// Shared Redis connection options for all queues
const parsedRedisUrl = new URL(env.REDIS_URL);
const redisConnectionOptions: any = {
  host: parsedRedisUrl.hostname || 'localhost',
  port: parseInt(parsedRedisUrl.port || '6379', 10),
  maxRetriesPerRequest: null,
};

if (parsedRedisUrl.username) {
  redisConnectionOptions.username = parsedRedisUrl.username;
}
if (parsedRedisUrl.password) {
  redisConnectionOptions.password = parsedRedisUrl.password;
}
if (parsedRedisUrl.protocol === 'rediss:') {
  redisConnectionOptions.tls = {};
}

// ─── Retry Queue ───────────────────────────────────────────
export const retryQueue = new Queue('solstice-retry', {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

// ─── Bundle Queue ──────────────────────────────────────────
export const bundleQueue = new Queue('solstice-bundle', {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

// ─── Telemetry Queue ───────────────────────────────────────
export const telemetryQueue = new Queue('solstice-telemetry', {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: { count: 500 },
  },
});

/**
 * Close all queue connections gracefully.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([
    retryQueue.close(),
    bundleQueue.close(),
    telemetryQueue.close(),
  ]);
  log.info('all queues closed');
}

export { redisConnectionOptions };
