// ============================================================
// AI Decision Schema (Zod)
// ============================================================
// Defines the structured output schema for the AI decision engine.
// Gemini returns JSON matching this schema. Zod validates it.
// ============================================================

import { z } from 'zod';
import {
  AI_MIN_CONFIDENCE_THRESHOLD,
  AI_MAX_TIP_MULTIPLIER,
  AI_MAX_DELAY_MS,
} from '@solstice/shared';

export const AiDecisionResponseSchema = z.object({
  shouldRetry: z
    .boolean()
    .describe('Whether the transaction should be retried'),
  newTipLamports: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('New tip amount in lamports, or null to keep current'),
  delayMs: z
    .number()
    .int()
    .min(0)
    .max(AI_MAX_DELAY_MS)
    .describe('Milliseconds to delay before retry'),
  splitBundle: z
    .boolean()
    .describe('Whether to split the bundle into individual transactions'),
  waitForJitoLeader: z
    .boolean()
    .describe('Whether to wait for the next Jito-enabled leader'),
  abandonTransaction: z
    .boolean()
    .describe('Whether to permanently abandon this transaction'),
  adjustComputeUnits: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('New compute unit limit, or null to keep current'),
  rebroadcast: z
    .boolean()
    .describe('Whether to rebroadcast via standard RPC in addition to Jito'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence in this decision (0.0 to 1.0)'),
  reasoning: z
    .string()
    .min(10)
    .max(500)
    .describe('Human-readable explanation of the reasoning'),
});

export type AiDecisionResponseType = z.infer<typeof AiDecisionResponseSchema>;

/**
 * Validate an AI decision response against deterministic safeguards.
 * Returns null if the response is invalid (triggers fallback rules).
 */
export function validateAiDecision(
  decision: AiDecisionResponseType,
  currentTipLamports: number,
  retryCount: number,
  maxRetries: number,
): { valid: boolean; reason: string | null } {
  // Reject low-confidence decisions
  if (decision.confidence < AI_MIN_CONFIDENCE_THRESHOLD) {
    return {
      valid: false,
      reason: `Confidence ${decision.confidence} below threshold ${AI_MIN_CONFIDENCE_THRESHOLD}`,
    };
  }

  // Cap tip increases at 2x current
  if (
    decision.newTipLamports !== null &&
    decision.newTipLamports > currentTipLamports * AI_MAX_TIP_MULTIPLIER
  ) {
    return {
      valid: false,
      reason: `Tip increase ${decision.newTipLamports} exceeds ${AI_MAX_TIP_MULTIPLIER}x cap (${currentTipLamports * AI_MAX_TIP_MULTIPLIER})`,
    };
  }

  // Prevent infinite retry loops
  if (decision.shouldRetry && retryCount >= maxRetries) {
    return {
      valid: false,
      reason: `Cannot retry — already at max retries (${maxRetries})`,
    };
  }

  // Contradictory: can't both retry and abandon
  if (decision.shouldRetry && decision.abandonTransaction) {
    return {
      valid: false,
      reason: 'Contradictory: shouldRetry and abandonTransaction both true',
    };
  }

  return { valid: true, reason: null };
}
