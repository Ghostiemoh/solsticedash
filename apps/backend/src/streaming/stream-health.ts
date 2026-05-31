// ============================================================
// Stream Health Monitor
// ============================================================
// Monitors the health of the Yellowstone gRPC stream.
// Tracks time since last message, reconnection count, latency,
// and emits health status events.
// ============================================================

import {
  StreamStatus,
  type StreamHealthData,
  EVENTS,
  STREAM_HEARTBEAT_INTERVAL_MS,
  STREAM_STALE_THRESHOLD_MS,
} from '@solstice/shared';
import { eventBus } from '../events/event-bus.js';
import { createChildLogger } from '../telemetry/logger.js';
import { streamHealthGauge, streamReconnectCounter } from '../telemetry/metrics.js';

const log = createChildLogger('stream-health');

export class StreamHealthMonitor {
  private status: StreamStatus = StreamStatus.DISCONNECTED;
  private lastMessageAt: number = 0;
  private reconnectCount: number = 0;
  private startedAt: number = 0;
  private messagesReceived: number = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.startedAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      this.checkHealth();
    }, STREAM_HEARTBEAT_INTERVAL_MS);

    log.info('stream health monitor started');
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Called when a message is received from the stream.
   */
  onMessage(): void {
    this.lastMessageAt = Date.now();
    this.messagesReceived++;

    if (this.status !== StreamStatus.CONNECTED) {
      this.setStatus(StreamStatus.CONNECTED);
    }
  }

  /**
   * Called when the stream connects.
   */
  onConnect(): void {
    this.lastMessageAt = Date.now();
    this.setStatus(StreamStatus.CONNECTED);
    (eventBus as any).emit(EVENTS.STREAM_CONNECTED);
  }

  /**
   * Called when the stream disconnects.
   */
  onDisconnect(reason: string): void {
    this.setStatus(StreamStatus.DISCONNECTED);
    (eventBus as any).emit(EVENTS.STREAM_DISCONNECTED, { reason });
  }

  /**
   * Called when a reconnection attempt starts.
   */
  onReconnecting(): void {
    this.reconnectCount++;
    this.setStatus(StreamStatus.RECONNECTING);
    streamReconnectCounter.inc();
    (eventBus as any).emit(EVENTS.STREAM_RECONNECTING, { attempt: this.reconnectCount });
  }

  private checkHealth(): void {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageAt;

    if (
      this.status === StreamStatus.CONNECTED &&
      timeSinceLastMessage > STREAM_STALE_THRESHOLD_MS
    ) {
      this.setStatus(StreamStatus.DEGRADED);
      eventBus.emit(EVENTS.STREAM_DEGRADED, this.getHealthData());

      log.warn(
        { timeSinceLastMessageMs: timeSinceLastMessage },
        'stream degraded — no messages received',
      );
    } else if (
      this.status === StreamStatus.DEGRADED &&
      timeSinceLastMessage <= STREAM_STALE_THRESHOLD_MS
    ) {
      this.setStatus(StreamStatus.CONNECTED);
      eventBus.emit(EVENTS.STREAM_HEALTHY, this.getHealthData());
    }
  }

  private setStatus(newStatus: StreamStatus): void {
    if (this.status === newStatus) return;

    const oldStatus = this.status;
    this.status = newStatus;

    streamHealthGauge.set(
      newStatus === StreamStatus.CONNECTED ? 1 : 0,
    );

    log.info(
      { from: oldStatus, to: newStatus },
      'stream status changed',
    );
  }

  getHealthData(): StreamHealthData {
    const now = Date.now();
    const elapsedSec = (now - this.startedAt) / 1000;

    return {
      status: this.status,
      lastMessageAt: this.lastMessageAt,
      reconnectCount: this.reconnectCount,
      uptimeMs: now - this.startedAt,
      messagesPerSecond:
        elapsedSec > 0 ? this.messagesReceived / elapsedSec : 0,
    };
  }

  getStatus(): StreamStatus {
    return this.status;
  }
}

export const streamHealthMonitor = new StreamHealthMonitor();
