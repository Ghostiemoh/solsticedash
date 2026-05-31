// ============================================================
// Lifecycle Tracker
// ============================================================
// Central tracker for transaction lifecycles. Each transaction
// gets a TransactionLifecycle record with timestamps for every
// state transition. Publishes all transitions to the event bus.
// ============================================================

import {
  TransactionStatus,
  type TransactionLifecycle,
  EVENTS,
  generateId,
} from '@solstice/shared';
import { LifecycleStateMachine } from './state-machine.js';
import { eventBus } from '../events/event-bus.js';
import { createChildLogger } from '../telemetry/logger.js';
import { lifecycleDurationHistogram, transactionStatusGauge } from '../telemetry/metrics.js';

import { prisma } from '../db/prisma-client.js';

const log = createChildLogger('lifecycle-tracker');

interface TrackedTransaction {
  lifecycle: TransactionLifecycle;
  stateMachine: LifecycleStateMachine;
}

export class LifecycleTracker {
  private tracked = new Map<string, TrackedTransaction>();

  constructor() {
    this.loadFromDb().catch((err) =>
      log.error({ err: err.message }, 'failed to load transactions from DB')
    );
  }

  private async loadFromDb(): Promise<void> {
    try {
      const txs = await prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      for (const tx of txs) {
        const lifecycle: TransactionLifecycle = {
          id: tx.id,
          signature: tx.signature,
          status: tx.status as TransactionStatus,
          createdAt: tx.createdAt.getTime(),
          simulatedAt: tx.simulatedAt?.getTime() ?? null,
          signedAt: tx.signedAt?.getTime() ?? null,
          bundledAt: tx.bundledAt?.getTime() ?? null,
          submittedAt: tx.submittedAt?.getTime() ?? null,
          processedAt: tx.processedAt?.getTime() ?? null,
          confirmedAt: tx.confirmedAt?.getTime() ?? null,
          finalizedAt: tx.finalizedAt?.getTime() ?? null,
          failedAt: tx.failedAt?.getTime() ?? null,
          abandonedAt: tx.abandonedAt?.getTime() ?? null,
          slot: tx.slot,
          leader: tx.leader,
          bundleId: tx.bundleId,
          tipLamports: tx.tipLamports,
          computeUnitsConsumed: tx.computeUnitsConsumed,
          computeUnitLimit: tx.computeUnitLimit,
          computeUnitPrice: tx.computeUnitPrice,
          retryCount: tx.retryCount,
          lastError: tx.lastError,
          failureCategory: tx.failureCategory as any,
          metadata: tx.metadata ? (tx.metadata as any) : undefined,
          aiDecision: null,
        };

        // Load corresponding AI Decision if exists
        const aiDec = await prisma.aiDecision.findFirst({
          where: { transactionId: tx.id },
          orderBy: { timestamp: 'desc' },
        });

        if (aiDec) {
          lifecycle.aiDecision = {
            id: aiDec.id,
            transactionId: aiDec.transactionId,
            context: JSON.parse(aiDec.context as string),
            decision: JSON.parse(aiDec.decision as string),
            timestamp: aiDec.timestamp.getTime(),
            modelUsed: aiDec.modelUsed,
            latencyMs: aiDec.latencyMs,
            wasOverridden: aiDec.wasOverridden,
            overrideReason: aiDec.overrideReason,
            outcome: aiDec.outcome as any,
          };
        }

        const stateMachine = new LifecycleStateMachine(lifecycle.status);
        this.tracked.set(tx.id, { lifecycle, stateMachine });
      }
      this.updateStatusCounts();
      log.info(
        { count: this.tracked.size },
        'successfully loaded previous transactions from database'
      );
    } catch (error: any) {
      log.error({ error: error.message }, 'failed to load transactions from DB');
    }
  }

  /**
   * Create a new transaction lifecycle and start tracking it.
   */
  create(metadata?: Record<string, unknown>): TransactionLifecycle {
    const id = generateId('txn');
    const now = Date.now();

    const lifecycle: TransactionLifecycle = {
      id,
      signature: null,
      status: TransactionStatus.CREATED,
      createdAt: now,
      simulatedAt: null,
      signedAt: null,
      bundledAt: null,
      submittedAt: null,
      processedAt: null,
      confirmedAt: null,
      finalizedAt: null,
      failedAt: null,
      abandonedAt: null,
      slot: null,
      leader: null,
      bundleId: null,
      tipLamports: null,
      computeUnitsConsumed: null,
      computeUnitLimit: null,
      computeUnitPrice: null,
      retryCount: 0,
      lastError: null,
      failureCategory: null,
      metadata,
    };

    const stateMachine = new LifecycleStateMachine(TransactionStatus.CREATED);

    this.tracked.set(id, { lifecycle, stateMachine });
    this.updateStatusCounts();

    eventBus.emit(EVENTS.TX_CREATED, lifecycle);

    // Save to DB in background
    prisma.transaction
      .create({
        data: {
          id,
          status: TransactionStatus.CREATED,
          createdAt: new Date(now),
          metadata: metadata ? (metadata as any) : undefined,
        },
      })
      .catch((err) =>
        log.error({ err: err.message }, 'failed to save new transaction to database')
      );

    log.debug({ transactionId: id }, 'lifecycle created');

    return lifecycle;
  }

  /**
   * Transition a transaction to a new state.
   */
  transition(
    transactionId: string,
    newStatus: TransactionStatus,
    updates: Partial<TransactionLifecycle> = {}
  ): TransactionLifecycle {
    const entry = this.tracked.get(transactionId);
    if (!entry) {
      throw new Error(`Transaction ${transactionId} not tracked`);
    }

    // Validate the transition via state machine
    entry.stateMachine.transition(newStatus);

    // Apply timestamp for the new status
    const now = Date.now();
    const timestampField = this.getTimestampField(newStatus);

    const updatedLifecycle: TransactionLifecycle = {
      ...entry.lifecycle,
      ...updates,
      status: newStatus,
      ...(timestampField ? { [timestampField]: now } : {}),
    };

    entry.lifecycle = updatedLifecycle;
    this.updateStatusCounts();

    // Emit the appropriate event
    const eventName = this.getEventName(newStatus);
    if (eventName) {
      (eventBus as any).emit(eventName, updatedLifecycle);
    }

    // Track lifecycle duration for terminal states
    if (
      newStatus === TransactionStatus.FINALIZED ||
      newStatus === TransactionStatus.ABANDONED
    ) {
      const durationSec = (now - updatedLifecycle.createdAt) / 1000;
      lifecycleDurationHistogram.labels(newStatus).observe(durationSec);
    }

    // Update in database in background
    prisma.transaction
      .update({
        where: { id: transactionId },
        data: {
          status: newStatus,
          signature: updatedLifecycle.signature,
          slot: updatedLifecycle.slot,
          leader: updatedLifecycle.leader,
          bundleId: updatedLifecycle.bundleId,
          tipLamports: updatedLifecycle.tipLamports,
          computeUnitsConsumed: updatedLifecycle.computeUnitsConsumed,
          computeUnitLimit: updatedLifecycle.computeUnitLimit,
          computeUnitPrice: updatedLifecycle.computeUnitPrice,
          retryCount: updatedLifecycle.retryCount,
          lastError: updatedLifecycle.lastError,
          failureCategory: updatedLifecycle.failureCategory,
          simulatedAt: updatedLifecycle.simulatedAt ? new Date(updatedLifecycle.simulatedAt) : null,
          signedAt: updatedLifecycle.signedAt ? new Date(updatedLifecycle.signedAt) : null,
          bundledAt: updatedLifecycle.bundledAt ? new Date(updatedLifecycle.bundledAt) : null,
          submittedAt: updatedLifecycle.submittedAt ? new Date(updatedLifecycle.submittedAt) : null,
          processedAt: updatedLifecycle.processedAt ? new Date(updatedLifecycle.processedAt) : null,
          confirmedAt: updatedLifecycle.confirmedAt ? new Date(updatedLifecycle.confirmedAt) : null,
          finalizedAt: updatedLifecycle.finalizedAt ? new Date(updatedLifecycle.finalizedAt) : null,
          failedAt: updatedLifecycle.failedAt ? new Date(updatedLifecycle.failedAt) : null,
          abandonedAt: updatedLifecycle.abandonedAt ? new Date(updatedLifecycle.abandonedAt) : null,
          metadata: updatedLifecycle.metadata ? (updatedLifecycle.metadata as any) : undefined,
        },
      })
      .catch((err) =>
        log.error({ err: err.message }, 'failed to update transaction in database')
      );

    log.debug(
      { transactionId, from: entry.lifecycle.status, to: newStatus },
      'lifecycle transition'
    );

    return updatedLifecycle;
  }

  get(transactionId: string): TransactionLifecycle | undefined {
    return this.tracked.get(transactionId)?.lifecycle;
  }

  getAll(): TransactionLifecycle[] {
    return Array.from(this.tracked.values()).map((t) => t.lifecycle);
  }

  getByStatus(status: TransactionStatus): TransactionLifecycle[] {
    return this.getAll().filter((t) => t.status === status);
  }

  remove(transactionId: string): void {
    this.tracked.delete(transactionId);
    this.updateStatusCounts();
  }

  private getTimestampField(status: TransactionStatus): string | null {
    const map: Partial<Record<TransactionStatus, string>> = {
      [TransactionStatus.SIMULATED]: 'simulatedAt',
      [TransactionStatus.SIGNED]: 'signedAt',
      [TransactionStatus.BUNDLED]: 'bundledAt',
      [TransactionStatus.SUBMITTED]: 'submittedAt',
      [TransactionStatus.PROCESSED]: 'processedAt',
      [TransactionStatus.CONFIRMED]: 'confirmedAt',
      [TransactionStatus.FINALIZED]: 'finalizedAt',
      [TransactionStatus.FAILED]: 'failedAt',
      [TransactionStatus.ABANDONED]: 'abandonedAt',
    };
    return map[status] ?? null;
  }

  private getEventName(status: TransactionStatus): string | null {
    const map: Partial<Record<TransactionStatus, string>> = {
      [TransactionStatus.CREATED]: EVENTS.TX_CREATED,
      [TransactionStatus.SIMULATED]: EVENTS.TX_SIMULATED,
      [TransactionStatus.SIGNED]: EVENTS.TX_SIGNED,
      [TransactionStatus.SUBMITTED]: EVENTS.TX_SUBMITTED,
      [TransactionStatus.PROCESSED]: EVENTS.TX_PROCESSED,
      [TransactionStatus.CONFIRMED]: EVENTS.TX_CONFIRMED,
      [TransactionStatus.FINALIZED]: EVENTS.TX_FINALIZED,
      [TransactionStatus.FAILED]: EVENTS.TX_FAILED,
      [TransactionStatus.RETRYING]: EVENTS.TX_RETRYING,
      [TransactionStatus.ABANDONED]: EVENTS.TX_ABANDONED,
    };
    return map[status] ?? null;
  }

  private updateStatusCounts(): void {
    const counts = new Map<string, number>();
    for (const entry of this.tracked.values()) {
      const status = entry.lifecycle.status;
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    for (const [status, count] of counts) {
      transactionStatusGauge.labels(status).set(count);
    }
  }
}

export const lifecycleTracker = new LifecycleTracker();
