// ============================================================
// Jito Leader Detector
// ============================================================
// Maintains a set of known Jito validator identities.
// Cross-references with the leader schedule to detect upcoming
// Jito leader windows for optimal bundle submission timing.
// ============================================================

import { createChildLogger } from '../telemetry/logger.js';
import { leaderSchedule } from './leader-schedule.js';
import { eventBus } from '../events/event-bus.js';
import { EVENTS, type LeaderInfo, SLOT_DURATION_MS, SLOTS_PER_LEADER } from '@solstice/shared';

const log = createChildLogger('jito-leader-detector');

// Known Jito validator identities (mainnet)
// These are fetched dynamically at runtime via jito-ts getTipAccounts,
// but we maintain a seed list for immediate availability.
const SEED_JITO_VALIDATORS: string[] = [
  // These will be populated from the Jito API at runtime
];

export class JitoLeaderDetector {
  private jitoValidators = new Set<string>(SEED_JITO_VALIDATORS);
  private lastNotifiedSlot: number = 0;

  /**
   * Update the set of Jito validators from the API.
   */
  updateValidators(validators: string[]): void {
    this.jitoValidators = new Set(validators);
    log.info(
      { validatorCount: this.jitoValidators.size },
      'Jito validators updated',
    );
  }

  /**
   * Add known Jito validators to the set.
   */
  addValidators(validators: string[]): void {
    for (const v of validators) {
      this.jitoValidators.add(v);
    }
    log.debug(
      { totalValidators: this.jitoValidators.size, added: validators.length },
      'Jito validators added',
    );
  }

  /**
   * Check if a validator is a Jito validator.
   */
  isJitoValidator(validatorPubkey: string): boolean {
    return this.jitoValidators.has(validatorPubkey);
  }

  /**
   * Find the next Jito leader window and emit an event.
   * Called on each new slot to check the upcoming schedule.
   */
  checkUpcomingJitoLeader(currentSlot: number): LeaderInfo | null {
    const nextJito = leaderSchedule.findNextJitoLeaderSlot(
      currentSlot,
      this.jitoValidators,
    );

    if (nextJito && nextJito.slot !== this.lastNotifiedSlot) {
      this.lastNotifiedSlot = nextJito.slot;

      // Only emit if Jito leader is within 20 slots (~8 seconds)
      if (nextJito.slotsUntil <= 20) {
        eventBus.emit(EVENTS.JITO_LEADER_UPCOMING, nextJito);

        log.info(
          {
            jitoLeaderSlot: nextJito.slot,
            slotsAway: nextJito.slotsUntil,
            estimatedMs: nextJito.slotsUntil * SLOT_DURATION_MS,
          },
          'Jito leader upcoming',
        );
      }
    }

    return nextJito;
  }

  /**
   * Get the set of known Jito validators (for leader schedule queries).
   */
  getJitoValidators(): Set<string> {
    return this.jitoValidators;
  }

  getValidatorCount(): number {
    return this.jitoValidators.size;
  }
}

export const jitoLeaderDetector = new JitoLeaderDetector();
