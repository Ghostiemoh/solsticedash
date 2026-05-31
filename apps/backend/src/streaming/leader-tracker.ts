// ============================================================
// Leader Tracker
// ============================================================
// Listens to new slots and updates the current leader based on
// the cached leader schedule. Emits events when the leader changes.
// ============================================================

import { eventBus } from '../events/event-bus.js';
import { EVENTS, type SlotUpdate, type LeaderInfo } from '@solstice/shared';
import { leaderSchedule } from '../leader/leader-schedule.js';
import { jitoLeaderDetector } from '../leader/jito-leader-detector.js';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('leader-tracker');

export class LeaderTracker {
  private currentLeaderPubkey: string | null = null;
  private currentLeaderSlot: number = 0;

  constructor() {
    eventBus.on(EVENTS.SLOT_NEW, (update: SlotUpdate) => {
      this.handleNewSlot(update.slot);
    });
  }

  private handleNewSlot(slot: number): void {
    const leaderPubkey = leaderSchedule.getLeaderForSlot(slot);
    
    if (leaderPubkey && leaderPubkey !== this.currentLeaderPubkey) {
      this.currentLeaderPubkey = leaderPubkey;
      this.currentLeaderSlot = slot;
      
      const isJito = jitoLeaderDetector.isJitoValidator(leaderPubkey);
      
      const leaderInfo: LeaderInfo = {
        slot,
        validator: leaderPubkey,
        isJitoValidator: isJito,
        slotsUntil: 0,
      };
      
      eventBus.emit(EVENTS.LEADER_CURRENT, leaderInfo);
      
      log.debug(
        { slot, leader: leaderPubkey, isJito }, 
        'leader changed'
      );
    }
  }

  getCurrentLeader(): string | null {
    return this.currentLeaderPubkey;
  }
}

export const leaderTracker = new LeaderTracker();
