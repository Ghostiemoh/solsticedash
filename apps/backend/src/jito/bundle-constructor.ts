// ============================================================
// Jito Bundle Constructor
// ============================================================
// Builds Jito-compatible bundles from 1-5 transactions.
// Automatically adds the tip instruction to the last transaction.
// Validates bundle constraints before submission.
// ============================================================

import {
  SystemProgram,
  PublicKey,
  type TransactionInstruction,
  type VersionedTransaction,
} from '@solana/web3.js';
import { walletManager } from '../solana/wallet-manager.js';
import { createChildLogger } from '../telemetry/logger.js';
import {
  MAX_BUNDLE_SIZE,
  MIN_TIP_LAMPORTS,
  generateId,
  type BundleRecord,
  BundleStatus,
} from '@solstice/shared';
import { env } from '../config/env.js';

const log = createChildLogger('bundle-constructor');

export interface BundleConstructionOptions {
  transactions: VersionedTransaction[];
  tipLamports: number;
  tipAccount: string;
}

// The 8 official Jito mainnet tip accounts (fetched live from the block engine's
// getTipAccounts on 2026-06-08). A bundle MUST transfer to one of these to be
// eligible for the auction, otherwise Jito rejects it with
// "Bundles must write lock at least one tip account to be eligible".
const SEED_TIP_ACCOUNTS: string[] = [
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
];

export class BundleConstructor {
  private tipAccounts: string[] = [...SEED_TIP_ACCOUNTS];

  /**
   * Set the list of Jito tip accounts (fetched from Jito API).
   */
  setTipAccounts(accounts: string[]): void {
    this.tipAccounts = accounts.length > 0 ? accounts : [...SEED_TIP_ACCOUNTS];
    log.info({ count: this.tipAccounts.length }, 'tip accounts updated');
  }

  /**
   * Get a random tip account from the pool.
   */
  getRandomTipAccount(): string {
    if (this.tipAccounts.length === 0) {
      throw new Error('No Jito tip accounts configured — call setTipAccounts() first');
    }
    const index = Math.floor(Math.random() * this.tipAccounts.length);
    return this.tipAccounts[index] ?? this.tipAccounts[0]!;
  }

  /**
   * Create a tip instruction (SOL transfer to a Jito tip account).
   */
  createTipInstruction(
    tipLamports: number,
    tipAccount: string,
  ): TransactionInstruction {
    return SystemProgram.transfer({
      fromPubkey: walletManager.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: tipLamports,
    });
  }

  /**
   * Validate bundle constraints before construction.
   */
  validate(transactions: VersionedTransaction[], tipLamports: number): string | null {
    if (transactions.length === 0) {
      return 'Bundle must contain at least 1 transaction';
    }

    if (transactions.length > MAX_BUNDLE_SIZE) {
      return `Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE} transactions (got ${transactions.length})`;
    }

    if (tipLamports < MIN_TIP_LAMPORTS) {
      return `Tip ${tipLamports} is below minimum ${MIN_TIP_LAMPORTS} lamports`;
    }

    return null;
  }

  /**
   * Build a BundleRecord for tracking.
   */
  createRecord(
    transactions: VersionedTransaction[],
    tipLamports: number,
    tipAccount: string,
  ): BundleRecord {
    return {
      id: generateId('bnd'),
      bundleId: null,
      status: BundleStatus.CREATED,
      transactionIds: [],
      tipLamports,
      tipAccount,
      leader: null,
      slot: null,
      sentAt: Date.now(),
      landedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      retryOf: null,
    };
  }
}

export const bundleConstructor = new BundleConstructor();
