// ============================================================
// AI Decision Validator
// ============================================================
// Validates Gemini outputs against deterministic safeguards
// and provides decision auditing.
// ============================================================

import type { AiDecisionRecord, AiDecisionResponse } from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('ai-validator');

/**
 * Audit an AI decision after outcome is known.
 * Updates the decision record with the actual outcome.
 */
export function auditDecision(
  record: AiDecisionRecord,
  outcome: 'SUCCESS' | 'FAILED_AGAIN' | 'ABANDONED',
): void {
  const wasCorrect =
    (record.decision.shouldRetry && outcome === 'SUCCESS') ||
    (record.decision.abandonTransaction && outcome === 'ABANDONED') ||
    (!record.decision.shouldRetry && outcome === 'ABANDONED');

  log.info(
    {
      decisionId: record.id,
      transactionId: record.transactionId,
      confidence: record.decision.confidence,
      outcome,
      wasCorrect,
      modelUsed: record.modelUsed,
    },
    'AI decision audited',
  );
}

/**
 * Score the quality of AI decisions over a time window.
 */
export function scoreDecisionQuality(
  decisions: AiDecisionRecord[],
): {
  total: number;
  correct: number;
  accuracy: number;
  avgConfidence: number;
  avgLatencyMs: number;
  fallbackRate: number;
} {
  if (decisions.length === 0) {
    return {
      total: 0,
      correct: 0,
      accuracy: 0,
      avgConfidence: 0,
      avgLatencyMs: 0,
      fallbackRate: 0,
    };
  }

  const withOutcomes = decisions.filter(
    (d) => d.outcome !== null && d.outcome !== 'PENDING',
  );

  const correct = withOutcomes.filter((d) => {
    if (d.decision.shouldRetry && d.outcome === 'SUCCESS') return true;
    if (d.decision.abandonTransaction && d.outcome === 'ABANDONED') return true;
    return false;
  });

  const fallbacks = decisions.filter((d) => d.wasOverridden);

  return {
    total: decisions.length,
    correct: correct.length,
    accuracy: withOutcomes.length > 0 ? correct.length / withOutcomes.length : 0,
    avgConfidence:
      decisions.reduce((a, b) => a + b.decision.confidence, 0) /
      decisions.length,
    avgLatencyMs:
      Math.round(
        decisions.reduce((a, b) => a + b.latencyMs, 0) / decisions.length,
      ),
    fallbackRate: fallbacks.length / decisions.length,
  };
}
