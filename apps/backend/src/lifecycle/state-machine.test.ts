import { describe, it, expect } from 'vitest';
import { LifecycleStateMachine } from './state-machine.js';
import { TransactionStatus } from '@solstice/shared';

describe('LifecycleStateMachine', () => {
  it('starts in CREATED by default', () => {
    expect(new LifecycleStateMachine().getState()).toBe(TransactionStatus.CREATED);
  });

  it('allows a valid forward transition and records it', () => {
    const sm = new LifecycleStateMachine();
    expect(sm.transition(TransactionStatus.SIMULATED)).toBe(true);
    expect(sm.getState()).toBe(TransactionStatus.SIMULATED);
    expect(sm.getTransitions()).toHaveLength(1);
  });

  it('throws on an illegal transition', () => {
    const sm = new LifecycleStateMachine();
    expect(() => sm.transition(TransactionStatus.FINALIZED)).toThrow();
  });

  it('reports valid transitions via canTransition without mutating state', () => {
    const sm = new LifecycleStateMachine();
    expect(sm.canTransition(TransactionStatus.SIMULATED)).toBe(true);
    expect(sm.canTransition(TransactionStatus.CONFIRMED)).toBe(false);
    expect(sm.getState()).toBe(TransactionStatus.CREATED);
  });

  it('permits recovery from FAILED into RETRYING', () => {
    const sm = new LifecycleStateMachine(TransactionStatus.FAILED);
    expect(sm.canTransition(TransactionStatus.RETRYING)).toBe(true);
  });

  it('marks FINALIZED and ABANDONED as terminal', () => {
    expect(
      new LifecycleStateMachine(TransactionStatus.FINALIZED).isTerminal(),
    ).toBe(true);
    expect(
      new LifecycleStateMachine(TransactionStatus.ABANDONED).isTerminal(),
    ).toBe(true);
    expect(new LifecycleStateMachine(TransactionStatus.CREATED).isTerminal()).toBe(
      false,
    );
  });
});
