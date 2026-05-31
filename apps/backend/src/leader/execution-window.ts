// ============================================================
// Execution Window Calculator
// ============================================================
// Determines if the current moment is optimal for transaction
// submission based on leader identity, slot position, congestion,
// and Jito leader proximity.
// ============================================================

import { leaderSchedule } from './leader-schedule.js';
import { jitoLeaderDetector } from './jito-leader-detector.js';
import { CongestionLevel, SLOTS_PER_LEADER, SLOT_DURATION_MS } from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('execution-window');

export interface ExecutionWindowAnalysis {
  isOptimal: boolean;
  score: number;
  factors: WindowFactor[];
  recommendedAction: 'submit_now' | 'wait_for_jito' | 'wait_for_window' | 'delay_congestion';
  estimatedDelayMs: number;
}

interface WindowFactor {
  name: string;
  score: number;
  description: string;
}

export class ExecutionWindow {
  /**
   * Analyze the current execution window and determine optimality.
   * Score: 0 (worst) to 100 (best).
   */
  analyze(
    currentSlot: number,
    congestionLevel: CongestionLevel,
    preferJitoBundle: boolean = true,
  ): ExecutionWindowAnalysis {
    const factors: WindowFactor[] = [];
    let totalScore = 0;

    // Factor 1: Position within leader's 4-slot window (0-25 pts)
    const positionInWindow = currentSlot % SLOTS_PER_LEADER;
    const windowScore = positionInWindow <= 1 ? 25 : positionInWindow === 2 ? 15 : 5;
    factors.push({
      name: 'window_position',
      score: windowScore,
      description: `Position ${positionInWindow}/3 in leader window`,
    });
    totalScore += windowScore;

    // Factor 2: Congestion level (0-25 pts)
    const congestionScore =
      congestionLevel === CongestionLevel.LOW
        ? 25
        : congestionLevel === CongestionLevel.MODERATE
          ? 18
          : congestionLevel === CongestionLevel.HIGH
            ? 8
            : 0;
    factors.push({
      name: 'congestion',
      score: congestionScore,
      description: `Congestion: ${congestionLevel}`,
    });
    totalScore += congestionScore;

    // Factor 3: Jito leader proximity (0-30 pts, if preferring bundles)
    if (preferJitoBundle) {
      const nextJito = jitoLeaderDetector.checkUpcomingJitoLeader(currentSlot);
      let jitoScore = 0;
      let jitoDescription = 'No Jito leader in lookahead';

      if (nextJito) {
        if (nextJito.slotsUntil <= 2) {
          jitoScore = 30;
          jitoDescription = `Jito leader in ${nextJito.slotsUntil} slots — ideal`;
        } else if (nextJito.slotsUntil <= 8) {
          jitoScore = 20;
          jitoDescription = `Jito leader in ${nextJito.slotsUntil} slots — wait`;
        } else if (nextJito.slotsUntil <= 20) {
          jitoScore = 10;
          jitoDescription = `Jito leader in ${nextJito.slotsUntil} slots — acceptable wait`;
        } else {
          jitoScore = 5;
          jitoDescription = `Jito leader in ${nextJito.slotsUntil} slots — far`;
        }
      }

      factors.push({
        name: 'jito_proximity',
        score: jitoScore,
        description: jitoDescription,
      });
      totalScore += jitoScore;
    }

    // Factor 4: Leader is known (0-20 pts)
    const currentLeader = leaderSchedule.getLeaderForSlot(currentSlot);
    const leaderScore = currentLeader ? 20 : 5;
    factors.push({
      name: 'leader_known',
      score: leaderScore,
      description: currentLeader
        ? `Leader known: ${currentLeader.slice(0, 8)}...`
        : 'Leader unknown — schedule may be stale',
    });
    totalScore += leaderScore;

    // Determine recommended action
    let recommendedAction: ExecutionWindowAnalysis['recommendedAction'];
    let estimatedDelayMs = 0;

    if (totalScore >= 70) {
      recommendedAction = 'submit_now';
    } else if (preferJitoBundle && totalScore < 50) {
      const nextJito = jitoLeaderDetector.checkUpcomingJitoLeader(currentSlot);
      if (nextJito && nextJito.slotsUntil <= 20) {
        recommendedAction = 'wait_for_jito';
        estimatedDelayMs = Math.max(0, (nextJito.slotsUntil - 2) * SLOT_DURATION_MS);
      } else {
        recommendedAction = 'submit_now';
      }
    } else if (congestionLevel === CongestionLevel.CRITICAL) {
      recommendedAction = 'delay_congestion';
      estimatedDelayMs = 5000;
    } else {
      recommendedAction = 'wait_for_window';
      estimatedDelayMs = (SLOTS_PER_LEADER - positionInWindow) * SLOT_DURATION_MS;
    }

    return {
      isOptimal: totalScore >= 70,
      score: totalScore,
      factors,
      recommendedAction,
      estimatedDelayMs,
    };
  }
}

export const executionWindow = new ExecutionWindow();
