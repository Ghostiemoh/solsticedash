// ============================================================
// Environment Configuration
// ============================================================
// Validates and exports all environment variables with type safety.
// Fails fast at startup if required variables are missing.
// ============================================================

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const booleanSchema = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      if (val.toLowerCase() === 'true' || val === '1') return true;
      if (val.toLowerCase() === 'false' || val === '0') return false;
    }
    return val;
  },
  z.boolean()
);

const envSchema = z.object({
  // Solana RPC
  SOLANA_RPC_URL: z.string().url('SOLANA_RPC_URL must be a valid URL'),
  // Explicit WebSocket endpoint. When unset, derived from SOLANA_RPC_URL by
  // swapping the scheme (https→wss), which is correct for solinfra.
  SOLANA_WS_URL: z.string().url().optional(),
  SOLANA_RPC_BACKUP_URL: z.string().url().optional(),
  SOLANA_DEVNET_RPC_URL: z.string().url().optional(),
  SOLANA_NETWORK: z.enum(['mainnet-beta', 'devnet']).default('mainnet-beta'),
  MOCK_MODE: booleanSchema.default(false),

  // SWQoS (stake-weighted) submission endpoint — transactions sent here are
  // forwarded through the provider's staked validator connections for higher
  // landing probability. Falls back to the primary RPC if unset.
  SWQOS_RPC_URL: z.string().url().optional(),
  // solinfra REST data API (server-to-server). Not required by the core
  // pipeline; available for balance/account REST lookups.
  SOLINFRA_REST_API_URL: z.string().url().optional(),

  // Yellowstone gRPC
  YELLOWSTONE_GRPC_URL: z.string().min(1, 'YELLOWSTONE_GRPC_URL is required'),
  YELLOWSTONE_GRPC_TOKEN: z.string().min(1, 'YELLOWSTONE_GRPC_TOKEN is required'),

  // Wallet
  WALLET_PRIVATE_KEY: z.string().min(1, 'WALLET_PRIVATE_KEY is required'),

  // Jito
  JITO_BLOCK_ENGINE_URL: z
    .string()
    .url()
    .default('https://mainnet.block-engine.jito.wtf'),
  JITO_DEFAULT_TIP_LAMPORTS: z.coerce.number().int().positive().default(10_000),
  JITO_MAX_TIP_LAMPORTS: z.coerce.number().int().positive().default(1_000_000),

  // AI (Gemini)
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  GEMINI_MAX_TOKENS: z.coerce.number().int().positive().default(1024),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Server
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),

  // Observability
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  METRICS_ENABLED: booleanSchema.default(true),
  METRICS_PATH: z.string().default('/metrics'),

  // Environment
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  → ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `\n\n❌ Invalid environment configuration:\n${formatted}\n\nCopy .env.example to .env and fill in all required values.\n`,
    );
  }

  return result.data;
}

export const env = loadConfig();
