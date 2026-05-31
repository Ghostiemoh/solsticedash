// ============================================================
// Vitest Setup
// ============================================================
// Populates a valid test environment BEFORE any backend module
// (which eagerly validates env via config/env.ts and loads a
// signing keypair) is imported. Runs once per test file.
// ============================================================

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

process.env.NODE_ENV = 'test';
process.env.MOCK_MODE = 'true';
process.env.LOG_LEVEL = 'fatal';

process.env.SOLANA_RPC_URL ??= 'https://api.devnet.solana.com';
process.env.SOLANA_NETWORK ??= 'devnet';
process.env.YELLOWSTONE_GRPC_URL ??= 'http://localhost:10000';
process.env.YELLOWSTONE_GRPC_TOKEN ??= 'test-token';
// A real, decodable keypair so wallet-manager construction succeeds.
process.env.WALLET_PRIVATE_KEY ??= bs58.encode(Keypair.generate().secretKey);
process.env.GEMINI_API_KEY ??= 'test-gemini-key';
process.env.DATABASE_URL ??= 'file:./test.db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
