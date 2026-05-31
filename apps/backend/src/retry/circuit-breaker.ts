// ============================================================
// Circuit Breaker
// ============================================================
// Prevents cascade failures by tripping when a subsystem exceeds
// its error threshold. States: CLOSED → OPEN → HALF_OPEN.
// Each subsystem (RPC, Jito, Stream, AI) gets its own breaker.
// ============================================================

import {
  CircuitState,
  type CircuitBreakerStatus,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS,
  EVENTS,
} from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';
import { eventBus } from '../events/event-bus.js';
import { circuitBreakerGauge } from '../telemetry/metrics.js';

const log = createChildLogger('circuit-breaker');

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private halfOpenCalls = 0;
  private lastFailureAt: number | null = null;
  private nextRetryAt: number | null = null;

  constructor(
    private readonly name: string,
    private readonly failureThreshold: number = CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    private readonly resetTimeoutMs: number = CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
    private readonly halfOpenMaxCalls: number = CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS,
  ) {
    this.updateMetrics();
  }

  /**
   * Execute an operation through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitOpenError(
        `Circuit breaker '${this.name}' is OPEN — requests blocked until ${new Date(this.nextRetryAt ?? 0).toISOString()}`,
      );
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if the circuit breaker allows execution.
   */
  canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN: {
        // Check if reset timeout has elapsed
        if (this.nextRetryAt && Date.now() >= this.nextRetryAt) {
          this.transitionTo(CircuitState.HALF_OPEN);
          return true;
        }
        return false;
      }

      case CircuitState.HALF_OPEN:
        return this.halfOpenCalls < this.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  private onSuccess(): void {
    switch (this.state) {
      case CircuitState.HALF_OPEN:
        this.successCount++;
        if (this.successCount >= this.halfOpenMaxCalls) {
          this.transitionTo(CircuitState.CLOSED);
        }
        break;

      case CircuitState.CLOSED:
        // Reset failure count on success
        this.failureCount = 0;
        break;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();

    switch (this.state) {
      case CircuitState.CLOSED:
        if (this.failureCount >= this.failureThreshold) {
          this.transitionTo(CircuitState.OPEN);
        }
        break;

      case CircuitState.HALF_OPEN:
        // Any failure in half-open trips back to open
        this.transitionTo(CircuitState.OPEN);
        break;
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    log.info(
      { breaker: this.name, from: oldState, to: newState },
      'circuit breaker state transition',
    );

    switch (newState) {
      case CircuitState.OPEN:
        this.nextRetryAt = Date.now() + this.resetTimeoutMs;
        this.halfOpenCalls = 0;
        this.successCount = 0;
        eventBus.emit(EVENTS.CIRCUIT_OPENED, this.getStatus());
        break;

      case CircuitState.HALF_OPEN:
        this.halfOpenCalls = 0;
        this.successCount = 0;
        eventBus.emit(EVENTS.CIRCUIT_HALF_OPEN, this.getStatus());
        break;

      case CircuitState.CLOSED:
        this.failureCount = 0;
        this.successCount = 0;
        this.nextRetryAt = null;
        eventBus.emit(EVENTS.CIRCUIT_CLOSED, this.getStatus());
        break;
    }

    this.updateMetrics();
  }

  private updateMetrics(): void {
    const stateValue =
      this.state === CircuitState.CLOSED
        ? 0
        : this.state === CircuitState.OPEN
          ? 1
          : 2;
    circuitBreakerGauge.labels(this.name).set(stateValue);
  }

  getStatus(): CircuitBreakerStatus {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      nextRetryAt: this.nextRetryAt,
    };
  }

  /**
   * Force reset the circuit breaker (for manual intervention).
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
    log.info({ breaker: this.name }, 'circuit breaker manually reset');
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

// ─── Pre-configured Circuit Breakers ───────────────────────

export const circuitBreakers = {
  rpc: new CircuitBreaker('rpc', 5, 30_000, 3),
  jito: new CircuitBreaker('jito', 3, 20_000, 2),
  stream: new CircuitBreaker('stream', 3, 15_000, 2),
  ai: new CircuitBreaker('ai', 3, 30_000, 2),
} as const;
