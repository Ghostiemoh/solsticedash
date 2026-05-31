// ============================================================
// Solstice Orchestrator
// ============================================================
// Wires all the modules together into a cohesive system.
// Listens to the event bus and coordinates the transaction
// lifecycle, from submission through simulation, bundling,
// dropping, retrying via AI, and finalization.
// ============================================================

import {
  type VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  TransactionStatus,
  BundleStatus,
  EVENTS,
  type TransactionLifecycle,
  type BundleRecord,
  type AiDecisionRecord,
} from '@solstice/shared';
import { eventBus } from './events/event-bus.js';
import { createChildLogger } from './telemetry/logger.js';
import { transactionBuilder } from './solana/transaction-builder.js';
import { simulationEngine } from './solana/simulation-engine.js';
import { priorityFeeManager } from './solana/priority-fee-manager.js';
import { rpcManager } from './solana/rpc-manager.js';
import { confirmationPoller } from './solana/confirmation-poller.js';
import { lifecycleTracker } from './lifecycle/lifecycle-tracker.js';
import { bundleConstructor } from './jito/bundle-constructor.js';
import { bundleSender } from './jito/bundle-sender.js';
import { bundleTracker } from './jito/bundle-tracker.js';
import { tipManager } from './jito/tip-manager.js';
import { dropAnalyzer } from './jito/drop-analyzer.js';
import { retryPlanner, type RetryPlan } from './retry/retry-planner.js';
import { slotTracker } from './streaming/slot-tracker.js';
import { leaderSchedule } from './leader/leader-schedule.js';
import { executionWindow } from './leader/execution-window.js';
import { aiDecisionEngine } from './ai/decision-engine.js';
import { auditDecision } from './ai/validator.js';
import { retryQueue } from './queue/queues.js';
import { prisma } from './db/prisma-client.js';

const log = createChildLogger('orchestrator');

export class Orchestrator {
  private activeDecisions = new Map<string, AiDecisionRecord>();
  private instructionsMap = new Map<string, TransactionInstruction[]>();

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Submit a new set of instructions for processing.
   */
  async submitInstructions(
    instructions: TransactionInstruction[],
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const lifecycle = lifecycleTracker.create(metadata);
    log.info({ transactionId: lifecycle.id }, 'new transaction accepted');

    // Store instructions for potential retries
    this.instructionsMap.set(lifecycle.id, instructions);

    // Kick off the processing pipeline asynchronously
    this.processTransaction(lifecycle, instructions).catch((error) => {
      log.error({ transactionId: lifecycle.id, error: String(error) }, 'fatal processing error');
      lifecycleTracker.transition(lifecycle.id, TransactionStatus.FAILED, {
        lastError: String(error),
      });
    });

    return lifecycle.id;
  }

  /**
   * Execute a transaction retry. Called by BullMQ queue worker.
   * The full retry plan (tip, compute, leader-wait, split, rebroadcast)
   * is threaded into the pipeline rather than only the tip override.
   */
  async retryTransaction(transactionId: string, retryPlan: RetryPlan): Promise<void> {
    const lifecycle = lifecycleTracker.get(transactionId);
    if (!lifecycle) {
      log.error({ transactionId }, 'retry failed: transaction not found in tracker');
      return;
    }

    const instructions = this.instructionsMap.get(transactionId);
    if (!instructions) {
      log.error({ transactionId }, 'retry failed: original instructions not found');
      return;
    }

    log.info(
      {
        transactionId,
        attempt: lifecycle.retryCount,
        source: retryPlan.source,
        waitForJitoLeader: retryPlan.waitForJitoLeader,
        splitBundle: retryPlan.splitBundle,
        rebroadcast: retryPlan.rebroadcast,
      },
      'executing transaction retry with full plan',
    );

    this.processTransaction(lifecycle, instructions, retryPlan).catch((error) => {
      log.error({ transactionId, error: String(error) }, 'retry processing error');
      lifecycleTracker.transition(transactionId, TransactionStatus.FAILED, {
        lastError: String(error),
      });
    });
  }

  private async processTransaction(
    lifecycle: TransactionLifecycle,
    instructions: TransactionInstruction[],
    retryPlan?: RetryPlan,
  ): Promise<void> {
    try {
      const overrideTipLamports = retryPlan?.newTipLamports ?? undefined;

      // A split-bundle directive is acknowledged deterministically: the current
      // pipeline submits a single-transaction bundle, so there is nothing to
      // split. We log it for evidence rather than silently dropping the signal.
      if (retryPlan?.splitBundle) {
        log.info(
          { transactionId: lifecycle.id },
          'AI requested splitBundle — single-tx bundle, proceeding as one bundle',
        );
      }

      // 1. Estimate base priority fee
      const recommendedFee = priorityFeeManager.getRecommendedFee();

      // 2. Build Transaction
      const useExpired = lifecycle.metadata?.['forceExpiredBlockhash'] && lifecycle.retryCount === 0;
      const buildResult = await transactionBuilder.build({
        instructions,
        computeUnitPrice: recommendedFee,
        recentBlockhash: useExpired ? '11111111111111111111111111111111' : undefined,
      });
      const tx = buildResult.transaction;
      lifecycleTracker.transition(lifecycle.id, TransactionStatus.SIMULATED);

      // 3. Simulate
      const simResult = await simulationEngine.simulate(tx);
      if (simResult.error) {
        throw new Error(`Simulation failed: ${simResult.error}`);
      }
      
      // 4. Build Jito Bundle
      const tipAmount = overrideTipLamports ?? tipManager.getRecommendedTip();
      const tipAccount = bundleConstructor.getRandomTipAccount();
      const tipInstruction = bundleConstructor.createTipInstruction(tipAmount, tipAccount);

      // Honor an AI/fallback compute-unit override (e.g. COMPUTE_EXHAUSTED),
      // otherwise size the limit from simulated consumption plus headroom.
      const computeUnitLimit =
        retryPlan?.adjustComputeUnits ?? (simResult.computeUnitsConsumed ?? 200000) + 150;

      // We append the tip instruction to the standard instructions
      const finalInstructions = [...instructions, tipInstruction];
      const finalBuild = await transactionBuilder.build({
        instructions: finalInstructions,
        computeUnitPrice: recommendedFee,
        computeUnitLimit,
      });
      const finalTx = finalBuild.transaction;
      
      // Sign it
      finalTx.sign([await import('./solana/wallet-manager.js').then(m => m.walletManager.getKeypair())]);
      lifecycleTracker.transition(lifecycle.id, TransactionStatus.SIGNED);

      // Create bundle record
      const bundleRecord = bundleConstructor.createRecord([finalTx], tipAmount, tipAccount);
      
      // Save bundle to database in background
      prisma.bundle
        .create({
          data: {
            id: bundleRecord.id,
            jitoBundleId: bundleRecord.bundleId,
            status: bundleRecord.status,
            tipLamports: bundleRecord.tipLamports,
            tipAccount: bundleRecord.tipAccount,
            leader: bundleRecord.leader,
            slot: bundleRecord.slot,
            sentAt: new Date(bundleRecord.sentAt),
          },
        })
        .catch((err) =>
          log.error({ err: err.message }, 'failed to save bundle to database')
        );

      lifecycleTracker.transition(lifecycle.id, TransactionStatus.BUNDLED, {
        bundleId: bundleRecord.id,
        tipLamports: tipAmount,
      });

      // 6. Wait for optimal execution window. A retry plan that asks to wait
      // for the next Jito leader (leader-miss / bundle-drop recovery) forces
      // the scheduler to hold until that validator's slot window.
      await this.waitForOptimalWindow(retryPlan?.waitForJitoLeader ?? false);

      // 7. Send Bundle
      let jitoId: string;
      let signature = bs58.encode(finalTx.signatures[0]!);
      try {
        jitoId = await bundleSender.sendBundle([finalTx], bundleRecord.id);
        bundleRecord.bundleId = jitoId;
        
        // Update bundle in database
        prisma.bundle
          .update({
            where: { id: bundleRecord.id },
            data: {
              jitoBundleId: jitoId,
              status: BundleStatus.SENT,
            },
          })
          .catch((err) =>
            log.error({ err: err.message }, 'failed to update bundle status in database')
          );

        bundleTracker.track(bundleRecord);
        eventBus.emit(EVENTS.BUNDLE_SENT, bundleRecord);

        // Honor a rebroadcast directive (e.g. RPC_FAILURE recovery): in addition
        // to the Jito bundle, push the signed tx straight to the RPC cluster so
        // it can land via the regular mempool if the bundle is dropped.
        if (retryPlan?.rebroadcast) {
          try {
            const conn = rpcManager.getConnection();
            await conn.sendRawTransaction(finalTx.serialize(), {
              skipPreflight: true,
              preflightCommitment: 'processed',
            });
            log.info({ transactionId: lifecycle.id }, 'rebroadcast signed tx via direct RPC alongside Jito bundle');
          } catch (rebroadcastError) {
            log.warn(
              { transactionId: lifecycle.id, error: String(rebroadcastError) },
              'rebroadcast via direct RPC failed (bundle still in flight)',
            );
          }
        }
      } catch (jitoError) {
        log.warn(
          { transactionId: lifecycle.id, error: String(jitoError) },
          'Jito bundle submission failed. Falling back to direct RPC transaction submission.'
        );
        // Rebuild transaction without Jito tip instruction
        const fallbackBuild = await transactionBuilder.build({
          instructions: instructions,
          computeUnitPrice: recommendedFee,
          computeUnitLimit,
          recentBlockhash: useExpired ? '11111111111111111111111111111111' : undefined,
        });
        const fallbackTx = fallbackBuild.transaction;
        
        // Sign fallback transaction
        fallbackTx.sign([await import('./solana/wallet-manager.js').then(m => m.walletManager.getKeypair())]);
        
        // Send fallback transaction directly to the RPC cluster
        const connection = rpcManager.getConnection();
        const txSig = await connection.sendRawTransaction(fallbackTx.serialize(), {
          skipPreflight: true,
          preflightCommitment: 'processed',
        });
        log.info({ transactionId: lifecycle.id, signature: txSig }, 'Transaction submitted directly to Solana RPC cluster');
        
        signature = txSig;
        jitoId = `rpc_fallback_${txSig.slice(0, 10)}`;
        bundleRecord.bundleId = jitoId;

        // Update fallback bundle in database
        prisma.bundle
          .update({
            where: { id: bundleRecord.id },
            data: {
              jitoBundleId: jitoId,
            },
          })
          .catch((err) =>
            log.error({ err: err.message }, 'failed to update fallback bundle in database')
          );
      }
      
      lifecycleTracker.transition(lifecycle.id, TransactionStatus.SUBMITTED, {
        signature,
        slot: slotTracker.getCurrentSlot(),
        leader: leaderSchedule.getLeaderForSlot(slotTracker.getCurrentSlot()),
      });

      // 8. Poll for confirmation via standard RPC fallback (in case bundle tracker misses)
      const maxSlot = slotTracker.getCurrentSlot() ? slotTracker.getCurrentSlot() + 150 : 0;
      confirmationPoller.track(
        signature,
        lifecycle.id,
        lifecycle,
        maxSlot
      );

    } catch (error) {
      log.warn({ transactionId: lifecycle.id, error: String(error) }, 'transaction pipeline failed');
      lifecycleTracker.transition(lifecycle.id, TransactionStatus.FAILED, {
        lastError: String(error),
      });
    }
  }

  private async waitForOptimalWindow(forceJitoWait = false): Promise<void> {
    const currentSlot = slotTracker.getCurrentSlot();
    const analysis = executionWindow.analyze(currentSlot, 'MODERATE' as any, true);

    const shouldWait =
      analysis.recommendedAction === 'wait_for_jito' ||
      analysis.recommendedAction === 'delay_congestion' ||
      // A forced Jito wait holds until the next Jito leader window even when the
      // generic window score is otherwise acceptable.
      (forceJitoWait && analysis.estimatedDelayMs > 0);

    if (shouldWait && analysis.estimatedDelayMs > 0) {
      log.debug(
        { delayMs: analysis.estimatedDelayMs, reason: forceJitoWait ? 'forced_jito_wait' : analysis.recommendedAction },
        'delaying for optimal window',
      );
      await new Promise((resolve) => setTimeout(resolve, analysis.estimatedDelayMs));
    }
  }

  private setupEventListeners(): void {
    // Listen for finalized transactions to audit active decisions
    eventBus.on(EVENTS.TX_FINALIZED, (tx: any) => {
      this.auditActiveDecision(tx.id, 'SUCCESS');
      this.instructionsMap.delete(tx.id);

      if (tx.bundleId) {
        prisma.bundle
          .update({
            where: { id: tx.bundleId },
            data: {
              status: BundleStatus.LANDED,
              landedAt: new Date(),
              slot: tx.slot,
            },
          })
          .catch((err) =>
            log.error({ err: err.message }, 'failed to mark bundle/execution record landed')
          );
      }
    });

    eventBus.on(EVENTS.TX_ABANDONED, (tx: any) => {
      this.auditActiveDecision(tx.id, 'ABANDONED');
      this.instructionsMap.delete(tx.id);
    });

    // Listen for bundle drops to trigger AI retry logic
    eventBus.on(EVENTS.BUNDLE_DROPPED, async (bundle) => {
      // Find the associated transaction
      const lifecycles = lifecycleTracker.getAll();
      const tx = lifecycles.find(l => l.bundleId === bundle.id);
      
      if (!tx) return;

      const analysis = await dropAnalyzer.analyzeDrop(bundle);
      
      lifecycleTracker.transition(tx.id, TransactionStatus.FAILED, {
        lastError: analysis.reason,
        failureCategory: analysis.probableCause,
      });
    });

    // Handle transaction failures via AI planner
    eventBus.on(EVENTS.TX_FAILED, async (tx) => {
      const plan = await retryPlanner.planRetry(
        tx.id,
        tx.lastError ?? 'Unknown error',
        tx.retryCount,
        {
          currentSlot: slotTracker.getCurrentSlot(),
          upcomingLeaders: leaderSchedule.getUpcomingLeaders(slotTracker.getCurrentSlot(), 12, new Set()), // Simplified
          congestionLevel: 'MODERATE' as any,
          recentFailures: [],
          retryHistory: [],
          bundlePerformance: tipManager.getPerformanceMetrics(),
          latencyMetrics: { rpcLatencyMs: 0, streamLatencyMs: 0, bundleSubmitLatencyMs: 0, simulationLatencyMs: 0, aiDecisionLatencyMs: 0 },
          currentTipLamports: tx.tipLamports ?? 0,
          transactionAge: Date.now() - tx.createdAt,
        }
      );

      if (plan.shouldRetry) {
        lifecycleTracker.transition(tx.id, TransactionStatus.RETRYING, {
          retryCount: tx.retryCount + 1,
        });
        
        await retryQueue.add('retry', {
          transactionId: tx.id,
          attempt: tx.retryCount + 1,
          retryPlan: plan,
        }, { delay: plan.delayMs });
        
      } else {
        lifecycleTracker.transition(tx.id, TransactionStatus.ABANDONED);
        this.auditActiveDecision(tx.id, 'ABANDONED');
      }
    });

    // Listen for AI decisions to track them
    eventBus.on(EVENTS.AI_DECISION_RECEIVED, (record) => {
      this.activeDecisions.set(record.transactionId, record);
    });
  }

  private auditActiveDecision(transactionId: string, outcome: 'SUCCESS' | 'FAILED_AGAIN' | 'ABANDONED'): void {
    const decision = this.activeDecisions.get(transactionId);
    if (decision) {
      auditDecision(decision, outcome);
      this.activeDecisions.delete(transactionId);

      // Update outcome in database in background
      prisma.aiDecision
        .updateMany({
          where: { transactionId, outcome: 'PENDING' },
          data: { outcome },
        })
        .catch((err) =>
          log.error({ err: err.message }, 'failed to update AI decision outcome in database')
        );
    }
  }
}

// Temporary polyfill for bs58 (needed locally in orchestrator until refactor)
import bs58 from 'bs58';

export const orchestrator = new Orchestrator();
