// ============================================================
// Bundle Drop Analyzer
// ============================================================
// Analyzes why a bundle was dropped based on historical context,
// current priority fees, and simulation results.
// ============================================================

import { rpcManager } from '../solana/rpc-manager.js';
import { priorityFeeManager } from '../solana/priority-fee-manager.js';
import { type BundleRecord, FailureCategory } from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';
import { tipManager } from './tip-manager.js';

const log = createChildLogger('drop-analyzer');

// A bundle that remains pending well beyond its target leader window was almost
// certainly routed to a Jito leader that skipped its slot, rather than losing an
// auction on tip. Past this threshold we classify the drop as a leader miss.
const LEADER_SKIP_TIMEOUT_MS = 10_000;

export interface DropAnalysis {
  probableCause: FailureCategory;
  recommendedTip: number;
  reason: string;
}

export class DropAnalyzer {
  /**
   * Analyze the probable cause of a dropped bundle.
   */
  async analyzeDrop(bundleRecord: BundleRecord): Promise<DropAnalysis> {
    const elapsedMs = Date.now() - bundleRecord.sentAt;

    // Leader skip: the bundle sat pending past the target leader window without
    // landing. Resubmit targeting the next Jito leader rather than just bumping tip.
    if (elapsedMs > LEADER_SKIP_TIMEOUT_MS) {
      return {
        probableCause: FailureCategory.LEADER_MISS,
        recommendedTip: tipManager.getRecommendedTip(),
        reason: `Bundle stayed pending ${Math.round(elapsedMs / 1000)}s past submission — targeted Jito leader likely skipped its slot; resubmitting to next Jito leader.`,
      };
    }

    // Check if the tip was below recent successful tips
    const recommendedTip = tipManager.getRecommendedTip();
    if (bundleRecord.tipLamports < recommendedTip) {
      return {
        probableCause: FailureCategory.LOW_TIP,
        recommendedTip,
        reason: `Tip (${bundleRecord.tipLamports}) was below current recommended average (${recommendedTip})`,
      };
    }

    // Check if base priority fees surged dramatically
    const recentFees = priorityFeeManager.getRecentFees();
    if (recentFees && recentFees.p90 > 1_000_000) { // 1M microlamports base fee = extremely high congestion
      return {
        probableCause: FailureCategory.CONGESTION,
        recommendedTip: recommendedTip * 1.5,
        reason: 'Base priority fees surged globally, making the bundle uncompetitive',
      };
    }

    // Default to a generic drop if no obvious metric explains it
    // Usually means it lost the auction against a highly specific MEV searcher
    return {
      probableCause: FailureCategory.BUNDLE_DROPPED,
      recommendedTip: Math.round(recommendedTip * 1.2),
      reason: 'Bundle dropped likely due to auction loss or missing the Jito leader window',
    };
  }
}

export const dropAnalyzer = new DropAnalyzer();
