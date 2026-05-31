// ============================================================
// Prometheus Metrics
// ============================================================
// All Solstice metrics registered with prom-client.
// Exposed via /metrics endpoint for Prometheus scraping.
// ============================================================

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

export const bundleSubmitLatencyHistogram = new Histogram({
  name: 'solstice_bundle_submit_latency_seconds',
  help: 'Latency of Jito bundle submission in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
  registers: [metricsRegistry],
});

export const currentSlotGauge = new Gauge({
  name: 'solstice_current_slot',
  help: 'The current slot being processed',
  registers: [metricsRegistry],
});

// ─── Slot Metrics ──────────────────────────────────────────

export const slotCurrentGauge = new Gauge({
  name: 'solstice_slot_current',
  help: 'Current Solana slot number',
  registers: [metricsRegistry],
});

export const slotRateGauge = new Gauge({
  name: 'solstice_slot_rate_per_second',
  help: 'Slots observed per second (rolling average)',
  registers: [metricsRegistry],
});

// ─── Bundle Metrics ────────────────────────────────────────

export const bundleSubmittedCounter = new Counter({
  name: 'solstice_bundle_submitted_total',
  help: 'Total bundles submitted to Jito',
  registers: [metricsRegistry],
});

export const bundleLandedCounter = new Counter({
  name: 'solstice_bundle_landed_total',
  help: 'Total bundles that landed on-chain',
  registers: [metricsRegistry],
});

export const bundleDroppedCounter = new Counter({
  name: 'solstice_bundle_dropped_total',
  help: 'Total bundles dropped or rejected',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

export const tipAmountHistogram = new Histogram({
  name: 'solstice_tip_amount_lamports',
  help: 'Tip amounts in lamports for bundle submissions',
  buckets: [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000],
  registers: [metricsRegistry],
});

// ─── Transaction Lifecycle Metrics ─────────────────────────

export const lifecycleDurationHistogram = new Histogram({
  name: 'solstice_transaction_lifecycle_duration_seconds',
  help: 'Time from transaction creation to final state',
  labelNames: ['final_status'] as const,
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [metricsRegistry],
});

export const transactionStatusGauge = new Gauge({
  name: 'solstice_transaction_status_count',
  help: 'Count of transactions by current status',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

// ─── Retry Metrics ─────────────────────────────────────────

export const retryCounter = new Counter({
  name: 'solstice_retry_total',
  help: 'Total retry attempts by failure category',
  labelNames: ['category'] as const,
  registers: [metricsRegistry],
});

export const retrySuccessCounter = new Counter({
  name: 'solstice_retry_success_total',
  help: 'Total successful retries by category',
  labelNames: ['category'] as const,
  registers: [metricsRegistry],
});

// ─── AI Decision Metrics ───────────────────────────────────

export const aiDecisionCounter = new Counter({
  name: 'solstice_ai_decision_total',
  help: 'Total AI decisions by action taken',
  labelNames: ['action'] as const,
  registers: [metricsRegistry],
});

export const aiConfidenceHistogram = new Histogram({
  name: 'solstice_ai_decision_confidence',
  help: 'AI decision confidence scores distribution',
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  registers: [metricsRegistry],
});

export const aiLatencyHistogram = new Histogram({
  name: 'solstice_ai_decision_latency_seconds',
  help: 'AI decision engine latency',
  buckets: [0.1, 0.2, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

// ─── Stream Metrics ────────────────────────────────────────

export const streamReconnectCounter = new Counter({
  name: 'solstice_stream_reconnect_total',
  help: 'Total Yellowstone stream reconnection attempts',
  registers: [metricsRegistry],
});

export const streamHealthGauge = new Gauge({
  name: 'solstice_stream_healthy',
  help: 'Stream health status (1 = healthy, 0 = unhealthy)',
  registers: [metricsRegistry],
});

// ─── RPC Metrics ───────────────────────────────────────────

export const rpcLatencyHistogram = new Histogram({
  name: 'solstice_rpc_latency_seconds',
  help: 'RPC call latency by endpoint and method',
  labelNames: ['endpoint', 'method'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const rpcErrorCounter = new Counter({
  name: 'solstice_rpc_error_total',
  help: 'RPC errors by endpoint and error type',
  labelNames: ['endpoint', 'error_type'] as const,
  registers: [metricsRegistry],
});

// ─── Priority Fee Metrics ──────────────────────────────────

export const priorityFeeGauge = new Gauge({
  name: 'solstice_priority_fee_lamports',
  help: 'Current priority fee in microLamports (by percentile)',
  labelNames: ['percentile'] as const,
  registers: [metricsRegistry],
});

// ─── Congestion Metrics ────────────────────────────────────

export const congestionLevelGauge = new Gauge({
  name: 'solstice_congestion_level',
  help: 'Network congestion level (0=low, 1=moderate, 2=high, 3=critical)',
  registers: [metricsRegistry],
});

// ─── Circuit Breaker Metrics ───────────────────────────────

export const circuitBreakerGauge = new Gauge({
  name: 'solstice_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['subsystem'] as const,
  registers: [metricsRegistry],
});
