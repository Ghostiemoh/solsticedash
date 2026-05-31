import { describe, it, expect } from 'vitest';
import { applyFallbackRules } from './fallback-rules.js';
import {
  FailureCategory,
  CongestionLevel,
  MAX_RETRY_ATTEMPTS,
  type AiDecisionContext,
} from '@solstice/shared';

function makeContext(overrides: Partial<AiDecisionContext> = {}): AiDecisionContext {
  return {
    currentSlot: 1000,
    upcomingLeaders: [],
    congestionLevel: CongestionLevel.MODERATE,
    recentFailures: [],
    retryHistory: [],
    bundlePerformance: {
      totalSent: 0,
      totalLanded: 0,
      totalDropped: 0,
      landingRate: 0,
      avgTipLanded: 0,
      avgTipDropped: 0,
      avgLatencyMs: 0,
    },
    latencyMetrics: {
      rpcLatencyMs: 0,
      streamLatencyMs: 0,
      bundleSubmitLatencyMs: 0,
      simulationLatencyMs: 0,
      aiDecisionLatencyMs: 0,
    },
    currentTipLamports: 10_000,
    transactionAge: 1_000,
    retryCount: 0,
    ...overrides,
  } as AiDecisionContext;
}

describe('applyFallbackRules', () => {
  it('rebuilds immediately on an expired blockhash', () => {
    const d = applyFallbackRules(FailureCategory.BLOCKHASH_EXPIRED, makeContext());
    expect(d.shouldRetry).toBe(true);
    expect(d.delayMs).toBe(0);
  });

  it('increases tip and waits for a Jito leader on a dropped bundle', () => {
    const d = applyFallbackRules(FailureCategory.BUNDLE_DROPPED, makeContext());
    expect(d.shouldRetry).toBe(true);
    expect(d.waitForJitoLeader).toBe(true);
    expect(d.newTipLamports).toBe(Math.round(10_000 * 1.3));
  });

  it('raises the compute-unit limit when compute is exhausted', () => {
    const d = applyFallbackRules(FailureCategory.COMPUTE_EXHAUSTED, makeContext());
    expect(d.adjustComputeUnits).toBe(400_000);
  });

  it('abandons on an unrecoverable simulation/program error', () => {
    const d = applyFallbackRules(FailureCategory.SIMULATION_FAILED, makeContext());
    expect(d.shouldRetry).toBe(false);
    expect(d.abandonTransaction).toBe(true);
  });

  it('waits for the next Jito leader on a leader miss', () => {
    const d = applyFallbackRules(FailureCategory.LEADER_MISS, makeContext());
    expect(d.shouldRetry).toBe(true);
    expect(d.waitForJitoLeader).toBe(true);
  });

  it('rebroadcasts on an RPC failure', () => {
    const d = applyFallbackRules(FailureCategory.RPC_FAILURE, makeContext());
    expect(d.rebroadcast).toBe(true);
  });

  it('abandons once max retries are exhausted regardless of category', () => {
    const d = applyFallbackRules(
      FailureCategory.BLOCKHASH_EXPIRED,
      makeContext({ retryCount: MAX_RETRY_ATTEMPTS }),
    );
    expect(d.shouldRetry).toBe(false);
    expect(d.abandonTransaction).toBe(true);
  });
});
