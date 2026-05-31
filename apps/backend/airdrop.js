import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { Connection, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

async function run() {
  const privateKeyStr = process.env.WALLET_PRIVATE_KEY;
  if (!privateKeyStr) {
    console.error("No WALLET_PRIVATE_KEY found in .env");
    return;
  }
  
  const decoded = bs58.decode(privateKeyStr);
  const keypair = Keypair.fromSecretKey(decoded);
  const pubkey = keypair.publicKey;
  
  console.log("Wallet Public Key:", pubkey.toBase58());
  
  const devnetUrl = 'https://api.devnet.solana.com';
  console.log("Connecting to:", devnetUrl);
  const connection = new Connection(devnetUrl, 'confirmed');
  
  try {
    const balance = await connection.getBalance(pubkey);
    console.log("Current balance:", balance / LAMPORTS_PER_SOL, "SOL");
    
    if (balance === 0) {
      console.log("Requesting 1 SOL airdrop...");
      const signature = await connection.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
      
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash
      });
      
      const newBalance = await connection.getBalance(pubkey);
      console.log("Airdrop successful! New balance:", newBalance / LAMPORTS_PER_SOL, "SOL");
    } else {
      console.log("Wallet already has SOL. No airdrop needed.");
    }
  } catch (err) {
    console.error("Airdrop failed:", err.message);
  }
}

run().catch(console.error);
