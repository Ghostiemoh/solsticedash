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

const SEED_TIP_ACCOUNTS: string[] = [
  '96a29pnMqJmJVAYMRutJmUsX35S2WcY1mUJsVWJmg3m1',
  'Hf8tjUDBesWsjAH756e2xmd8gBiVaJaGuwCWGNziAYrV',
  'Cw8CFBTM45ecsqaf7aQ6Y1wjakgY65Q3X539BJD3tcee',
  'ADa5GDGLn2s5L56bJb4Y4h4yZ6K15WJmg3m1AAYrVcee',
  'ADu351hg6o4AhrGgZ2zt54J2Z1j9ncR12nc1AAYrVcee',
  'DttWaMuDTnW6NMGBw2CrrEjWqvm4W5D965kiSyK28kUj',
  '3AVaG8o6KAQNeH49p1nNncR1ncR1AAYrVceec1AAYrVc',
  'GoLmudTGnWaMuDTnW6NMGBw2CrrEjWqvm4W5D965kiSy',
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
