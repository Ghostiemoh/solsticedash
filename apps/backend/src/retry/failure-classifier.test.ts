import { describe, it, expect } from 'vitest';
import { failureClassifier } from './failure-classifier.js';
import { FailureCategory } from '@solstice/shared';

describe('FailureClassifier', () => {
  it('classifies an expired blockhash as retryable BLOCKHASH_EXPIRED', () => {
    const result = failureClassifier.classify('Blockhash not found');
    expect(result.category).toBe(FailureCategory.BLOCKHASH_EXPIRED);
    expect(result.isRetryable).toBe(true);
  });

  it('classifies a dropped bundle / low tip as BUNDLE_DROPPED', () => {
    expect(failureClassifier.classify('bundle dropped').category).toBe(
      FailureCategory.BUNDLE_DROPPED,
    );
    expect(failureClassifier.classify('tip too low for auction').category).toBe(
      FailureCategory.BUNDLE_DROPPED,
    );
  });

  it('classifies compute exhaustion as COMPUTE_EXHAUSTED', () => {
    expect(
      failureClassifier.classify('Computational budget exceeded').category,
    ).toBe(FailureCategory.COMPUTE_EXHAUSTED);
  });

  it('treats program/simulation errors as non-retryable', () => {
    const result = failureClassifier.classify('custom program error: 0x1');
    expect(result.category).toBe(FailureCategory.SIMULATION_FAILED);
    expect(result.isRetryable).toBe(false);
  });

  it('classifies account contention', () => {
    expect(failureClassifier.classify('Account in use by another tx').category).toBe(
      FailureCategory.ACCOUNT_CONTENTION,
    );
  });

  it('classifies rate limiting as CONGESTION', () => {
    expect(failureClassifier.classify('429 rate limit exceeded').category).toBe(
      FailureCategory.CONGESTION,
    );
  });

  it('classifies transport failures as RPC_FAILURE', () => {
    expect(failureClassifier.classify('fetch failed: ECONNRESET').category).toBe(
      FailureCategory.RPC_FAILURE,
    );
  });

  it('classifies leader skips as a retryable LEADER_MISS', () => {
    const result = failureClassifier.classify('not the leader for this slot');
    expect(result.category).toBe(FailureCategory.LEADER_MISS);
    expect(result.isRetryable).toBe(true);
  });

  it('falls back to a retryable UNKNOWN for unrecognized errors', () => {
    const result = failureClassifier.classify('some entirely novel failure');
    expect(result.category).toBe(FailureCategory.UNKNOWN);
    expect(result.isRetryable).toBe(true);
  });
});
