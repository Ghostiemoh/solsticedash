// ============================================================
// Bundle Tracker
// ============================================================
// Tracks the status of submitted bundles by polling the
// getInflightBundleStatuses RPC method. Updates bundle records
// and emits events on success or drop.
// ============================================================

import { env } from '../config/env.js';
import { createChildLogger } from '../telemetry/logger.js';
import { EVENTS, type BundleRecord, BundleStatus } from '@solstice/shared';
import { eventBus } from '../events/event-bus.js';
import { tipManager } from './tip-manager.js';
import { prisma } from '../db/prisma-client.js';

const log = createChildLogger('bundle-tracker');

// Bundles still pending after this long never landed within their leader window.
// We treat them as dropped (probable Jito leader skip) so the retry engine can
// resubmit, rather than tracking a stuck bundle indefinitely.
const BUNDLE_PENDING_TIMEOUT_MS = 12_000;

interface InflightBundleStatus {
  bundle_id: string;
  status: 'Pending' | 'Failed' | 'Landed';
  landed_slot: number | null;
}

interface JitoStatusResponse {
  jsonrpc: string;
  result?: {
    value: InflightBundleStatus[];
  };
  error?: {
    code: number;
    message: string;
  };
  id: number;
}

export class BundleTracker {
  private trackedBundles = new Map<string, BundleRecord>();
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly endpoint: string;

  constructor() {
    this.endpoint = env.JITO_BLOCK_ENGINE_URL.split(',')[0]!.trim();
  }

  /**
   * Start tracking a submitted bundle.
   */
  track(bundleRecord: BundleRecord): void {
    if (!bundleRecord.bundleId) {
      throw new Error('Cannot track bundle without a Jito bundleId');
    }
    this.trackedBundles.set(bundleRecord.bundleId, bundleRecord);
    this.ensurePolling();
    log.debug({ bundleId: bundleRecord.bundleId }, 'started tracking bundle');
  }

  private ensurePolling(): void {
    if (!this.pollTimer && this.trackedBundles.size > 0) {
      this.pollTimer = setInterval(() => this.pollStatuses(), 2000);
    }
  }

  private async pollStatuses(): Promise<void> {
    if (this.trackedBundles.size === 0) {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      return;
    }

    // First, expire any bundle that has been pending past its leader window.
    this.expireStaleBundles();

    const bundleIds = Array.from(this.trackedBundles.keys());

    // Process in batches of 5 (Jito limit)
    for (let i = 0; i < bundleIds.length; i += 5) {
      const batch = bundleIds.slice(i, i + 5);
      await this.fetchBatchStatus(batch);
    }
  }

  /**
   * Drop bundles that have been pending past the leader window without landing.
   * Emits BUNDLE_DROPPED so the orchestrator's drop analyzer can classify the
   * cause (typically a Jito leader skip) and schedule a leader-aware retry.
   */
  private expireStaleBundles(): void {
    const now = Date.now();
    for (const [bundleId, record] of this.trackedBundles) {
      if (now - record.sentAt <= BUNDLE_PENDING_TIMEOUT_MS) continue;

      record.status = BundleStatus.DROPPED;
      record.rejectedAt = now;

      tipManager.recordOutcome(record.tipLamports, false);
      eventBus.emit(EVENTS.BUNDLE_DROPPED, record);

      prisma.bundle
        .update({
          where: { id: record.id },
          data: {
            status: BundleStatus.DROPPED,
            rejectedAt: new Date(now),
            rejectionReason: 'leader_skip_timeout',
          },
        })
        .catch((err) =>
          log.error({ err: err.message }, 'failed to update expired bundle in database')
        );

      this.trackedBundles.delete(bundleId);

      log.warn(
        { bundleId, elapsedMs: now - record.sentAt },
        'bundle pending past leader window — dropping as probable leader skip',
      );
    }
  }

  private async fetchBatchStatus(bundleIds: string[]): Promise<void> {
    if (env.MOCK_MODE) {
      for (const bundleId of bundleIds) {
        const isLanded = Math.random() > 0.3; 
        const mockStatus: InflightBundleStatus = {
          bundle_id: bundleId,
          status: isLanded ? 'Landed' : 'Failed',
          landed_slot: ((global as any).mockCurrentSlot || 245000100) + 1,
        };
        setTimeout(() => this.processStatus(mockStatus), 1000);
      }
      return;
    }

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getInflightBundleStatuses',
      params: [bundleIds],
    };

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) return;

      const data = (await response.json()) as JitoStatusResponse;
      if (!data.result?.value) return;

      for (const status of data.result.value) {
        this.processStatus(status);
      }
    } catch (error) {
      log.warn({ error: String(error) }, 'failed to poll bundle statuses');
    }
  }

  private processStatus(status: InflightBundleStatus): void {
    const record = this.trackedBundles.get(status.bundle_id);
    if (!record) return;

    if (status.status === 'Landed') {
      record.status = BundleStatus.LANDED;
      record.landedAt = Date.now();
      record.slot = status.landed_slot;
      
      tipManager.recordOutcome(record.tipLamports, true);
      eventBus.emit(EVENTS.BUNDLE_LANDED, record);
      
      // Update bundle in database in background
      prisma.bundle
        .update({
          where: { id: record.id },
          data: {
            status: BundleStatus.LANDED,
            landedAt: new Date(record.landedAt),
            slot: record.slot,
          },
        })
        .catch((err) =>
          log.error({ err: err.message }, 'failed to update bundle landed in database')
        );

      this.trackedBundles.delete(status.bundle_id);
      
      log.info(
        { bundleId: status.bundle_id, slot: status.landed_slot, tip: record.tipLamports }, 
        'bundle landed successfully'
      );
    } else if (status.status === 'Failed') {
      record.status = BundleStatus.DROPPED;
      record.rejectedAt = Date.now();
      
      tipManager.recordOutcome(record.tipLamports, false);
      eventBus.emit(EVENTS.BUNDLE_DROPPED, record);

      // Update bundle in database in background
      prisma.bundle
        .update({
          where: { id: record.id },
          data: {
            status: BundleStatus.DROPPED,
            rejectedAt: new Date(record.rejectedAt),
          },
        })
        .catch((err) =>
          log.error({ err: err.message }, 'failed to update bundle dropped in database')
        );
      
      this.trackedBundles.delete(status.bundle_id);
      
      log.warn(
        { bundleId: status.bundle_id, tip: record.tipLamports }, 
        'bundle failed/dropped'
      );
    }
    
    // For 'Pending', do nothing, wait for next poll
  }
}

export const bundleTracker = new BundleTracker();
