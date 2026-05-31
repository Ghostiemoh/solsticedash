import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

async function run() {
  try {
    const keypair = Keypair.generate();
    const dest = Keypair.generate().publicKey;
    const instruction = SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: dest,
      lamports: 1000,
    });
    
    console.log("1. Building transaction...");
    const messageV0 = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: '5TZZ6t41vEEdc7B89W7L5kR89W7L5kR89W7L5kR89W7L',
      instructions: [instruction],
    }).compileToV0Message();
    
    const tx = new VersionedTransaction(messageV0);
    console.log("2. Signing transaction...");
    tx.sign([keypair]);
    
    console.log("3. Encoding signature...");
    const sig = bs58.encode(tx.signatures[0]);
    console.log("Signature:", sig);
  } catch (err) {
    console.error("Failed:", err);
    if (err.stack) {
      console.error(err.stack);
    }
  }
}

run();
