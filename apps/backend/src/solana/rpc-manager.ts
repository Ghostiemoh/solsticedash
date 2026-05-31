// ============================================================
// RPC Connection Manager
// ============================================================
// Manages multiple Solana RPC connections with automatic failover,
// latency tracking, and request metrics. Provides a resilient
// connection layer for all Solana operations.
// ============================================================

import { Connection, type Commitment } from '@solana/web3.js';
import { env } from '../config/env.js';
import { createChildLogger } from '../telemetry/logger.js';
import { rpcLatencyHistogram, rpcErrorCounter } from '../telemetry/metrics.js';

const log = createChildLogger('rpc-manager');

interface RpcEndpoint {
  url: string;
  label: string;
  connection: Connection;
  isHealthy: boolean;
  avgLatencyMs: number;
  totalRequests: number;
  totalErrors: number;
  lastErrorAt: number | null;
}

export class RpcManager {
  private endpoints: RpcEndpoint[] = [];
  private activeIndex = 0;
  private readonly defaultCommitment: Commitment;

  constructor(commitment: Commitment = 'confirmed') {
    this.defaultCommitment = commitment;
    this.initializeEndpoints();
    log.info(
      { endpointCount: this.endpoints.length, commitment },
      'RPC manager initialized',
    );
  }

  private initializeEndpoints(): void {
    let primaryUrl = env.SOLANA_RPC_URL;
    let backupUrl = env.SOLANA_RPC_BACKUP_URL;

    if (env.SOLANA_NETWORK === 'devnet') {
      primaryUrl = env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com';
      backupUrl = 'https://api.devnet.solana.com';
    }

    const urls: Array<{ url: string; label: string }> = [
      { url: primaryUrl, label: 'primary' },
    ];

    if (backupUrl) {
      urls.push({ url: backupUrl, label: 'backup' });
    }

    this.endpoints = urls.map(({ url, label }) => ({
      url,
      label,
      connection: new Connection(url, {
        commitment: this.defaultCommitment,
        confirmTransactionInitialTimeout: 30_000,
        disableRetryOnRateLimit: false,
      }),
      isHealthy: true,
      avgLatencyMs: 0,
      totalRequests: 0,
      totalErrors: 0,
      lastErrorAt: null,
    }));
  }

  /**
   * Get the active connection. Auto-failover on repeated errors.
   */
  getConnection(): Connection {
    const endpoint = this.endpoints[this.activeIndex];
    if (!endpoint) {
      throw new Error('no RPC endpoints configured');
    }
    return endpoint.connection;
  }

  /**
   * Get a connection with a specific commitment level.
   */
  getConnectionWithCommitment(commitment: Commitment): Connection {
    const endpoint = this.endpoints[this.activeIndex];
    if (!endpoint) {
      throw new Error('no RPC endpoints configured');
    }
    return new Connection(endpoint.url, { commitment });
  }

  /**
   * Execute an RPC call with automatic latency tracking, error handling,
   * and failover on failure.
   */
  async execute<T>(
    method: string,
    operation: (connection: Connection) => Promise<T>,
  ): Promise<T> {
    if (env.MOCK_MODE) {
      log.debug({ method }, 'Mock RPC execution');
      await new Promise((resolve) => setTimeout(resolve, 50)); // simulate latency
      if (method === 'getLatestBlockhash') {
        return {
          blockhash: '5TZZ6t41vEEdc7B89W7L5kR89W7L5kR89W7L5kR89W7L',
          lastValidBlockHeight: 999999999,
        } as unknown as T;
      }
      if (method === 'simulateTransaction') {
        return {
          value: {
            err: null,
            logs: ['Program Log: Instruction simulated successfully', 'Program Log: Mock trace success'],
            unitsConsumed: 1200,
          },
        } as unknown as T;
      }
      if (method === 'getEpochInfo') {
        const slot = (global as any).mockCurrentSlot || 245000000;
        return {
          epoch: 620,
          absoluteSlot: slot,
          slotIndex: slot % 432000,
          slotsInEpoch: 432000,
        } as unknown as T;
      }
      if (method === 'getLeaderSchedule') {
        return {
          '4imgnHoSJhqb6MQ8cFZVzWXccKViCADxDf9Ucg471Axv': Array.from({ length: 100 }, (_, i) => i * 4),
          'MockValidator2222222222222222222222222222222': Array.from({ length: 100 }, (_, i) => i * 4 + 1),
          'MockValidator3333333333333333333333333333333': Array.from({ length: 100 }, (_, i) => i * 4 + 2),
        } as unknown as T;
      }
      if (method === 'getSignatureStatuses') {
        return {
          value: Array.from({ length: 20 }, () => ({
            slot: (global as any).mockCurrentSlot || 245000000,
            confirmations: null,
            err: null,
            confirmationStatus: 'finalized',
          })),
        } as unknown as T;
      }
      return {} as unknown as T;
    }

    const endpoint = this.endpoints[this.activeIndex];
    if (!endpoint) {
      throw new Error('no RPC endpoints available');
    }

    const startTime = performance.now();

    try {
      const result = await operation(endpoint.connection);
      const latencyMs = performance.now() - startTime;

      // Update metrics
      endpoint.totalRequests++;
      endpoint.avgLatencyMs =
        (endpoint.avgLatencyMs * (endpoint.totalRequests - 1) + latencyMs) /
        endpoint.totalRequests;
      endpoint.isHealthy = true;

      rpcLatencyHistogram
        .labels(endpoint.label, method)
        .observe(latencyMs / 1000);

      return result;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      endpoint.totalErrors++;
      endpoint.lastErrorAt = Date.now();

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorType = this.classifyError(errorMessage);

      rpcErrorCounter.labels(endpoint.label, errorType).inc();
      rpcLatencyHistogram
        .labels(endpoint.label, method)
        .observe(latencyMs / 1000);

      log.warn(
        {
          endpoint: endpoint.label,
          method,
          errorType,
          latencyMs: Math.round(latencyMs),
        },
        'RPC call failed',
      );

      // Attempt failover if we have backup endpoints
      if (
        this.shouldFailover(endpoint) &&
        this.endpoints.length > 1
      ) {
        this.failover();
        log.info(
          { from: endpoint.label, to: this.endpoints[this.activeIndex]?.label },
          'RPC failover triggered',
        );

        // Retry on the new endpoint
        return this.execute(method, operation);
      }

      throw error;
    }
  }

  private classifyError(message: string): string {
    if (message.includes('429') || message.includes('rate limit')) {
      return 'rate_limited';
    }
    if (message.includes('503') || message.includes('unavailable')) {
      return 'unavailable';
    }
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return 'timeout';
    }
    if (message.includes('ECONNREFUSED') || message.includes('ECONNRESET')) {
      return 'connection_error';
    }
    return 'unknown';
  }

  private shouldFailover(endpoint: RpcEndpoint): boolean {
    // Failover if 3+ consecutive errors in the last 30 seconds
    const recentErrorThreshold = Date.now() - 30_000;
    return (
      endpoint.totalErrors >= 3 &&
      endpoint.lastErrorAt !== null &&
      endpoint.lastErrorAt > recentErrorThreshold
    );
  }

  private failover(): void {
    const currentEndpoint = this.endpoints[this.activeIndex];
    if (currentEndpoint) {
      currentEndpoint.isHealthy = false;
    }

    // Move to next healthy endpoint
    for (let i = 1; i < this.endpoints.length; i++) {
      const nextIndex = (this.activeIndex + i) % this.endpoints.length;
      const nextEndpoint = this.endpoints[nextIndex];
      if (nextEndpoint && nextEndpoint.isHealthy) {
        this.activeIndex = nextIndex;
        return;
      }
    }

    // If no healthy endpoints, cycle to next anyway
    this.activeIndex = (this.activeIndex + 1) % this.endpoints.length;
  }

  /**
   * Health check — probe all endpoints and return status.
   */
  async checkHealth(): Promise<
    Array<{
      label: string;
      healthy: boolean;
      latencyMs: number;
    }>
  > {
    if (env.MOCK_MODE) {
      return this.endpoints.map((ep) => ({
        label: ep.label,
        healthy: true,
        latencyMs: 15,
      }));
    }

    const results = await Promise.allSettled(
      this.endpoints.map(async (endpoint) => {
        const start = performance.now();
        try {
          await endpoint.connection.getSlot();
          const latency = performance.now() - start;
          endpoint.isHealthy = true;
          return { label: endpoint.label, healthy: true, latencyMs: Math.round(latency) };
        } catch {
          endpoint.isHealthy = false;
          return { label: endpoint.label, healthy: false, latencyMs: -1 };
        }
      }),
    );

    return results.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { label: 'unknown', healthy: false, latencyMs: -1 },
    );
  }

  /**
   * Get stats for observability.
   */
  getStats(): Array<{
    label: string;
    isActive: boolean;
    isHealthy: boolean;
    avgLatencyMs: number;
    totalRequests: number;
    totalErrors: number;
  }> {
    return this.endpoints.map((ep, idx) => ({
      label: ep.label,
      isActive: idx === this.activeIndex,
      isHealthy: ep.isHealthy,
      avgLatencyMs: Math.round(ep.avgLatencyMs),
      totalRequests: ep.totalRequests,
      totalErrors: ep.totalErrors,
    }));
  }
}

export const rpcManager = new RpcManager();
