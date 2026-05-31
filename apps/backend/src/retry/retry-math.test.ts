import { describe, it, expect } from 'vitest';
import {
  calculateBackoffDelay,
  clamp,
  percentile,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_JITTER_MAX_MS,
} from '@solstice/shared';

describe('calculateBackoffDelay', () => {
  it('grows exponentially from the base delay (plus jitter) on early attempts', () => {
    const d0 = calculateBackoffDelay(0);
    expect(d0).toBeGreaterThanOrEqual(RETRY_BASE_DELAY_MS);
    expect(d0).toBeLessThanOrEqual(RETRY_BASE_DELAY_MS + RETRY_JITTER_MAX_MS);

    const d2 = calculateBackoffDelay(2);
    expect(d2).toBeGreaterThanOrEqual(RETRY_BASE_DELAY_MS * 4);
  });

  it('caps the delay at the configured maximum', () => {
    expect(calculateBackoffDelay(20)).toBeLessThanOrEqual(RETRY_MAX_DELAY_MS);
  });
});

describe('numeric helpers', () => {
  it('clamps to the given bounds', () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-3, 1, 10)).toBe(1);
    expect(clamp(99, 1, 10)).toBe(10);
  });

  it('computes percentiles from a sorted array', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 100)).toBe(50);
    expect(percentile([], 50)).toBe(0);
  });
});
