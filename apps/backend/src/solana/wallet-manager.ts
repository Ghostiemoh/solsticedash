// ============================================================
// Wallet Manager
// ============================================================
// Loads and manages the signing keypair from environment.
// Provides signing interface for transactions.
// ============================================================

import { Keypair, type Signer } from '@solana/web3.js';
import bs58 from 'bs58';
import { env } from '../config/env.js';
import { createChildLogger } from '../telemetry/logger.js';
import { truncatePublicKey } from '@solstice/shared';

const log = createChildLogger('wallet-manager');

export class WalletManager {
  private keypair: Keypair;

  constructor() {
    this.keypair = this.loadKeypair();
    log.info(
      { publicKey: truncatePublicKey(this.keypair.publicKey.toBase58()) },
      'wallet loaded',
    );
  }

  private loadKeypair(): Keypair {
    const privateKeyStr = env.WALLET_PRIVATE_KEY;

    try {
      // Try base58 first
      const decoded = bs58.decode(privateKeyStr);
      return Keypair.fromSecretKey(decoded);
    } catch {
      // Try JSON array format
      try {
        const parsed = JSON.parse(privateKeyStr) as number[];
        return Keypair.fromSecretKey(Uint8Array.from(parsed));
      } catch {
        throw new Error(
          'WALLET_PRIVATE_KEY must be a base58-encoded private key or JSON array of bytes',
        );
      }
    }
  }

  get publicKey() {
    return this.keypair.publicKey;
  }

  get signer(): Signer {
    return this.keypair;
  }

  getKeypair(): Keypair {
    return this.keypair;
  }
}

export const walletManager = new WalletManager();
