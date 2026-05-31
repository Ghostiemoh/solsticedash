// ============================================================
// Submission Timer
// ============================================================
// Computes optimal submission timing for transactions and bundles.
// For Jito bundles: submit ~2 slots before the Jito leader's window.
// For standard transactions: submit during the current leader's window.
// ============================================================

import { createChildLogger } from '../telemetry/logger.js';
import { leaderSchedule } from './leader-schedule.js';
import { jitoLeaderDetector } from './jito-leader-detector.js';
import { SLOT_DURATION_MS, SLOTS_PER_LEADER, type LeaderInfo } from '@solstice/shared';

const log = createChildLogger('submission-timer');

export interface SubmissionWindow {
  optimalSlot: number;
  delayMs: number;
  leader: string;
  isJitoLeader: boolean;
  reason: string;
}

export class SubmissionTimer {
  /**
   * Calculate the optimal submission window for a Jito bundle.
   * Bundles should be submitted 1-2 slots BEFORE the Jito leader's window.
   */
  calculateBundleWindow(currentSlot: number): SubmissionWindow | null {
    const nextJito = jitoLeaderDetector.checkUpcomingJitoLeader(currentSlot);

    if (!nextJito) {
      log.debug('no upcoming Jito leader found in schedule');
      return null;
    }

    // Submit 2 slots before the Jito leader's window for propagation
    const submissionSlot = nextJito.slot - 2;
    const slotsUntilSubmission = submissionSlot - currentSlot;
    const delayMs = Math.max(0, slotsUntilSubmission * SLOT_DURATION_MS);

    return {
      optimalSlot: submissionSlot,
      delayMs,
      leader: nextJito.validator,
      isJitoLeader: true,
      reason: `Submit 2 slots before Jito leader at slot ${nextJito.slot} (delay: ${delayMs}ms)`,
    };
  }

  /**
   * Calculate the optimal submission window for a standard transaction.
   * Submit during the current leader's 4-slot window for best chance.
   */
  calculateStandardWindow(currentSlot: number): SubmissionWindow {
    // Current slot position within the 4-slot leader window
    const positionInWindow = currentSlot % SLOTS_PER_LEADER;
    const currentLeader = leaderSchedule.getLeaderForSlot(currentSlot);

    // Best to submit in the first 2 slots of the leader's window
    if (positionInWindow <= 1) {
      return {
        optimalSlot: currentSlot,
        delayMs: 0,
        leader: currentLeader ?? 'unknown',
        isJitoLeader: currentLeader
          ? jitoLeaderDetector.isJitoValidator(currentLeader)
          : false,
        reason: `Submit immediately — position ${positionInWindow}/3 in leader window`,
      };
    }

    // Late in the window — wait for next leader's window
    const slotsUntilNextWindow = SLOTS_PER_LEADER - positionInWindow;
    const delayMs = slotsUntilNextWindow * SLOT_DURATION_MS;
    const nextWindowSlot = currentSlot + slotsUntilNextWindow;
    const nextLeader = leaderSchedule.getLeaderForSlot(nextWindowSlot);

    return {
      optimalSlot: nextWindowSlot,
      delayMs,
      leader: nextLeader ?? 'unknown',
      isJitoLeader: nextLeader
        ? jitoLeaderDetector.isJitoValidator(nextLeader)
        : false,
      reason: `Late in window (position ${positionInWindow}/3) — wait ${delayMs}ms for next leader`,
    };
  }
}

export const submissionTimer = new SubmissionTimer();
