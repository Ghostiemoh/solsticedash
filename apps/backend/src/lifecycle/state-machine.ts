// ============================================================
// Transaction Lifecycle State Machine
// ============================================================
// Enforces valid state transitions for the transaction lifecycle.
// Prevents illegal transitions and provides transition history.
// ============================================================

import { TransactionStatus } from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('state-machine');

const VALID_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  [TransactionStatus.CREATED]: [TransactionStatus.SIMULATED, TransactionStatus.FAILED],
  [TransactionStatus.SIMULATED]: [TransactionStatus.SIGNED, TransactionStatus.FAILED],
  [TransactionStatus.SIGNED]: [
    TransactionStatus.BUNDLED,
    TransactionStatus.SUBMITTED,
    TransactionStatus.FAILED,
  ],
  [TransactionStatus.BUNDLED]: [TransactionStatus.SUBMITTED, TransactionStatus.FAILED],
  [TransactionStatus.SUBMITTED]: [
    TransactionStatus.PROCESSED,
    TransactionStatus.CONFIRMED,
    TransactionStatus.FINALIZED,
    TransactionStatus.FAILED,
  ],
  [TransactionStatus.PROCESSED]: [
    TransactionStatus.CONFIRMED,
    TransactionStatus.FINALIZED,
    TransactionStatus.FAILED,
  ],
  [TransactionStatus.CONFIRMED]: [
    TransactionStatus.FINALIZED,
    TransactionStatus.FAILED,
  ],
  [TransactionStatus.FINALIZED]: [],
  [TransactionStatus.FAILED]: [
    TransactionStatus.RETRYING,
    TransactionStatus.ABANDONED,
  ],
  [TransactionStatus.RETRYING]: [
    TransactionStatus.SIMULATED,
    TransactionStatus.FAILED,
    TransactionStatus.ABANDONED,
  ],
  [TransactionStatus.ABANDONED]: [],
};

export interface StateTransition {
  from: TransactionStatus;
  to: TransactionStatus;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class LifecycleStateMachine {
  private currentState: TransactionStatus;
  private transitions: StateTransition[] = [];

  constructor(initialState: TransactionStatus = TransactionStatus.CREATED) {
    this.currentState = initialState;
  }

  /**
   * Attempt a state transition. Returns true if the transition was valid.
   * Throws on invalid transitions to enforce correctness.
   */
  transition(
    targetState: TransactionStatus,
    metadata?: Record<string, unknown>,
  ): boolean {
    const validTargets = VALID_TRANSITIONS[this.currentState];

    if (!validTargets || !validTargets.includes(targetState)) {
      log.error(
        { from: this.currentState, to: targetState },
        'invalid state transition attempted',
      );
      throw new Error(
        `Invalid transition: ${this.currentState} → ${targetState}`,
      );
    }

    const transitionRecord: StateTransition = {
      from: this.currentState,
      to: targetState,
      timestamp: Date.now(),
      metadata,
    };

    this.transitions.push(transitionRecord);
    this.currentState = targetState;

    log.trace(
      { from: transitionRecord.from, to: transitionRecord.to },
      'state transition',
    );

    return true;
  }

  /**
   * Check if a transition is valid without performing it.
   */
  canTransition(targetState: TransactionStatus): boolean {
    const validTargets = VALID_TRANSITIONS[this.currentState];
    return validTargets?.includes(targetState) ?? false;
  }

  getState(): TransactionStatus {
    return this.currentState;
  }

  getTransitions(): StateTransition[] {
    return [...this.transitions];
  }

  isTerminal(): boolean {
    return (
      this.currentState === TransactionStatus.FINALIZED ||
      this.currentState === TransactionStatus.ABANDONED
    );
  }

  /**
   * Get the duration from first transition to current state in milliseconds.
   */
  getDurationMs(): number {
    if (this.transitions.length === 0) return 0;
    const firstTransition = this.transitions[0];
    const lastTransition = this.transitions[this.transitions.length - 1];
    if (!firstTransition || !lastTransition) return 0;
    return lastTransition.timestamp - firstTransition.timestamp;
  }
}
