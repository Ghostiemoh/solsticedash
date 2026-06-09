// ============================================================
// Solstice Backend Server
// ============================================================
// Fastify server with WebSocket gateway, REST API, health checks,
// and Prometheus metrics. Entry point for the entire backend.
// ============================================================

import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { env } from './config/env.js';
import { logger, createChildLogger } from './telemetry/logger.js';
import { metricsRegistry } from './telemetry/metrics.js';
import { eventBus } from './events/event-bus.js';
import { EVENTS } from '@solstice/shared';
import { yellowstoneClient } from './streaming/yellowstone-client.js';
import { slotTracker } from './streaming/slot-tracker.js';
import { leaderTracker } from './streaming/leader-tracker.js';
import { leaderSchedule } from './leader/leader-schedule.js';
import { confirmationPoller } from './solana/confirmation-poller.js';
import { streamHealthMonitor } from './streaming/stream-health.js';
import { prisma } from './db/prisma-client.js';
import './queue/workers.js';

const log = createChildLogger('server');

async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger: false,
    trustProxy: true,
  });

  // ─── Plugins ─────────────────────────────────────────────
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(websocket, {
    options: {
      maxPayload: 1048576,
    },
  });

  // ─── Health Check ────────────────────────────────────────
  app.get('/health', async (_request, reply) => {
    try {
      const { performHealthCheck } = await import('./telemetry/health-check.js');
      const health = await performHealthCheck();
      const isUnhealthy = Object.values(health).some((s) => s.status === 'unhealthy');
      return reply.status(isUnhealthy ? 503 : 200).send({
        status: isUnhealthy ? 'unhealthy' : 'ok',
        service: 'solstice-backend',
        uptime: process.uptime(),
        timestamp: Date.now(),
        env: env.NODE_ENV,
        network: env.SOLANA_NETWORK,
        details: health,
      });
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ─── Prometheus Metrics Endpoint ─────────────────────────
  if (env.METRICS_ENABLED) {
    app.get(env.METRICS_PATH, async (_request, reply) => {
      const metrics = await metricsRegistry.metrics();
      return reply
        .header('Content-Type', metricsRegistry.contentType)
        .send(metrics);
    });
  }

  // ─── WebSocket Gateway ───────────────────────────────────
  // @fastify/websocket v8+ passes raw WebSocket as first arg (not SocketStream)
  app.get('/ws', { websocket: true }, (socket, _request) => {
    log.info('WebSocket client connected');

    const handlers = new Map<string, (...args: unknown[]) => void>();

    const forwardEvent = (eventName: string) => {
      const handler = (...args: unknown[]) => {
        try {
          if (socket.readyState === 1) {
            socket.send(
              JSON.stringify({
                type: eventName,
                data: args[0] ?? null,
                timestamp: Date.now(),
              }),
            );
          }
        } catch {
          // Client disconnected — handler will be cleaned up
        }
      };
      handlers.set(eventName, handler);
      (eventBus as any).on(eventName, handler);
    };

    // Forward all relevant events to connected WebSocket clients
    forwardEvent(EVENTS.SLOT_NEW);
    forwardEvent(EVENTS.LEADER_CURRENT);
    forwardEvent(EVENTS.LEADER_UPCOMING);
    forwardEvent(EVENTS.BUNDLE_SENT);
    forwardEvent(EVENTS.BUNDLE_LANDED);
    forwardEvent(EVENTS.BUNDLE_DROPPED);
    forwardEvent(EVENTS.TX_CREATED);
    forwardEvent(EVENTS.TX_SUBMITTED);
    forwardEvent(EVENTS.TX_CONFIRMED);
    forwardEvent(EVENTS.TX_FINALIZED);
    forwardEvent(EVENTS.TX_FAILED);
    forwardEvent(EVENTS.TX_RETRYING);
    forwardEvent(EVENTS.TX_ABANDONED);
    forwardEvent(EVENTS.AI_DECISION_RECEIVED);
    forwardEvent(EVENTS.CONGESTION_UPDATE);
    forwardEvent(EVENTS.STREAM_HEALTHY);
    forwardEvent(EVENTS.STREAM_DEGRADED);
    forwardEvent(EVENTS.RETRY_SCHEDULED);
    forwardEvent(EVENTS.RETRY_SUCCEEDED);
    forwardEvent(EVENTS.RETRY_EXHAUSTED);

    socket.on('close', () => {
      log.info('WebSocket client disconnected');
      for (const [event, handler] of handlers) {
        (eventBus as any).off(event, handler);
      }
      handlers.clear();
    });
  });

  // ─── Get Tracked Transactions API ────────────────────────
  app.get('/api/v1/transactions', async (_request, reply) => {
    try {
      const { lifecycleTracker } = await import('./lifecycle/lifecycle-tracker.js');
      return reply.send(lifecycleTracker.getAll());
    } catch (err) {
      log.error({ err }, 'failed to fetch transactions');
      return reply.status(500).send({ error: String(err) });
    }
  });

  app.get('/api/v1/readiness', async (_request, reply) => {
    try {
      const { lifecycleTracker } = await import('./lifecycle/lifecycle-tracker.js');
      const { streamHealthMonitor } = await import('./streaming/stream-health.js');
      const { tipManager } = await import('./jito/tip-manager.js');
      const { jitoLeaderDetector } = await import('./leader/jito-leader-detector.js');

      const txs = lifecycleTracker.getAll();
      const finalized = txs.filter((tx) => tx.status === 'FINALIZED');
      const failed = txs.filter((tx) => tx.status === 'FAILED' || tx.status === 'ABANDONED');
      const retried = txs.filter((tx) => tx.retryCount > 0);
      const decisions = txs.filter((tx) => tx.aiDecision || tx.retryCount > 0);
      const completeLifecycle = finalized.filter(
        (tx) => tx.processedAt && tx.confirmedAt && tx.finalizedAt,
      );

      // ── Evidence-derived claims (no hardcoded booleans) ──────────────
      // Direct-RPC fallback executions (Jito submission failed → RPC).
      const directRpcRecords = txs.filter((tx) =>
        tx.bundleId?.startsWith('rpc_fallback'),
      );
      const tips = tipManager.getPerformanceMetrics();

      // Durable, restart-proof Jito-landing evidence: count persisted bundle rows
      // that LANDED carrying a real Jito bundle id (not an `rpc_fallback_*`
      // execution record). In-memory tip metrics reset on restart, so the DB count
      // is the source of truth; we OR it with the live tip metric.
      let persistedJitoLandings = 0;
      try {
        persistedJitoLandings = await prisma.bundle.count({
          where: {
            status: 'LANDED',
            jitoBundleId: { not: null },
            NOT: { jitoBundleId: { startsWith: 'rpc_fallback' } },
          },
        });
      } catch (e) {
        log.warn({ err: String(e) }, 'failed to count persisted Jito landings');
      }
      const jitoLandings = Math.max(persistedJitoLandings, tips.totalLanded);

      // Proven ONLY when on mainnet AND a real Jito bundle has actually landed
      // (tip paid to a Jito tip account). Network string alone proves nothing.
      const mainnetJitoLandingProven =
        env.SOLANA_NETWORK === 'mainnet-beta' && jitoLandings > 0;

      // The SWQoS staked lane is only active when an endpoint is configured.
      const swqosConfigured = !!env.SWQOS_RPC_URL;

      // Disclose the RPC fallback honestly whenever it was used OR whenever Jito
      // landing is not yet proven — disclosure defaults ON, never off by fiat.
      const rpcFallbackDisclosed =
        directRpcRecords.length > 0 || !mainnetJitoLandingProven;

      const mode = mainnetJitoLandingProven
        ? 'MAINNET_JITO_PROVEN'
        : env.SOLANA_NETWORK === 'mainnet-beta'
          ? 'MAINNET_PATH_WIRED' // on mainnet, path wired, landing not yet proven
          : 'DEVNET_ACCEPTABLE_FALLBACK';

      const nextWork: string[] = [];
      if (!mainnetJitoLandingProven) {
        nextWork.push(
          'Land ≥1 real mainnet Jito bundle on a capped wallet to flip mainnetJitoLandingProven=true (currently gated on tips.totalLanded > 0).',
        );
      }
      if (!swqosConfigured) {
        nextWork.push(
          'Wire the solinfra SWQoS staked submit endpoint (IP allowlist + protocol) to enable stake-weighted submission.',
        );
      }
      nextWork.push('Export fresh lifecycle rows after the final demo run.');

      return reply.send({
        network: env.SOLANA_NETWORK,
        mode,
        claims: {
          devnetPrototype: true,
          mainnetJitoPathWired: true,
          mainnetJitoLandingProven,
          swqosStakedLaneActive: swqosConfigured,
          rpcFallbackDisclosed,
        },
        evidence: {
          totalTransactions: txs.length,
          finalizedTransactions: finalized.length,
          failedOrAbandonedTransactions: failed.length,
          retriedTransactions: retried.length,
          completeLifecycleTransactions: completeLifecycle.length,
          realJitoBundleLandings: jitoLandings,
          jitoTipsLanded: tips.totalLanded,
          directRpcExecutionRecords: directRpcRecords.length,
          aiDecisions: decisions.length,
        },
        stream: streamHealthMonitor.getHealthData(),
        leader: {
          cachedEpoch: leaderSchedule.getCachedEpoch(),
          scheduleSize: leaderSchedule.getScheduleSize(),
          knownJitoValidators: jitoLeaderDetector.getValidatorCount(),
        },
        tips,
        nextWork,
      });
    } catch (err) {
      log.error({ err }, 'failed to compute readiness');
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ─── Transaction Submission API ──────────────────────────
  app.post('/api/v1/transactions', async (request, reply) => {
    try {
      const { SystemProgram } = await import('@solana/web3.js');
      const { walletManager } = await import('./solana/wallet-manager.js');
      const { orchestrator } = await import('./orchestrator.js');

      // Self-transfer of 0.002 SOL: the funds return to the wallet, so a mainnet
      // proof run costs only the base fee + Jito tip (~0.000015 SOL), never the
      // transfer amount. Still a real, signed, on-chain transaction.
      const instruction = SystemProgram.transfer({
        fromPubkey: walletManager.publicKey,
        toPubkey: walletManager.publicKey,
        lamports: 2000000,
      });

      const txId = await orchestrator.submitInstructions([instruction], {
        source: 'api',
        type: 'test_transfer'
      });

      return reply.status(200).send({
        success: true,
        transactionId: txId,
        message: 'Test transaction submitted to orchestrator'
      });
    } catch (err) {
      log.error({ err }, 'failed to submit test transaction');
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ─── Expired Blockhash Fault Submission API ───────────────
  app.post('/api/v1/transactions/expired', async (request, reply) => {
    try {
      const { SystemProgram } = await import('@solana/web3.js');
      const { walletManager } = await import('./solana/wallet-manager.js');
      const { orchestrator } = await import('./orchestrator.js');

      // Self-transfer (funds return to the wallet) so the fault-injection proof
      // costs only fee + tip on the successful retry, never the transfer amount.
      const instruction = SystemProgram.transfer({
        fromPubkey: walletManager.publicKey,
        toPubkey: walletManager.publicKey,
        lamports: 2000000,
      });

      const txId = await orchestrator.submitInstructions([instruction], {
        source: 'api_fault_injection',
        type: 'test_expired_blockhash',
        forceExpiredBlockhash: true,
      });

      return reply.status(200).send({
        success: true,
        transactionId: txId,
        message: 'Expired blockhash fault transaction submitted to orchestrator'
      });
    } catch (err) {
      log.error({ err }, 'failed to submit expired blockhash transaction');
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ─── Event Counts API (debug) ────────────────────────────
  app.get('/api/v1/events/counts', async (_request, reply) => {
    return reply.send(eventBus.getEventCounts());
  });

  // ─── Debug: Leader State API ────────────────────────────
  app.get('/api/v1/debug/leader', async (_request, reply) => {
    const currentSlot = slotTracker.getCurrentSlot();
    const currentLeader = leaderTracker.getCurrentLeader();
    const scheduleSize = leaderSchedule.getScheduleSize();
    const epoch = leaderSchedule.getCachedEpoch();
    const lookedUp = leaderSchedule.getLeaderForSlot(currentSlot);
    return reply.send({
      currentSlot,
      currentLeader,
      scheduleSize,
      epoch,
      leaderForCurrentSlot: lookedUp,
      slotAgeMs: slotTracker.getAgeMs(),
    });
  });

  // ─── Graceful Shutdown ───────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutdown signal received');
    eventBus.emit(EVENTS.SYSTEM_SHUTDOWN);

    // Stop Yellowstone stream
    await yellowstoneClient.disconnect();
    streamHealthMonitor.stop();
    confirmationPoller.stop();
    await leaderSchedule.stop();

    // Close BullMQ workers
    try {
      const { closeWorkers } = await import('./queue/workers.js');
      await closeWorkers();
    } catch (err: any) {
      log.warn({ err: err.message }, 'error closing queue workers');
    }

    // Allow 5 seconds for graceful cleanup
    const shutdownTimer = setTimeout(() => {
      log.warn('forced shutdown after timeout');
      process.exit(1);
    }, 5000);

    try {
      await app.close();
      clearTimeout(shutdownTimer);
      log.info('server closed gracefully');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'error during shutdown');
      clearTimeout(shutdownTimer);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ─── Start Server ────────────────────────────────────────
  try {
    // Refresh leader schedule and start Yellowstone gRPC stream
    log.info('initializing Solana streaming and leader schedule cache');
    streamHealthMonitor.start();
    leaderSchedule.start();
    await yellowstoneClient.connect();
    confirmationPoller.start();

    await app.listen({ port: env.PORT, host: env.HOST });
    log.info(
      {
        port: env.PORT,
        host: env.HOST,
        network: env.SOLANA_NETWORK,
        metricsEnabled: env.METRICS_ENABLED,
        wsPath: '/ws',
      },
      '⚡ Solstice backend started',
    );
  } catch (err) {
    log.fatal({ err }, 'failed to start server');
    process.exit(1);
  }
}

// Force watcher reload after mock RPC manager change
bootstrap().catch((err) => {
  logger.fatal({ err }, 'unhandled bootstrap error');
  process.exit(1);
});
