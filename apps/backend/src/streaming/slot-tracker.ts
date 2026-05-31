// ============================================================
// Slot Tracker
// ============================================================
// Maintains the latest processed slot state from the gRPC stream.
// Exposes the current slot for execution timing logic.
// ============================================================

import { eventBus } from '../events/event-bus.js';
import { EVENTS, type SlotUpdate } from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';
import { currentSlotGauge } from '../telemetry/metrics.js';

const log = createChildLogger('slot-tracker');

export class SlotTracker {
  private currentSlot: number = 0;
  private currentParent: number = 0;
  private lastUpdateMs: number = 0;

  constructor() {
    eventBus.on(EVENTS.SLOT_NEW, (update: SlotUpdate) => {
      this.handleNewSlot(update);
    });
  }

  private handleNewSlot(update: SlotUpdate): void {
    if (update.slot > this.currentSlot) {
      this.currentSlot = update.slot;
      this.currentParent = update.parent;
      this.lastUpdateMs = Date.now();
      
      currentSlotGauge.set(this.currentSlot);
      
      // Every 100 slots, log the current slot for debugging
      if (this.currentSlot % 100 === 0) {
        log.debug({ slot: this.currentSlot, parent: this.currentParent }, 'current slot marker');
      }
    }
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }
  
  getAgeMs(): number {
    return this.lastUpdateMs === 0 ? 0 : Date.now() - this.lastUpdateMs;
  }
}

export const slotTracker = new SlotTracker();
