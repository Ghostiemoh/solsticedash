// ============================================================
// Confirmation Poller
// ============================================================
// Fallback confirmation mechanism when Yellowstone stream is
// unavailable or for extra reliability. Polls getSignatureStatuses
// with exponential backoff and emits lifecycle events.
// ============================================================

import { rpcManager } from './rpc-manager.js';
import { createChildLogger } from '../telemetry/logger.js';
import { eventBus } from '../events/event-bus.js';
import { EVENTS, calculateBackoffDelay, type TransactionLifecycle, TransactionStatus } from '@solstice/shared';
import { lifecycleTracker } from '../lifecycle/lifecycle-tracker.js';
import { leaderSchedule } from '../leader/leader-schedule.js';
import { failureClassifier } from '../retry/failure-classifier.js';

const log = createChildLogger('confirmation-poller');

interface PollTarget {
  signature: string;
  transactionId: string;
  lifecycle: TransactionLifecycle;
  startSlot: number;
  maxSlot: number;
  attempt: number;
  lastStatus: string | null;
}

export class ConfirmationPoller {
  private activePolls = new Map<string, PollTarget>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly POLL_INTERVAL_MS = 2_000;
  private readonly MAX_POLLS = 30;

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.pollAll().catch((err) => {
        log.error({ err }, 'poll cycle failed');
      });
    }, this.POLL_INTERVAL_MS);
    log.info('confirmation poller started');
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.activePolls.clear();
    log.info('confirmation poller stopped');
  }

  /**
   * Start tracking a signature for confirmation status updates.
   */
  track(
    signature: string,
    transactionId: string,
    lifecycle: TransactionLifecycle,
    maxSlot: number,
  ): void {
    this.activePolls.set(signature, {
      signature,
      transactionId,
      lifecycle,
      startSlot: lifecycle.slot ?? 0,
      maxSlot,
      attempt: 0,
      lastStatus: null,
    });

    log.debug(
      { signature: signature.slice(0, 12) + '...', transactionId },
      'tracking signature for confirmation',
    );
  }

  /**
   * Stop tracking a signature.
   */
  untrack(signature: string): void {
    this.activePolls.delete(signature);
  }

  private async pollAll(): Promise<void> {
    if (this.activePolls.size === 0) return;

    const signatures = Array.from(this.activePolls.keys());

    try {
      const statuses = await rpcManager.execute(
        'getSignatureStatuses',
        (conn) => conn.getSignatureStatuses(signatures, { searchTransactionHistory: true }),
      );

      for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        const status = statuses.value[i];
        const poll = sig ? this.activePolls.get(sig) : undefined;

        if (!poll || !sig) continue;

        poll.attempt++;

        if (!status) {
          // Not found yet — check if expired
          if (poll.attempt >= this.MAX_POLLS) {
            log.warn(
              { signature: sig.slice(0, 12) + '...' },
              'signature polling expired — likely dropped',
            );
            this.activePolls.delete(sig);

            const lastError = poll.lifecycle.metadata?.['forceExpiredBlockhash']
              ? 'Transaction expired: Blockhash not found (Simulated Fault)'
              : 'Transaction not found after polling — likely dropped';

            const classification = failureClassifier.classify(lastError);

            lifecycleTracker.transition(poll.transactionId, TransactionStatus.FAILED, {
              lastError,
              failureCategory: classification.category,
            });
          }
          continue;
        }

        // Check for errors
        if (status.err) {
          log.warn(
            { signature: sig.slice(0, 12) + '...', error: status.err },
            'transaction failed on-chain',
          );
          this.activePolls.delete(sig);

          const rawError = JSON.stringify(status.err);
          const classification = failureClassifier.classify(rawError);

          lifecycleTracker.transition(poll.transactionId, TransactionStatus.FAILED, {
            lastError: rawError,
            failureCategory: classification.category,
            slot: status.slot,
            leader: leaderSchedule.getLeaderForSlot(status.slot),
          });
          continue;
        }

        // Emit status transitions
        const commitment = status.confirmationStatus;
        const slot = status.slot;
        const leader = leaderSchedule.getLeaderForSlot(slot);

        if (commitment === 'processed' && poll.lastStatus !== 'processed') {
          poll.lastStatus = 'processed';
          poll.lifecycle = lifecycleTracker.transition(poll.transactionId, TransactionStatus.PROCESSED, { slot, leader });
        }

        if (commitment === 'confirmed' && poll.lastStatus !== 'confirmed') {
          if (poll.lastStatus !== 'processed') {
            poll.lifecycle = lifecycleTracker.transition(poll.transactionId, TransactionStatus.PROCESSED, { slot, leader });
          }
          poll.lastStatus = 'confirmed';
          poll.lifecycle = lifecycleTracker.transition(poll.transactionId, TransactionStatus.CONFIRMED, { slot, leader });
        }

        if (commitment === 'finalized') {
          if (poll.lastStatus !== 'processed' && poll.lastStatus !== 'confirmed') {
            poll.lifecycle = lifecycleTracker.transition(poll.transactionId, TransactionStatus.PROCESSED, { slot, leader });
            poll.lifecycle = lifecycleTracker.transition(poll.transactionId, TransactionStatus.CONFIRMED, { slot, leader });
          } else if (poll.lastStatus !== 'confirmed') {
            poll.lifecycle = lifecycleTracker.transition(poll.transactionId, TransactionStatus.CONFIRMED, { slot, leader });
          }

          poll.lastStatus = 'finalized';
          lifecycleTracker.transition(poll.transactionId, TransactionStatus.FINALIZED, { slot, leader });

          // Done tracking
          this.activePolls.delete(sig);
          log.info(
            { signature: sig.slice(0, 12) + '...', slot },
            'transaction finalized',
          );
        }
      }
    } catch (error) {
      log.warn({ error }, 'signature status poll failed');
    }
  }

  getActiveCount(): number {
    return this.activePolls.size;
  }
}

export const confirmationPoller = new ConfirmationPoller();
