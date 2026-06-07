import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from current directory first, fallback to root directory
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../..', '.env') });

const HELIUS_DEVNET = process.env.SOLANA_DEVNET_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY';
const SOLANA_DEVNET = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

async function testFetch(url, name) {
  console.log(`[Fetch] Testing ${name} (${url})...`);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }),
      timeout: 10000
    });
    console.log(`[Fetch] ${name} status: ${res.status}, response ok: ${res.ok}, latency: ${Date.now() - start}ms`);
    if (res.ok) {
      const data = await res.json();
      console.log(`[Fetch] ${name} slot:`, data.result);
    }
  } catch (err) {
    console.error(`[Fetch] ${name} failed:`, err.message);
    if (err.cause) {
      console.error(`[Fetch] ${name} cause:`, err.cause.message || err.cause);
    }
  }
}

async function testConnection(url, name) {
  console.log(`[Connection] Testing ${name} (${url})...`);
  const start = Date.now();
  try {
    const conn = new Connection(url, 'confirmed');
    const slot = await conn.getSlot();
    console.log(`[Connection] ${name} slot: ${slot}, latency: ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[Connection] ${name} failed:`, err.message);
  }
}

async function run() {
  await testFetch(SOLANA_DEVNET, 'Public Solana Devnet');
  await testConnection(SOLANA_DEVNET, 'Public Solana Devnet');
  await testFetch(HELIUS_DEVNET, 'Helius Devnet');
  await testConnection(HELIUS_DEVNET, 'Helius Devnet');
}

run().catch(console.error);
