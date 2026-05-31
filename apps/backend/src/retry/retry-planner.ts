// ============================================================
// Retry Planner
// ============================================================
// Decides retry strategy per failure. Consults the AI Decision
// Engine for complex cases. Applies backoff, respects limits.
// ============================================================

import {
  type FailureCategory,
  type AiDecisionContext,
  type AiDecisionResponse,
  MAX_RETRY_ATTEMPTS,
  calculateBackoffDelay,
  CongestionLevel,
  type BundlePerformanceMetrics,
  type LatencyMetrics,
  type FailureSummary,
  type RetryHistoryEntry,
  type LeaderInfo,
} from '@solstice/shared';
import { failureClassifier, type ClassifiedFailure } from './failure-classifier.js';
import { aiDecisionEngine } from '../ai/decision-engine.js';
import { applyFallbackRules } from '../ai/fallback-rules.js';
import { createChildLogger } from '../telemetry/logger.js';
import { retryCounter } from '../telemetry/metrics.js';

const log = createChildLogger('retry-planner');

export interface RetryPlan {
  shouldRetry: boolean;
  delayMs: number;
  newTipLamports: number | null;
  adjustComputeUnits: number | null;
  rebuildTransaction: boolean;
  waitForJitoLeader: boolean;
  splitBundle: boolean;
  rebroadcast: boolean;
  reasoning: string;
  source: 'ai' | 'fallback';
}

export class RetryPlanner {
  /**
   * Plan a retry strategy for a failed transaction.
   * Consults AI for complex cases, falls back to rules for simple ones.
   */
  async planRetry(
    transactionId: string,
    errorMessage: string,
    retryCount: number,
    context: {
      currentSlot: number;
      upcomingLeaders: LeaderInfo[];
      congestionLevel: CongestionLevel;
      recentFailures: FailureSummary[];
      retryHistory: RetryHistoryEntry[];
      bundlePerformance: BundlePerformanceMetrics;
      latencyMetrics: LatencyMetrics;
      currentTipLamports: number;
      transactionAge: number;
    },
  ): Promise<RetryPlan> {
    // Classify the failure first
    const classified = failureClassifier.classify(errorMessage);

    retryCounter.labels(classified.category).inc();

    // Check retry limits
    if (retryCount >= MAX_RETRY_ATTEMPTS) {
      log.info(
        { transactionId, retryCount },
        'max retries reached — abandoning',
      );
      return {
        shouldRetry: false,
        delayMs: 0,
        newTipLamports: null,
        adjustComputeUnits: null,
        rebuildTransaction: false,
        waitForJitoLeader: false,
        splitBundle: false,
        rebroadcast: false,
        reasoning: `Max retries (${MAX_RETRY_ATTEMPTS}) exhausted.`,
        source: 'fallback',
      };
    }

    // Non-retryable failures → abandon immediately
    if (!classified.isRetryable) {
      log.info(
        { transactionId, category: classified.category },
        'non-retryable failure — abandoning',
      );
      return {
        shouldRetry: false,
        delayMs: 0,
        newTipLamports: null,
        adjustComputeUnits: null,
        rebuildTransaction: false,
        waitForJitoLeader: false,
        splitBundle: false,
        rebroadcast: false,
        reasoning: `Non-retryable failure: ${classified.category}. ${classified.suggestedAction}`,
        source: 'fallback',
      };
    }

    // Build the AI context
    const aiContext: AiDecisionContext = {
      currentSlot: context.currentSlot,
      upcomingLeaders: context.upcomingLeaders,
      congestionLevel: context.congestionLevel,
      recentFailures: context.recentFailures,
      retryHistory: context.retryHistory,
      bundlePerformance: context.bundlePerformance,
      latencyMetrics: context.latencyMetrics,
      currentTipLamports: context.currentTipLamports,
      transactionAge: context.transactionAge,
      retryCount,
    };

    // Consult AI for complex decisions
    try {
      const aiRecord = await aiDecisionEngine.decide(
        transactionId,
        classified.category,
        aiContext,
      );
      return this.aiDecisionToRetryPlan(aiRecord.decision, classified, 'ai');
    } catch (error) {
      log.warn(
        { transactionId, error },
        'AI decision failed — using fallback rules',
      );
      const fallbackDecision = applyFallbackRules(classified.category, aiContext);
      return this.aiDecisionToRetryPlan(fallbackDecision, classified, 'fallback');
    }
  }

  private aiDecisionToRetryPlan(
    decision: AiDecisionResponse,
    classified: ClassifiedFailure,
    source: 'ai' | 'fallback',
  ): RetryPlan {
    return {
      shouldRetry: decision.shouldRetry,
      delayMs: decision.delayMs,
      newTipLamports: decision.newTipLamports,
      adjustComputeUnits: decision.adjustComputeUnits,
      rebuildTransaction: classified.category === 'BLOCKHASH_EXPIRED',
      waitForJitoLeader: decision.waitForJitoLeader,
      splitBundle: decision.splitBundle,
      rebroadcast: decision.rebroadcast,
      reasoning: decision.reasoning,
      source,
    };
  }
}

export const retryPlanner = new RetryPlanner();
