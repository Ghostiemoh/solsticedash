// ============================================================
// Solstice Shared Constants
// ============================================================

// ─── Solana Timing Constants ───────────────────────────────

export const SLOT_DURATION_MS = 400;
export const SLOTS_PER_LEADER = 4;
export const LEADER_WINDOW_MS = SLOT_DURATION_MS * SLOTS_PER_LEADER;
export const SLOTS_PER_EPOCH = 432_000;
export const BLOCKHASH_EXPIRY_SLOTS = 150;
export const BLOCKHASH_EXPIRY_MS = BLOCKHASH_EXPIRY_SLOTS * SLOT_DURATION_MS;

// ─── Compute Budget Constants ──────────────────────────────

export const MAX_COMPUTE_UNITS_PER_TX = 1_400_000;
export const DEFAULT_COMPUTE_UNITS = 200_000;
export const MAX_COMPUTE_UNITS_PER_BLOCK = 48_000_000;
export const COMPUTE_UNIT_BUFFER_PERCENT = 10;

// ─── Jito Constants ────────────────────────────────────────

export const MAX_BUNDLE_SIZE = 5;
export const MIN_TIP_LAMPORTS = 1_000;
export const DEFAULT_TIP_LAMPORTS = 10_000;
export const MAX_TIP_LAMPORTS = 1_000_000;
export const JITO_TIP_PROGRAM_ID = 'T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt';

export const JITO_BLOCK_ENGINE_URLS = {
  global: 'https://mainnet.block-engine.jito.wtf',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  newYork: 'https://ny.mainnet.block-engine.jito.wtf',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
} as const;

// ─── Retry Constants ───────────────────────────────────────

export const MAX_RETRY_ATTEMPTS = 5;
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_MAX_DELAY_MS = 30_000;
export const RETRY_JITTER_MAX_MS = 200;

// ─── Circuit Breaker Constants ─────────────────────────────

export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 30_000;
export const CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS = 3;

// ─── AI Decision Constants ─────────────────────────────────

export const AI_MIN_CONFIDENCE_THRESHOLD = 0.3;
export const AI_MAX_TIP_MULTIPLIER = 2.0;
export const AI_MAX_DELAY_MS = 60_000;
export const AI_DECISION_TIMEOUT_MS = 5_000;

// ─── Streaming Constants ───────────────────────────────────

export const STREAM_RECONNECT_BASE_DELAY_MS = 1_000;
export const STREAM_RECONNECT_MAX_DELAY_MS = 30_000;
export const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;
export const STREAM_STALE_THRESHOLD_MS = 15_000;

// ─── Priority Fee Constants ────────────────────────────────

export const PRIORITY_FEE_POLL_INTERVAL_MS = 5_000;
export const PRIORITY_FEE_WINDOW_SIZE = 20;
export const PRIORITY_FEE_DEFAULT_PERCENTILE = 50;

// ─── Event Names ───────────────────────────────────────────

export const EVENTS = {
  SLOT_NEW: 'slot:new',
  SLOT_CONFIRMED: 'slot:confirmed',
  SLOT_FINALIZED: 'slot:finalized',
  LEADER_CURRENT: 'leader:current',
  LEADER_UPCOMING: 'leader:upcoming',
  JITO_LEADER_UPCOMING: 'jito:leader:upcoming',
  TX_CREATED: 'tx:created',
  TX_SIMULATED: 'tx:simulated',
  TX_SIGNED: 'tx:signed',
  TX_SUBMITTED: 'tx:submitted',
  TX_PROCESSED: 'tx:processed',
  TX_CONFIRMED: 'tx:confirmed',
  TX_FINALIZED: 'tx:finalized',
  TX_FAILED: 'tx:failed',
  TX_RETRYING: 'tx:retrying',
  TX_ABANDONED: 'tx:abandoned',
  BUNDLE_CREATED: 'bundle:created',
  BUNDLE_SENT: 'bundle:sent',
  BUNDLE_LANDED: 'bundle:landed',
  BUNDLE_DROPPED: 'bundle:dropped',
  BUNDLE_REJECTED: 'bundle:rejected',
  RETRY_SCHEDULED: 'retry:scheduled',
  RETRY_EXECUTING: 'retry:executing',
  RETRY_SUCCEEDED: 'retry:succeeded',
  RETRY_EXHAUSTED: 'retry:exhausted',
  AI_DECISION_REQUESTED: 'ai:decision:requested',
  AI_DECISION_RECEIVED: 'ai:decision:received',
  AI_DECISION_FALLBACK: 'ai:decision:fallback',
  CIRCUIT_OPENED: 'circuit:opened',
  CIRCUIT_CLOSED: 'circuit:closed',
  CIRCUIT_HALF_OPEN: 'circuit:halfopen',
  STREAM_CONNECTED: 'stream:connected',
  STREAM_DISCONNECTED: 'stream:disconnected',
  STREAM_RECONNECTING: 'stream:reconnecting',
  STREAM_DEGRADED: 'stream:degraded',
  STREAM_HEALTHY: 'stream:healthy',
  CONGESTION_UPDATE: 'congestion:update',
  SYSTEM_SHUTDOWN: 'system:shutdown',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
