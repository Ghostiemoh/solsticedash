import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TipManager } from './tip-manager.js';
import { MIN_TIP_LAMPORTS, DEFAULT_TIP_LAMPORTS } from '@solstice/shared';

describe('TipManager', () => {
  let tm: TipManager;

  beforeEach(() => {
    // Prevent the constructor's background fetch from hitting the network.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline test'))));
    tm = new TipManager();
  });

  afterEach(() => {
    tm.destroy();
    vi.unstubAllGlobals();
  });

  it('recommends the default tip when no floor or history exists', () => {
    expect(tm.getRecommendedTip()).toBe(DEFAULT_TIP_LAMPORTS);
  });

  it('never recommends below the minimum tip', () => {
    expect(tm.getRecommendedTip()).toBeGreaterThanOrEqual(MIN_TIP_LAMPORTS);
  });

  it('tracks landing-rate metrics from recorded outcomes', () => {
    tm.recordOutcome(10_000, true);
    tm.recordOutcome(10_000, true);
    tm.recordOutcome(10_000, false);

    const m = tm.getPerformanceMetrics();
    expect(m.totalSent).toBe(3);
    expect(m.totalLanded).toBe(2);
    expect(m.totalDropped).toBe(1);
    expect(m.landingRate).toBeCloseTo(2 / 3, 5);
  });

  it('reports a zero landing rate before any outcomes', () => {
    expect(tm.getPerformanceMetrics().landingRate).toBe(0);
  });
});
