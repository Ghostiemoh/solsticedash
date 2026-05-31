// ============================================================
// Transaction Builder
// ============================================================
// Builds versioned transactions (v0) with automatic compute
// budget instructions. Handles blockhash management and
// instruction composition.
// ============================================================

import {
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
  type PublicKey,
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { rpcManager } from './rpc-manager.js';
import { walletManager } from './wallet-manager.js';
import { createChildLogger } from '../telemetry/logger.js';
import {
  DEFAULT_COMPUTE_UNITS,
  COMPUTE_UNIT_BUFFER_PERCENT,
} from '@solstice/shared';

const log = createChildLogger('tx-builder');

export interface BuildTransactionOptions {
  instructions: TransactionInstruction[];
  payer?: PublicKey;
  computeUnitLimit?: number;
  computeUnitPrice?: number;
  addressLookupTables?: AddressLookupTableAccount[];
  recentBlockhash?: string;
}

export interface BuiltTransaction {
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
  computeUnitLimit: number;
  computeUnitPrice: number;
  builtAt: number;
}

export class TransactionBuilder {
  /**
   * Build a versioned transaction (v0) with compute budget instructions.
   * If computeUnitLimit is not provided, uses DEFAULT_COMPUTE_UNITS.
   * If computeUnitPrice is not provided, defaults to 0 (no priority fee).
   */
  async build(options: BuildTransactionOptions): Promise<BuiltTransaction> {
    const {
      instructions,
      payer = walletManager.publicKey,
      computeUnitLimit = DEFAULT_COMPUTE_UNITS,
      computeUnitPrice = 0,
      addressLookupTables = [],
    } = options;

    // Get fresh blockhash if not provided
    let blockhash = options.recentBlockhash;
    let lastValidBlockHeight = 0;

    if (!blockhash) {
      const result = await rpcManager.execute(
        'getLatestBlockhash',
        (conn) => conn.getLatestBlockhash('confirmed'),
      );
      blockhash = result.blockhash;
      lastValidBlockHeight = result.lastValidBlockHeight;
    }

    // Prepend compute budget instructions
    const allInstructions: TransactionInstruction[] = [];

    // Set compute unit limit (always — helps with scheduling)
    const adjustedCuLimit = Math.ceil(
      computeUnitLimit * (1 + COMPUTE_UNIT_BUFFER_PERCENT / 100),
    );
    allInstructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: adjustedCuLimit }),
    );

    // Set compute unit price (priority fee) if non-zero
    if (computeUnitPrice > 0) {
      allInstructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: computeUnitPrice,
        }),
      );
    }

    // Add user instructions
    allInstructions.push(...instructions);

    // Build the versioned message
    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message(
      addressLookupTables.length > 0 ? addressLookupTables : undefined,
    );

    const transaction = new VersionedTransaction(messageV0);

    log.debug(
      {
        instructionCount: allInstructions.length,
        computeUnitLimit: adjustedCuLimit,
        computeUnitPrice,
        blockhash: blockhash.slice(0, 12) + '...',
      },
      'transaction built',
    );

    return {
      transaction,
      blockhash,
      lastValidBlockHeight,
      computeUnitLimit: adjustedCuLimit,
      computeUnitPrice,
      builtAt: Date.now(),
    };
  }

  /**
   * Rebuild a transaction with a fresh blockhash.
   * Used during retry when the original blockhash has expired.
   */
  async rebuild(
    originalOptions: BuildTransactionOptions,
  ): Promise<BuiltTransaction> {
    log.debug('rebuilding transaction with fresh blockhash');
    // Force a fresh blockhash by not passing the old one
    return this.build({
      ...originalOptions,
      recentBlockhash: undefined,
    });
  }
}

export const transactionBuilder = new TransactionBuilder();
