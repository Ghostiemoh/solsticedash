// ============================================================
// Leader Schedule Cache
// ============================================================
// Caches the epoch-level leader schedule from the Solana RPC.
// Refreshes on epoch boundaries. Provides lookups for current
// and upcoming leaders. Critical for submission timing.
// ============================================================

import { rpcManager } from '../solana/rpc-manager.js';
import { createChildLogger } from '../telemetry/logger.js';
import { type LeaderInfo, SLOTS_PER_EPOCH, SLOTS_PER_LEADER } from '@solstice/shared';

const log = createChildLogger('leader-schedule');

export class LeaderSchedule {
  private schedule: Map<number, string> = new Map();
  private currentEpoch: number = -1;
  private lastRefreshAt: number = 0;

  /**
   * Refresh the leader schedule for the current epoch.
   */
  async refresh(): Promise<void> {
    try {
      const epochInfo = await rpcManager.execute(
        'getEpochInfo',
        (conn) => conn.getEpochInfo(),
      );

      if (epochInfo.epoch === this.currentEpoch && this.schedule.size > 0) {
        log.trace('leader schedule already cached for current epoch');
        return;
      }

      const leaderScheduleRaw = await rpcManager.execute(
        'getLeaderSchedule',
        (conn) => conn.getLeaderSchedule(),
      );

      if (!leaderScheduleRaw) {
        log.warn('no leader schedule returned from RPC');
        return;
      }

      this.schedule.clear();

      // The schedule maps validator pubkey → array of slot indices within the epoch
      for (const [validator, slotIndices] of Object.entries(leaderScheduleRaw)) {
        for (const slotIndex of slotIndices) {
          const absoluteSlot = epochInfo.absoluteSlot - epochInfo.slotIndex + slotIndex;
          this.schedule.set(absoluteSlot, validator);
        }
      }

      this.currentEpoch = epochInfo.epoch;
      this.lastRefreshAt = Date.now();

      log.info(
        {
          epoch: epochInfo.epoch,
          totalSlots: this.schedule.size,
          uniqueValidators: new Set(Object.keys(leaderScheduleRaw)).size,
        },
        'leader schedule refreshed',
      );
    } catch (error: any) {
      log.error({ error: error.message }, 'failed to refresh leader schedule');
      throw error; // Re-throw so retry logic can catch it
    }
  }

  private refreshTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.refreshTimer) return;
    
    // Run initial refresh in background
    this.refreshWithRetry();

    // Set up periodic refresh every 5 minutes (300,000 ms)
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err: any) => {
        log.error({ error: err.message }, 'periodic leader schedule refresh failed');
      });
    }, 300_000);
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private async refreshWithRetry(): Promise<void> {
    try {
      await this.refresh();
      if (this.schedule.size === 0) {
        throw new Error('Leader schedule is empty after refresh');
      }
      log.info('Leader schedule successfully loaded and cached');
    } catch (error: any) {
      log.warn(
        { error: error.message },
        'Leader schedule refresh failed. Retrying in 5 seconds...'
      );
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.refreshWithRetry();
      }, 5000);
    }
  }

  /**
   * Get the leader for a specific slot.
   */
  getLeaderForSlot(slot: number): string | null {
    return this.schedule.get(slot) ?? null;
  }

  /**
   * Get upcoming leaders from a given slot.
   */
  getUpcomingLeaders(
    currentSlot: number,
    count: number = 12,
    jitoValidators?: Set<string>,
  ): LeaderInfo[] {
    const leaders: LeaderInfo[] = [];

    for (let offset = 0; offset < count * SLOTS_PER_LEADER && leaders.length < count; offset += SLOTS_PER_LEADER) {
      const targetSlot = currentSlot + offset;
      const validator = this.schedule.get(targetSlot);

      if (validator) {
        leaders.push({
          slot: targetSlot,
          validator,
          isJitoValidator: jitoValidators?.has(validator) ?? false,
          slotsUntil: offset,
        });
      }
    }

    return leaders;
  }

  /**
   * Find the next Jito leader window from the current slot.
   */
  findNextJitoLeaderSlot(
    currentSlot: number,
    jitoValidators: Set<string>,
    maxLookahead: number = 200,
  ): LeaderInfo | null {
    for (let offset = 0; offset < maxLookahead; offset += SLOTS_PER_LEADER) {
      const targetSlot = currentSlot + offset;
      const validator = this.schedule.get(targetSlot);

      if (validator && jitoValidators.has(validator)) {
        return {
          slot: targetSlot,
          validator,
          isJitoValidator: true,
          slotsUntil: offset,
        };
      }
    }

    return null;
  }

  getCachedEpoch(): number {
    return this.currentEpoch;
  }

  getScheduleSize(): number {
    return this.schedule.size;
  }
}

export const leaderSchedule = new LeaderSchedule();
