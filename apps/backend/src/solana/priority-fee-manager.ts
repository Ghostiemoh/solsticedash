// ============================================================
// Priority Fee Manager
// ============================================================
// Polls recent priority fees from the RPC and maintains a rolling
// window. Computes optimal fee based on configurable percentile
// targeting. Publishes fee updates via the event bus.
// ============================================================

import { rpcManager } from './rpc-manager.js';
import { createChildLogger } from '../telemetry/logger.js';
import { priorityFeeGauge } from '../telemetry/metrics.js';
import {
  PRIORITY_FEE_POLL_INTERVAL_MS,
  PRIORITY_FEE_WINDOW_SIZE,
  percentile,
} from '@solstice/shared';

const log = createChildLogger('priority-fee');

interface FeeSnapshot {
  timestamp: number;
  fees: number[];
  p50: number;
  p75: number;
  p90: number;
}

export class PriorityFeeManager {
  private feeHistory: FeeSnapshot[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;

  /**
   * Start polling for priority fee data at regular intervals.
   */
  start(): void {
    if (this.isPolling) return;
    this.isPolling = true;

    // Poll immediately, then on interval
    this.poll().catch((err) => {
      log.error({ err }, 'initial priority fee poll failed');
    });

    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        log.error({ err }, 'priority fee poll failed');
      });
    }, PRIORITY_FEE_POLL_INTERVAL_MS);

    log.info(
      { intervalMs: PRIORITY_FEE_POLL_INTERVAL_MS },
      'priority fee polling started',
    );
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
    log.info('priority fee polling stopped');
  }

  /**
   * Poll the RPC for recent prioritization fees.
   */
  private async poll(): Promise<void> {
    try {
      const recentFees = await rpcManager.execute(
        'getRecentPrioritizationFees',
        (conn) => conn.getRecentPrioritizationFees(),
      );

      const feeValues = recentFees
        .map((f) => f.prioritizationFee)
        .filter((f) => f > 0)
        .sort((a, b) => a - b);

      if (feeValues.length === 0) {
        log.trace('no non-zero priority fees in recent window');
        return;
      }

      const snapshot: FeeSnapshot = {
        timestamp: Date.now(),
        fees: feeValues,
        p50: percentile(feeValues, 50),
        p75: percentile(feeValues, 75),
        p90: percentile(feeValues, 90),
      };

      this.feeHistory.push(snapshot);

      // Keep rolling window
      if (this.feeHistory.length > PRIORITY_FEE_WINDOW_SIZE) {
        this.feeHistory.shift();
      }

      // Update Prometheus gauges
      priorityFeeGauge.labels('p50').set(snapshot.p50);
      priorityFeeGauge.labels('p75').set(snapshot.p75);
      priorityFeeGauge.labels('p90').set(snapshot.p90);

      log.trace(
        { p50: snapshot.p50, p75: snapshot.p75, p90: snapshot.p90 },
        'priority fees updated',
      );
    } catch (error) {
      log.warn({ error }, 'failed to fetch priority fees');
    }
  }

  /**
   * Get the recommended priority fee for a given percentile.
   * Returns fee in microLamports.
   */
  getRecommendedFee(targetPercentile: number = 50): number {
    if (this.feeHistory.length === 0) {
      return 0;
    }

    const latestSnapshot = this.feeHistory[this.feeHistory.length - 1];
    if (!latestSnapshot) {
      return 0;
    }

    if (targetPercentile <= 50) return latestSnapshot.p50;
    if (targetPercentile <= 75) return latestSnapshot.p75;
    return latestSnapshot.p90;
  }

  /**
   * Get the most recently polled fee data.
   */
  getRecentFees(): FeeSnapshot | null {
    return this.feeHistory[this.feeHistory.length - 1] ?? null;
  }

  /**
   * Get the latest fee snapshot for observability.
   */
  getLatestSnapshot(): FeeSnapshot | null {
    return this.feeHistory[this.feeHistory.length - 1] ?? null;
  }

  /**
   * Get full fee history for trend analysis (used by AI decision engine).
   */
  getFeeHistory(): FeeSnapshot[] {
    return [...this.feeHistory];
  }
}

export const priorityFeeManager = new PriorityFeeManager();
