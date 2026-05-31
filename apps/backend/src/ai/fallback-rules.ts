// ============================================================
// Fallback Rules
// ============================================================
// Deterministic fallback when Gemini is unavailable, returns
// invalid output, or has low confidence. Ensures the system
// NEVER depends on AI availability for operation.
// ============================================================

import {
  FailureCategory,
  type AiDecisionResponse,
  type AiDecisionContext,
  CongestionLevel,
  MAX_RETRY_ATTEMPTS,
} from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('fallback-rules');

/**
 * Deterministic decision-making based on failure category and context.
 * No AI required — pure rule-based logic.
 */
export function applyFallbackRules(
  failureCategory: FailureCategory,
  context: AiDecisionContext,
): AiDecisionResponse {
  log.info(
    { failureCategory, retryCount: context.retryCount },
    'applying fallback rules',
  );

  // Check if we've exhausted retries
  if (context.retryCount >= MAX_RETRY_ATTEMPTS) {
    return createDecision({
      shouldRetry: false,
      abandonTransaction: true,
      reasoning: `Max retries exhausted (${MAX_RETRY_ATTEMPTS}). Abandoning transaction.`,
    });
  }

  switch (failureCategory) {
    case FailureCategory.BLOCKHASH_EXPIRED:
      return createDecision({
        shouldRetry: true,
        delayMs: 0,
        reasoning: 'Blockhash expired — rebuilding with fresh blockhash immediately.',
      });

    case FailureCategory.BUNDLE_DROPPED:
    case FailureCategory.LOW_TIP: {
      const tipMultiplier = context.congestionLevel === CongestionLevel.CRITICAL ? 1.8 : 1.3;
      const newTip = Math.round(context.currentTipLamports * tipMultiplier);
      return createDecision({
        shouldRetry: true,
        newTipLamports: newTip,
        waitForJitoLeader: true,
        delayMs: 500,
        reasoning: `Bundle dropped — increasing tip by ${Math.round((tipMultiplier - 1) * 100)}% to ${newTip} lamports and waiting for Jito leader.`,
      });
    }

    case FailureCategory.COMPUTE_EXHAUSTED:
      return createDecision({
        shouldRetry: true,
        adjustComputeUnits: 400_000,
        delayMs: 0,
        reasoning: 'Compute exhausted — increasing CU limit to 400,000.',
      });

    case FailureCategory.SIMULATION_FAILED:
      return createDecision({
        shouldRetry: false,
        abandonTransaction: true,
        reasoning: 'Simulation failure — program error, transaction is invalid. Abandoning.',
      });

    case FailureCategory.ACCOUNT_CONTENTION:
      return createDecision({
        shouldRetry: true,
        delayMs: 2000 * (context.retryCount + 1),
        reasoning: `Account contention — delaying ${2000 * (context.retryCount + 1)}ms to allow lock release.`,
      });

    case FailureCategory.CONGESTION: {
      const congestionDelay = getCongestionDelay(context.congestionLevel);
      const feeIncrease = context.congestionLevel === CongestionLevel.CRITICAL ? 1.5 : 1.2;
      return createDecision({
        shouldRetry: true,
        delayMs: congestionDelay,
        newTipLamports: Math.round(context.currentTipLamports * feeIncrease),
        reasoning: `Network congested (${context.congestionLevel}) — delaying ${congestionDelay}ms and increasing tip.`,
      });
    }

    case FailureCategory.RPC_FAILURE:
      return createDecision({
        shouldRetry: true,
        delayMs: 1000,
        rebroadcast: true,
        reasoning: 'RPC failure — retrying via failover endpoint in 1s.',
      });

    case FailureCategory.LEADER_MISS:
      return createDecision({
        shouldRetry: true,
        waitForJitoLeader: true,
        delayMs: 400,
        reasoning: 'Leader miss — waiting for next Jito leader slot.',
      });

    case FailureCategory.SLOT_TIMING:
      return createDecision({
        shouldRetry: true,
        delayMs: 200,
        reasoning: 'Slot timing issue — retrying with fresh timing.',
      });

    default:
      return createDecision({
        shouldRetry: true,
        delayMs: 1000 * (context.retryCount + 1),
        reasoning: `Unknown failure — generic retry with ${1000 * (context.retryCount + 1)}ms delay.`,
      });
  }
}

function getCongestionDelay(level: CongestionLevel): number {
  switch (level) {
    case CongestionLevel.LOW:
      return 500;
    case CongestionLevel.MODERATE:
      return 2000;
    case CongestionLevel.HIGH:
      return 5000;
    case CongestionLevel.CRITICAL:
      return 10_000;
  }
}

function createDecision(
  overrides: Partial<AiDecisionResponse>,
): AiDecisionResponse {
  return {
    shouldRetry: false,
    newTipLamports: null,
    delayMs: 0,
    splitBundle: false,
    waitForJitoLeader: false,
    abandonTransaction: false,
    adjustComputeUnits: null,
    rebroadcast: false,
    confidence: 1.0,
    reasoning: 'Fallback rule applied.',
    ...overrides,
  };
}
