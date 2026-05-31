// ============================================================
// Health Check
// ============================================================
// Full system health check returning status of all subsystems.
// Used by the /health endpoint and monitoring infrastructure.
// ============================================================

import type { SystemHealth, SubsystemHealth } from '@solstice/shared';
import { rpcManager } from '../solana/rpc-manager.js';
import { createChildLogger } from './logger.js';
import { streamHealthMonitor } from '../streaming/stream-health.js';
import { prisma } from '../db/prisma-client.js';

const log = createChildLogger('health-check');

async function checkSubsystem(
  name: string,
  check: () => Promise<void>,
): Promise<SubsystemHealth> {
  const startTime = performance.now();
  try {
    await check();
    return {
      status: 'healthy',
      latencyMs: Math.round(performance.now() - startTime),
      lastCheckedAt: Date.now(),
      message: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'unhealthy',
      latencyMs: Math.round(performance.now() - startTime),
      lastCheckedAt: Date.now(),
      message,
    };
  }
}

export async function performHealthCheck(): Promise<SystemHealth> {
  const [rpc, redis, postgres] = await Promise.all([
    checkSubsystem('rpc', async () => {
      await rpcManager.execute('getSlot', (conn) => conn.getSlot());
    }),
    checkSubsystem('redis', async () => {
      // Redis health will be checked when Redis client is initialized
      // For now, return healthy as placeholder
    }),
    checkSubsystem('postgres', async () => {
      await prisma.$queryRaw`SELECT 1`;
    }),
  ]);

  const streamHealth = streamHealthMonitor.getHealthData();
  const streamStatus =
    streamHealth.status === 'CONNECTED'
      ? 'healthy'
      : streamHealth.status === 'DEGRADED' || streamHealth.status === 'RECONNECTING'
        ? 'degraded'
        : 'unhealthy';

  return {
    rpc,
    stream: {
      status: streamStatus,
      latencyMs: null,
      lastCheckedAt: Date.now(),
      message: `${streamHealth.status}; ${streamHealth.reconnectCount} reconnects; ${streamHealth.messagesPerSecond.toFixed(2)} msg/s`,
    },
    redis,
    postgres,
    jito: {
      status: 'healthy',
      latencyMs: null,
      lastCheckedAt: Date.now(),
      message: 'Jito health tracked via bundle success rate',
    },
    ai: {
      status: 'healthy',
      latencyMs: null,
      lastCheckedAt: Date.now(),
      message: 'AI health tracked via decision engine stats',
    },
  };
}
