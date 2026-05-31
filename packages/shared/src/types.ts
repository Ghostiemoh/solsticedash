// ============================================================
// Solstice Shared Types
// ============================================================
// Canonical type definitions shared across backend and dashboard.
// Every subsystem references these types.
// ============================================================

// ─── Transaction Lifecycle ──────────────────────────────────

export enum TransactionStatus {
  CREATED = 'CREATED',
  SIMULATED = 'SIMULATED',
  SIGNED = 'SIGNED',
  BUNDLED = 'BUNDLED',
  SUBMITTED = 'SUBMITTED',
  PROCESSED = 'PROCESSED',
  CONFIRMED = 'CONFIRMED',
  FINALIZED = 'FINALIZED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  ABANDONED = 'ABANDONED',
}

export interface TransactionLifecycle {
  id: string;
  signature: string | null;
  status: TransactionStatus;
  createdAt: number;
  simulatedAt: number | null;
  signedAt: number | null;
  bundledAt: number | null;
  submittedAt: number | null;
  processedAt: number | null;
  confirmedAt: number | null;
  finalizedAt: number | null;
  failedAt: number | null;
  abandonedAt: number | null;
  slot: number | null;
  leader: string | null;
  bundleId: string | null;
  tipLamports: number | null;
  computeUnitsConsumed: number | null;
  computeUnitLimit: number | null;
  computeUnitPrice: number | null;
  retryCount: number;
  lastError: string | null;
  failureCategory: FailureCategory | null;
  metadata?: Record<string, any>;
  aiDecision?: AiDecisionRecord | null;
}

// ─── Failure Categories ────────────────────────────────────

export enum FailureCategory {
  BLOCKHASH_EXPIRED = 'BLOCKHASH_EXPIRED',
  BUNDLE_DROPPED = 'BUNDLE_DROPPED',
  LOW_TIP = 'LOW_TIP',
  COMPUTE_EXHAUSTED = 'COMPUTE_EXHAUSTED',
  SIMULATION_FAILED = 'SIMULATION_FAILED',
  ACCOUNT_CONTENTION = 'ACCOUNT_CONTENTION',
  CONGESTION = 'CONGESTION',
  RPC_FAILURE = 'RPC_FAILURE',
  LEADER_MISS = 'LEADER_MISS',
  SLOT_TIMING = 'SLOT_TIMING',
  UNKNOWN = 'UNKNOWN',
}

// ─── Bundle Types ──────────────────────────────────────────

export enum BundleStatus {
  CREATED = 'CREATED',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  PROCESSED = 'PROCESSED',
  LANDED = 'LANDED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  DROPPED = 'DROPPED',
}

export interface BundleRecord {
  id: string;
  bundleId: string | null;
  status: BundleStatus;
  transactionIds: string[];
  tipLamports: number;
  tipAccount: string;
  leader: string | null;
  slot: number | null;
  sentAt: number;
  landedAt: number | null;
  rejectedAt: number | null;
  rejectionReason: string | null;
  retryOf: string | null;
}

// ─── AI Decision Types ─────────────────────────────────────

export interface AiDecisionContext {
  currentSlot: number;
  upcomingLeaders: LeaderInfo[];
  congestionLevel: CongestionLevel;
  recentFailures: FailureSummary[];
  retryHistory: RetryHistoryEntry[];
  bundlePerformance: BundlePerformanceMetrics;
  latencyMetrics: LatencyMetrics;
  currentTipLamports: number;
  transactionAge: number;
  retryCount: number;
}

export interface AiDecisionResponse {
  shouldRetry: boolean;
  newTipLamports: number | null;
  delayMs: number;
  splitBundle: boolean;
  waitForJitoLeader: boolean;
  abandonTransaction: boolean;
  adjustComputeUnits: number | null;
  rebroadcast: boolean;
  confidence: number;
  reasoning: string;
}

export interface AiDecisionRecord {
  id: string;
  transactionId: string;
  context: AiDecisionContext;
  decision: AiDecisionResponse;
  timestamp: number;
  modelUsed: string;
  latencyMs: number;
  wasOverridden: boolean;
  overrideReason: string | null;
  outcome: AiDecisionOutcome | null;
}

export enum AiDecisionOutcome {
  SUCCESS = 'SUCCESS',
  FAILED_AGAIN = 'FAILED_AGAIN',
  ABANDONED = 'ABANDONED',
  PENDING = 'PENDING',
}

// ─── Leader Types ──────────────────────────────────────────

export interface LeaderInfo {
  slot: number;
  validator: string;
  isJitoValidator: boolean;
  slotsUntil: number;
}

// ─── Congestion Types ──────────────────────────────────────

export enum CongestionLevel {
  LOW = 'LOW',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface CongestionMetrics {
  level: CongestionLevel;
  slotRate: number;
  skipRate: number;
  avgPriorityFee: number;
  p50PriorityFee: number;
  p90PriorityFee: number;
  recentLandingRate: number;
  timestamp: number;
}

// ─── Metrics Types ─────────────────────────────────────────

export interface FailureSummary {
  category: FailureCategory;
  count: number;
  lastOccurrence: number;
}

export interface RetryHistoryEntry {
  attempt: number;
  timestamp: number;
  failureCategory: FailureCategory;
  tipLamports: number;
  outcome: 'SUCCESS' | 'FAILED';
}

export interface BundlePerformanceMetrics {
  totalSent: number;
  totalLanded: number;
  totalDropped: number;
  landingRate: number;
  avgTipLanded: number;
  avgTipDropped: number;
  avgLatencyMs: number;
}

export interface LatencyMetrics {
  rpcLatencyMs: number;
  streamLatencyMs: number;
  bundleSubmitLatencyMs: number;
  simulationLatencyMs: number;
  aiDecisionLatencyMs: number;
}

// ─── WebSocket Event Types ─────────────────────────────────

export enum WsEventType {
  SLOT_UPDATE = 'slot:update',
  LEADER_UPDATE = 'leader:update',
  LEADER_UPCOMING = 'leader:upcoming',
  BUNDLE_UPDATE = 'bundle:update',
  LIFECYCLE_UPDATE = 'lifecycle:update',
  RETRY_EVENT = 'retry:event',
  AI_DECISION = 'ai:decision',
  CONGESTION_UPDATE = 'congestion:update',
  STREAM_HEALTH = 'stream:health',
  METRICS_SNAPSHOT = 'metrics:snapshot',
  SYSTEM_HEALTH = 'system:health',
}

export interface WsMessage<T = unknown> {
  type: WsEventType;
  data: T;
  timestamp: number;
}

// ─── Slot Data ─────────────────────────────────────────────

export interface SlotUpdate {
  slot: number;
  parent: number;
  status: 'processed' | 'confirmed' | 'finalized';
  timestamp: number;
}

// ─── Stream Health ─────────────────────────────────────────

export enum StreamStatus {
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  DISCONNECTED = 'DISCONNECTED',
  DEGRADED = 'DEGRADED',
}

export interface StreamHealthData {
  status: StreamStatus;
  lastMessageAt: number;
  reconnectCount: number;
  uptimeMs: number;
  messagesPerSecond: number;
}

// ─── System Health ─────────────────────────────────────────

export interface SystemHealth {
  rpc: SubsystemHealth;
  stream: SubsystemHealth;
  redis: SubsystemHealth;
  postgres: SubsystemHealth;
  jito: SubsystemHealth;
  ai: SubsystemHealth;
}

export interface SubsystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number | null;
  lastCheckedAt: number;
  message: string | null;
}

// ─── Circuit Breaker ───────────────────────────────────────

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerStatus {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number | null;
  nextRetryAt: number | null;
}
