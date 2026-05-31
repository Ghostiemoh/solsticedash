// ============================================================
// Failure Classifier
// ============================================================
// Classifies transaction/bundle failures into actionable
// categories. Each category maps to a specific retry strategy.
// This is the brain of the retry engine's decision-making.
// ============================================================

import { FailureCategory } from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('failure-classifier');

export interface ClassifiedFailure {
  category: FailureCategory;
  isRetryable: boolean;
  suggestedAction: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  rawError: string;
}

export class FailureClassifier {
  /**
   * Classify a failure from its error message or code.
   */
  classify(error: string, context?: { slot?: number; leader?: string }): ClassifiedFailure {
    const normalizedError = error.toLowerCase();

    // ─── Blockhash Expired ────────────────────────────────
    if (
      normalizedError.includes('blockhash not found') ||
      normalizedError.includes('blockhash expired') ||
      normalizedError.includes('block height exceeded')
    ) {
      return {
        category: FailureCategory.BLOCKHASH_EXPIRED,
        isRetryable: true,
        suggestedAction: 'Rebuild transaction with fresh blockhash and resubmit',
        severity: 'medium',
        rawError: error,
      };
    }

    // ─── Bundle Dropped / Low Tip ────────────────────────
    if (
      normalizedError.includes('bundle dropped') ||
      normalizedError.includes('bundle not accepted') ||
      normalizedError.includes('tip too low') ||
      normalizedError.includes('auction lost')
    ) {
      return {
        category: FailureCategory.BUNDLE_DROPPED,
        isRetryable: true,
        suggestedAction: 'Increase tip amount and resubmit bundle',
        severity: 'medium',
        rawError: error,
      };
    }

    // ─── Compute Exhaustion ──────────────────────────────
    if (
      normalizedError.includes('computational budget exceeded') ||
      normalizedError.includes('compute budget exceeded') ||
      normalizedError.includes('exceeded compute unit limit')
    ) {
      return {
        category: FailureCategory.COMPUTE_EXHAUSTED,
        isRetryable: true,
        suggestedAction: 'Increase compute unit limit based on simulation results',
        severity: 'medium',
        rawError: error,
      };
    }

    // ─── Simulation Failure (Program Error) ──────────────
    if (
      normalizedError.includes('simulation failed') ||
      normalizedError.includes('instructionerror') ||
      normalizedError.includes('program error') ||
      normalizedError.includes('custom program error')
    ) {
      return {
        category: FailureCategory.SIMULATION_FAILED,
        isRetryable: false,
        suggestedAction: 'Analyze program error — may need transaction reconstruction',
        severity: 'high',
        rawError: error,
      };
    }

    // ─── Account Contention ──────────────────────────────
    if (
      normalizedError.includes('account in use') ||
      normalizedError.includes('write lock') ||
      normalizedError.includes('already borrowed') ||
      normalizedError.includes('account locked')
    ) {
      return {
        category: FailureCategory.ACCOUNT_CONTENTION,
        isRetryable: true,
        suggestedAction: 'Delay retry — account is locked by another transaction',
        severity: 'medium',
        rawError: error,
      };
    }

    // ─── Congestion ──────────────────────────────────────
    if (
      normalizedError.includes('too many requests') ||
      normalizedError.includes('429') ||
      normalizedError.includes('rate limit') ||
      normalizedError.includes('node is behind')
    ) {
      return {
        category: FailureCategory.CONGESTION,
        isRetryable: true,
        suggestedAction: 'Wait for congestion to clear, increase priority fee',
        severity: 'high',
        rawError: error,
      };
    }

    // ─── RPC Failure ─────────────────────────────────────
    if (
      normalizedError.includes('503') ||
      normalizedError.includes('502') ||
      normalizedError.includes('econnrefused') ||
      normalizedError.includes('econnreset') ||
      normalizedError.includes('etimedout') ||
      normalizedError.includes('fetch failed') ||
      normalizedError.includes('network error')
    ) {
      return {
        category: FailureCategory.RPC_FAILURE,
        isRetryable: true,
        suggestedAction: 'Failover to backup RPC endpoint',
        severity: 'high',
        rawError: error,
      };
    }

    // ─── Leader Miss ─────────────────────────────────────
    if (
      normalizedError.includes('leader') ||
      normalizedError.includes('slot skipped') ||
      normalizedError.includes('not the leader')
    ) {
      return {
        category: FailureCategory.LEADER_MISS,
        isRetryable: true,
        suggestedAction: 'Wait for next leader slot and resubmit',
        severity: 'low',
        rawError: error,
      };
    }

    // ─── Slot Timing ─────────────────────────────────────
    if (
      normalizedError.includes('slot') &&
      (normalizedError.includes('expired') || normalizedError.includes('past'))
    ) {
      return {
        category: FailureCategory.SLOT_TIMING,
        isRetryable: true,
        suggestedAction: 'Rebuild and resubmit with fresh timing',
        severity: 'low',
        rawError: error,
      };
    }

    // ─── Unknown ─────────────────────────────────────────
    log.warn({ error, context }, 'unclassified failure');

    return {
      category: FailureCategory.UNKNOWN,
      isRetryable: true,
      suggestedAction: 'Consult AI decision engine for analysis',
      severity: 'medium',
      rawError: error,
    };
  }
}

export const failureClassifier = new FailureClassifier();
