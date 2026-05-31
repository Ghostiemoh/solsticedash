// ============================================================
// BullMQ Workers
// ============================================================
// Workers for processing async jobs from the queues.
// ============================================================

import { Worker, type Job } from 'bullmq';
import { redisConnectionOptions } from './queues.js';
import { createChildLogger } from '../telemetry/logger.js';
import { retryCounter } from '../telemetry/metrics.js';
import type { RetryPlan } from '../retry/retry-planner.js';

const log = createChildLogger('workers');

// ─── Retry Worker ──────────────────────────────────────────
export const retryWorker = new Worker(
  'solstice-retry',
  async (job: Job) => {
    const { transactionId, attempt, retryPlan } = job.data as {
      transactionId: string;
      attempt: number;
      retryPlan: RetryPlan;
    };

    log.info(
      { transactionId, attempt, reasoning: retryPlan.reasoning },
      'processing retry job',
    );

    // Wire to orchestrator to execute the retry transaction rebuild & submission
    try {
      const { orchestrator } = await import('../orchestrator.js');
      await orchestrator.retryTransaction(transactionId, retryPlan);
      retryCounter.labels('scheduled').inc();
    } catch (err: any) {
      log.error({ transactionId, error: err.message }, 'failed to execute retry transaction via orchestrator');
      throw err;
    }
  },
  {
    connection: redisConnectionOptions,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  },
);

retryWorker.on('completed', (job) => {
  log.debug({ jobId: job.id }, 'retry job completed');
});

retryWorker.on('failed', (job, error) => {
  log.error(
    { jobId: job?.id, error: error.message },
    'retry job failed',
  );
});

// ─── Bundle Worker ─────────────────────────────────────────
export const bundleWorker = new Worker(
  'solstice-bundle',
  async (job: Job) => {
    const { bundleId, transactions } = job.data as {
      bundleId: string;
      transactions: string[];
    };

    log.info(
      { bundleId, txCount: transactions.length },
      'processing bundle submission job',
    );

    // Bundle submission logic will be wired in Phase 6+
  },
  {
    connection: redisConnectionOptions,
    concurrency: 3,
  },
);

// ─── Telemetry Worker ──────────────────────────────────────
export const telemetryWorker = new Worker(
  'solstice-telemetry',
  async (job: Job) => {
    const { type } = job.data as {
      type: string;
      data: Record<string, unknown>;
    };

    log.trace({ type }, 'persisting telemetry');

    // Telemetry persistence to PostgreSQL will be wired in Phase 10+
  },
  {
    connection: redisConnectionOptions,
    concurrency: 10,
  },
);

/**
 * Close all workers gracefully.
 */
export async function closeWorkers(): Promise<void> {
  await Promise.all([
    retryWorker.close(),
    bundleWorker.close(),
    telemetryWorker.close(),
  ]);
  log.info('all workers closed');
}
