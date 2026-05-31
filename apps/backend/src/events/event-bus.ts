// ============================================================
// Internal Event Bus
// ============================================================
// Typed event bus using EventEmitter3. All subsystems publish
// and subscribe through this bus, decoupling producers from
// consumers. This is the backbone of the event-driven architecture.
// ============================================================

import EventEmitter from 'eventemitter3';
import type {
  SlotUpdate,
  LeaderInfo,
  TransactionLifecycle,
  BundleRecord,
  AiDecisionRecord,
  CongestionMetrics,
  StreamHealthData,
  SystemHealth,
  CircuitBreakerStatus,
} from '@solstice/shared';
import { EVENTS } from '@solstice/shared';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('event-bus');

interface EventMap {
  // Slot events
  [EVENTS.SLOT_NEW]: (data: SlotUpdate) => void;
  [EVENTS.SLOT_CONFIRMED]: (data: SlotUpdate) => void;
  [EVENTS.SLOT_FINALIZED]: (data: SlotUpdate) => void;

  // Leader events
  [EVENTS.LEADER_CURRENT]: (data: LeaderInfo) => void;
  [EVENTS.LEADER_UPCOMING]: (data: LeaderInfo[]) => void;
  [EVENTS.JITO_LEADER_UPCOMING]: (data: LeaderInfo) => void;

  // Transaction lifecycle events
  [EVENTS.TX_CREATED]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_SIMULATED]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_SIGNED]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_SUBMITTED]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_PROCESSED]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_CONFIRMED]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_FINALIZED]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_FAILED]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_RETRYING]: (data: TransactionLifecycle) => void;
  [EVENTS.TX_ABANDONED]: (data: TransactionLifecycle) => void;

  // Bundle events
  [EVENTS.BUNDLE_CREATED]: (data: BundleRecord) => void;
  [EVENTS.BUNDLE_SENT]: (data: BundleRecord) => void;
  [EVENTS.BUNDLE_LANDED]: (data: BundleRecord) => void;
  [EVENTS.BUNDLE_DROPPED]: (data: BundleRecord) => void;
  [EVENTS.BUNDLE_REJECTED]: (data: BundleRecord) => void;

  // Retry events
  [EVENTS.RETRY_SCHEDULED]: (data: { transactionId: string; attempt: number; delayMs: number }) => void;
  [EVENTS.RETRY_EXECUTING]: (data: { transactionId: string; attempt: number }) => void;
  [EVENTS.RETRY_SUCCEEDED]: (data: { transactionId: string; attempt: number }) => void;
  [EVENTS.RETRY_EXHAUSTED]: (data: { transactionId: string; totalAttempts: number }) => void;

  // AI events
  [EVENTS.AI_DECISION_REQUESTED]: (data: { transactionId: string }) => void;
  [EVENTS.AI_DECISION_RECEIVED]: (data: AiDecisionRecord) => void;
  [EVENTS.AI_DECISION_FALLBACK]: (data: { transactionId: string; reason: string }) => void;

  // Circuit breaker events
  [EVENTS.CIRCUIT_OPENED]: (data: CircuitBreakerStatus) => void;
  [EVENTS.CIRCUIT_CLOSED]: (data: CircuitBreakerStatus) => void;
  [EVENTS.CIRCUIT_HALF_OPEN]: (data: CircuitBreakerStatus) => void;

  // Stream events
  [EVENTS.STREAM_CONNECTED]: () => void;
  [EVENTS.STREAM_DISCONNECTED]: (data: { reason: string }) => void;
  [EVENTS.STREAM_RECONNECTING]: (data: { attempt: number }) => void;
  [EVENTS.STREAM_DEGRADED]: (data: StreamHealthData) => void;
  [EVENTS.STREAM_HEALTHY]: (data: StreamHealthData) => void;

  // Congestion events
  [EVENTS.CONGESTION_UPDATE]: (data: CongestionMetrics) => void;

  // System events
  [EVENTS.SYSTEM_SHUTDOWN]: () => void;
}

class SolsticeEventBus extends EventEmitter<EventMap> {
  private eventCounts = new Map<string, number>();

  override emit(
    event: any,
    ...args: any[]
  ): boolean {
    const count = (this.eventCounts.get(event as string) ?? 0) + 1;
    this.eventCounts.set(event as string, count);

    log.trace({ event, count }, 'event emitted');
    return super.emit(event, ...args);
  }

  getEventCount(event: string): number {
    return this.eventCounts.get(event) ?? 0;
  }

  getEventCounts(): Record<string, number> {
    return Object.fromEntries(this.eventCounts);
  }

  resetCounts(): void {
    this.eventCounts.clear();
  }
}

export const eventBus = new SolsticeEventBus();
