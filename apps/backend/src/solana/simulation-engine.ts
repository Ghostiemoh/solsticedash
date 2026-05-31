// ============================================================
// Simulation Engine
// ============================================================
// Simulates transactions before submission to detect errors,
// extract compute unit consumption, and validate viability.
// Critical for avoiding wasted tips on bundles that would fail.
// ============================================================

import {
  type VersionedTransaction,
  type SimulatedTransactionResponse,
} from '@solana/web3.js';
import { rpcManager } from './rpc-manager.js';
import { createChildLogger } from '../telemetry/logger.js';

const log = createChildLogger('simulation');

export interface SimulationResult {
  success: boolean;
  computeUnitsConsumed: number | null;
  logs: string[];
  error: string | null;
  errorCode: number | null;
  simulatedAt: number;
  latencyMs: number;
}

export class SimulationEngine {
  /**
   * Simulate a transaction to check for errors and get CU consumption.
   * This is a critical pre-flight check — never submit without simulating.
   */
  async simulate(transaction: VersionedTransaction): Promise<SimulationResult> {
    const startTime = performance.now();

    try {
      const response = await rpcManager.execute(
        'simulateTransaction',
        (conn) =>
          conn.simulateTransaction(transaction, {
            replaceRecentBlockhash: true,
            sigVerify: false,
            commitment: 'processed',
          }),
      );

      const latencyMs = performance.now() - startTime;
      const result = this.parseSimulationResponse(response.value, latencyMs);

      if (result.success) {
        log.debug(
          {
            computeUnits: result.computeUnitsConsumed,
            latencyMs: Math.round(latencyMs),
          },
          'simulation succeeded',
        );
      } else {
        log.warn(
          {
            error: result.error,
            errorCode: result.errorCode,
            latencyMs: Math.round(latencyMs),
          },
          'simulation failed',
        );
      }

      return result;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      log.error(
        { error: errorMessage, latencyMs: Math.round(latencyMs) },
        'simulation RPC error',
      );

      return {
        success: false,
        computeUnitsConsumed: null,
        logs: [],
        error: errorMessage,
        errorCode: null,
        simulatedAt: Date.now(),
        latencyMs,
      };
    }
  }

  private parseSimulationResponse(
    response: SimulatedTransactionResponse,
    latencyMs: number,
  ): SimulationResult {
    const { err, logs, unitsConsumed } = response;

    if (err) {
      const errorStr =
        typeof err === 'string' ? err : JSON.stringify(err);

      // Extract error code if available
      let errorCode: number | null = null;
      if (typeof err === 'object' && err !== null && 'InstructionError' in err) {
        const instructionError = (err as Record<string, unknown>)['InstructionError'];
        if (Array.isArray(instructionError) && instructionError.length >= 2) {
          const customError = instructionError[1];
          if (
            typeof customError === 'object' &&
            customError !== null &&
            'Custom' in customError
          ) {
            errorCode = (customError as Record<string, number>)['Custom'] ?? null;
          }
        }
      }

      return {
        success: false,
        computeUnitsConsumed: unitsConsumed ?? null,
        logs: logs ?? [],
        error: errorStr,
        errorCode,
        simulatedAt: Date.now(),
        latencyMs,
      };
    }

    return {
      success: true,
      computeUnitsConsumed: unitsConsumed ?? null,
      logs: logs ?? [],
      error: null,
      errorCode: null,
      simulatedAt: Date.now(),
      latencyMs,
    };
  }
}

export const simulationEngine = new SimulationEngine();
