import { Connection, PublicKey } from '@solana/web3.js';
import { walletManager } from './src/solana/wallet-manager.js';

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const pubkey = walletManager.publicKey;
  console.log('Wallet public key:', pubkey.toBase58());
  try {
    const balance = await connection.getBalance(pubkey);
    console.log('Balance (SOL):', balance / 1e9);
  } catch (error) {
    console.error('Failed to get balance:', error.message);
  }
}

main();
