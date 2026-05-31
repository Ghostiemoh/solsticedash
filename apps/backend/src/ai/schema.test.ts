import { describe, it, expect } from 'vitest';
import {
  AiDecisionResponseSchema,
  validateAiDecision,
  type AiDecisionResponseType,
} from './schema.js';

function validDecision(
  overrides: Partial<AiDecisionResponseType> = {},
): AiDecisionResponseType {
  return {
    shouldRetry: true,
    newTipLamports: 15_000,
    delayMs: 500,
    splitBundle: false,
    waitForJitoLeader: true,
    abandonTransaction: false,
    adjustComputeUnits: null,
    rebroadcast: false,
    confidence: 0.8,
    reasoning: 'Bundle dropped, bumping tip and waiting for the next Jito leader.',
    ...overrides,
  };
}

describe('AiDecisionResponseSchema', () => {
  it('accepts a well-formed decision', () => {
    expect(AiDecisionResponseSchema.safeParse(validDecision()).success).toBe(true);
  });

  it('rejects reasoning that is too short', () => {
    const result = AiDecisionResponseSchema.safeParse(validDecision({ reasoning: 'no' }));
    expect(result.success).toBe(false);
  });

  it('rejects a confidence outside 0..1', () => {
    expect(
      AiDecisionResponseSchema.safeParse(validDecision({ confidence: 1.5 })).success,
    ).toBe(false);
  });
});

describe('validateAiDecision (safeguards)', () => {
  it('passes a sane decision', () => {
    const { valid } = validateAiDecision(validDecision(), 10_000, 0, 5);
    expect(valid).toBe(true);
  });

  it('rejects low-confidence decisions', () => {
    const { valid } = validateAiDecision(
      validDecision({ confidence: 0.1 }),
      10_000,
      0,
      5,
    );
    expect(valid).toBe(false);
  });

  it('rejects tip increases beyond the 2x cap', () => {
    const { valid } = validateAiDecision(
      validDecision({ newTipLamports: 30_000 }),
      10_000,
      0,
      5,
    );
    expect(valid).toBe(false);
  });

  it('rejects retrying past the max retry count', () => {
    const { valid } = validateAiDecision(
      validDecision({ shouldRetry: true }),
      10_000,
      5,
      5,
    );
    expect(valid).toBe(false);
  });

  it('rejects a contradictory retry-and-abandon decision', () => {
    const { valid } = validateAiDecision(
      validDecision({ shouldRetry: true, abandonTransaction: true }),
      10_000,
      0,
      5,
    );
    expect(valid).toBe(false);
  });
});
