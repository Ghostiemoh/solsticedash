// ============================================================
// Jito Bundle Sender
// ============================================================
// Submits bundles to the Jito block engine via the Jito RPC API.
// Implements connection pooling, latency tracking, and failover.
// ============================================================

import { type VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { env } from '../config/env.js';
import { createChildLogger } from '../telemetry/logger.js';
import { circuitBreakers } from '../retry/circuit-breaker.js';
import { bundleSubmitLatencyHistogram } from '../telemetry/metrics.js';
import { withTimeout } from '@solstice/shared';

const log = createChildLogger('bundle-sender');

interface JitoResponse {
  jsonrpc: string;
  result?: string;
  error?: {
    code: number;
    message: string;
  };
  id: number;
}

export class BundleSender {
  private readonly endpoints: string[];

  constructor() {
    // Jito's `sendBundle` JSON-RPC is served at `/api/v1/bundles`. Posting to the
    // bare block-engine host returns HTTP 404, which silently forces every bundle
    // onto the RPC fallback. Normalize each configured endpoint to the bundles path.
    this.endpoints = env.JITO_BLOCK_ENGINE_URL.split(',')
      .map((u) => u.trim().replace(/\/+$/, ''))
      .filter((u) => u.length > 0)
      .map((u) => (u.endsWith('/api/v1/bundles') ? u : `${u}/api/v1/bundles`));
    if (this.endpoints.length === 0) {
      throw new Error('JITO_BLOCK_ENGINE_URL must contain at least one endpoint');
    }
  }

  /**
   * Submit a bundle to the Jito block engine.
   * Uses round-robin load balancing and failover across configured endpoints.
   */
  async sendBundle(
    transactions: VersionedTransaction[],
    bundleId: string,
  ): Promise<string> {
    if (env.MOCK_MODE) {
      log.info({ bundleId }, 'Mock Jito bundle submission');
      await new Promise((resolve) => setTimeout(resolve, 150));
      const mockJitoId = `mock_jito_${Math.random().toString(36).substring(2, 10)}`;
      log.info(
        { bundleId, jitoId: mockJitoId, latencyMs: 150 },
        'bundle submitted successfully (mock)',
      );
      return mockJitoId;
    }

    const startTime = performance.now();
    const serializedTxs = transactions.map((tx) =>
      bs58.encode(tx.serialize()),
    );

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [serializedTxs],
    };

    return await circuitBreakers.jito.execute(async () => {
      let lastError: Error | null = null;

      // Try each endpoint in sequence for failover
      for (const endpoint of this.endpoints) {
        try {
          log.debug({ bundleId, endpoint }, 'submitting bundle to Jito');
          
          const response = await withTimeout(
            fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }),
            20000,
            `Jito RPC POST ${endpoint}`,
          );

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(
              `HTTP ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 400)}` : ''}`,
            );
          }

          const data = (await response.json()) as JitoResponse;

          if (data.error) {
            throw new Error(`Jito RPC Error (${data.error.code}): ${data.error.message}`);
          }

          if (!data.result) {
            throw new Error('Jito RPC returned no result');
          }

          const latencyMs = performance.now() - startTime;
          bundleSubmitLatencyHistogram.observe(latencyMs / 1000);

          log.info(
            { bundleId, jitoId: data.result, latencyMs: Math.round(latencyMs) },
            'bundle submitted successfully',
          );

          return data.result; // This is the Jito bundle ID
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          log.warn(
            { bundleId, endpoint, error: lastError.message },
            'failed to submit bundle to endpoint',
          );
          // Continue to next endpoint
        }
      }

      throw new Error(
        `Failed to submit bundle across all ${this.endpoints.length} endpoints. Last error: ${lastError?.message}`,
      );
    });
  }
}

export const bundleSender = new BundleSender();
