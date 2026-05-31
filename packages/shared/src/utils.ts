// ============================================================
// Solstice Shared Utilities
// ============================================================

import { RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS, RETRY_JITTER_MAX_MS } from './constants.js';

/**
 * Generate a unique ID using crypto.randomUUID with a prefix.
 */
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * Calculate exponential backoff delay with jitter.
 * Formula: min(base * 2^attempt + random_jitter, maxDelay)
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number = RETRY_BASE_DELAY_MS,
  maxDelay: number = RETRY_MAX_DELAY_MS,
  jitterMax: number = RETRY_JITTER_MAX_MS,
): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * jitterMax;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Convert lamports to SOL with fixed decimal places.
 */
export function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(9);
}

/**
 * Convert SOL to lamports.
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * 1_000_000_000);
}

/**
 * Format a slot number for display.
 */
export function formatSlot(slot: number): string {
  return slot.toLocaleString('en-US');
}

/**
 * Calculate the epoch from a slot number.
 */
export function slotToEpoch(slot: number, slotsPerEpoch: number = 432_000): number {
  return Math.floor(slot / slotsPerEpoch);
}

/**
 * Calculate the position within the leader's 4-slot window.
 * Returns 0-3 indicating which of the 4 consecutive leader slots we're in.
 */
export function leaderSlotPosition(slot: number): number {
  return slot % 4;
}

/**
 * Truncate a public key for display: "Abc1...xyz9"
 */
export function truncatePublicKey(pubkey: string, chars: number = 4): string {
  if (pubkey.length <= chars * 2 + 3) return pubkey;
  return `${pubkey.slice(0, chars)}...${pubkey.slice(-chars)}`;
}

/**
 * Calculate elapsed time in human-readable format.
 */
export function elapsed(startMs: number, endMs: number = Date.now()): string {
  const diffMs = endMs - startMs;
  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60_000) return `${(diffMs / 1000).toFixed(1)}s`;
  if (diffMs < 3_600_000) return `${(diffMs / 60_000).toFixed(1)}m`;
  return `${(diffMs / 3_600_000).toFixed(1)}h`;
}

/**
 * Clamp a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate percentile from a sorted array of numbers.
 */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)] ?? 0;
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a timeout-wrapped promise.
 * Rejects with an error if the operation takes longer than timeoutMs.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Chunk an array into groups of a given size.
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
