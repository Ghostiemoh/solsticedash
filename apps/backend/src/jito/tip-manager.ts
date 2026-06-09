// ============================================================
// Jito Tip Manager
// ============================================================
// Manages dynamic tip amounts based on bundle landing rates,
// congestion levels, and AI recommendations. Tracks historical
// tip-to-landing correlation for intelligent tip optimization.
// ============================================================

import { createChildLogger } from '../telemetry/logger.js';
import { tipAmountHistogram } from '../telemetry/metrics.js';
import {
  MIN_TIP_LAMPORTS,
  MAX_TIP_LAMPORTS,
  DEFAULT_TIP_LAMPORTS,
  clamp,
} from '@solstice/shared';
import { env } from '../config/env.js';

const log = createChildLogger('tip-manager');

interface TipRecord {
  tipLamports: number;
  landed: boolean;
  timestamp: number;
}

export class TipManager {
  private tipHistory: TipRecord[] = [];
  private readonly maxHistory = 100;
  private currentBaseTip: number;
  private jitoTipFloor: {
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    p99: number;
    ema_p50: number;
    updatedAt: number;
  } | null = null;
  private fetchInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.currentBaseTip = env.JITO_DEFAULT_TIP_LAMPORTS;
    this.startPeriodicFetch();
  }

  /**
   * Start fetching Jito tip floors periodically.
   */
  private startPeriodicFetch(): void {
    // Initial fetch in background
    this.fetchJitoTipFloor().catch(() => {});

    // Every 60 seconds
    this.fetchInterval = setInterval(() => {
      this.fetchJitoTipFloor().catch(() => {});
    }, 60_000);
  }

  /**
   * Clean up background fetchers.
   */
  destroy(): void {
    if (this.fetchInterval) {
      clearInterval(this.fetchInterval);
      this.fetchInterval = null;
    }
  }

  /**
   * Fetch recent tip statistics from Jito's API.
   */
  async fetchJitoTipFloor(): Promise<void> {
    try {
      const response = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = (await response.json()) as any[];
      if (data && data.length > 0) {
        const floor = data[0];
        this.jitoTipFloor = {
          p25: Math.round(floor.landed_tips_25th_percentile * 1e9),
          p50: Math.round(floor.landed_tips_50th_percentile * 1e9),
          p75: Math.round(floor.landed_tips_75th_percentile * 1e9),
          p95: Math.round(floor.landed_tips_95th_percentile * 1e9),
          p99: Math.round(floor.landed_tips_99th_percentile * 1e9),
          ema_p50: Math.round(floor.ema_landed_tips_50th_percentile * 1e9),
          updatedAt: Date.now(),
        };
        log.info(
          {
            p50: `${floor.landed_tips_50th_percentile} SOL`,
            p75: `${floor.landed_tips_75th_percentile} SOL`,
            p95: `${floor.landed_tips_95th_percentile} SOL`,
          },
          'Jito tip floor stats updated from API',
        );
      }
    } catch (error: any) {
      log.warn(
        { error: error.message },
        'Failed to fetch Jito tip floor from API. Using local history/default fallback.',
      );
    }
  }

  /**
   * Record a tip outcome (landed or dropped) for learning.
   */
  recordOutcome(tipLamports: number, landed: boolean): void {
    this.tipHistory.push({
      tipLamports,
      landed,
      timestamp: Date.now(),
    });

    if (this.tipHistory.length > this.maxHistory) {
      this.tipHistory.shift();
    }

    tipAmountHistogram.observe(tipLamports);
  }

  /**
   * Get the recommended tip amount based on Jito API and recent history.
   */
  getRecommendedTip(): number {
    let baseline = this.currentBaseTip;

    if (this.jitoTipFloor) {
      // Balance cost vs landing probability: target the live p75 landed-tip
      // floor by default (good landing odds without overpaying).
      baseline = this.jitoTipFloor.p75;

      // Under low observed landing rate, escalate to the live p95 floor.
      const metrics = this.getPerformanceMetrics();
      if (metrics.landingRate < 0.7 && metrics.totalSent >= 5) {
        baseline = this.jitoTipFloor.p95;
        log.debug({ baseline, reason: 'low landing rate (< 70%)' }, 'Tip escalated to Jito p95 percentile');
      }
    } else if (this.tipHistory.length >= 5) {
      // Local history fallback
      const recentLanded = this.tipHistory
        .filter((r) => r.landed)
        .map((r) => r.tipLamports)
        .sort((a, b) => a - b);

      const recentDropped = this.tipHistory
        .filter((r) => !r.landed)
        .map((r) => r.tipLamports)
        .sort((a, b) => a - b);

      if (recentLanded.length > 0) {
        const p25LandedIndex = Math.floor(recentLanded.length * 0.25);
        const p25Landed = recentLanded[p25LandedIndex] ?? this.currentBaseTip;

        const avgDropTip =
          recentDropped.length > 0
            ? recentDropped.reduce((a, b) => a + b, 0) / recentDropped.length
            : 0;

        let recommended = p25Landed;
        if (avgDropTip >= p25Landed) {
          recommended = Math.round(p25Landed * 1.3);
        }
        baseline = recommended;
      }
    }

    return clamp(baseline, MIN_TIP_LAMPORTS, env.JITO_MAX_TIP_LAMPORTS);
  }

  /**
   * Get performance metrics for the AI decision engine.
   */
  getPerformanceMetrics(): {
    totalSent: number;
    totalLanded: number;
    totalDropped: number;
    landingRate: number;
    avgTipLanded: number;
    avgTipDropped: number;
    avgLatencyMs: number;
  } {
    const landed = this.tipHistory.filter((r) => r.landed);
    const dropped = this.tipHistory.filter((r) => !r.landed);

    return {
      totalSent: this.tipHistory.length,
      totalLanded: landed.length,
      totalDropped: dropped.length,
      landingRate:
        this.tipHistory.length > 0
          ? landed.length / this.tipHistory.length
          : 0,
      avgTipLanded:
        landed.length > 0
          ? Math.round(
              landed.reduce((a, b) => a + b.tipLamports, 0) / landed.length,
            )
          : 0,
      avgTipDropped:
        dropped.length > 0
          ? Math.round(
              dropped.reduce((a, b) => a + b.tipLamports, 0) / dropped.length,
            )
          : 0,
      avgLatencyMs: 0,
    };
  }

  /**
   * Apply an AI-recommended tip override.
   */
  setAiRecommendedTip(tipLamports: number): void {
    const clamped = clamp(tipLamports, MIN_TIP_LAMPORTS, env.JITO_MAX_TIP_LAMPORTS);
    this.currentBaseTip = clamped;
    log.info(
      { newBaseTip: clamped, aiRecommended: tipLamports },
      'AI tip recommendation applied',
    );
  }
}

export const tipManager = new TipManager();
