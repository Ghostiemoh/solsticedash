// ============================================================
// Yellowstone gRPC Client Wrapper
// ============================================================
// Manages the gRPC connection to the Yellowstone/Geyser stream.
// Subscribes to slot updates, block updates, and transaction
// account updates. Pushes events to the event bus.
// ============================================================

import type { SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { env } from '../config/env.js';
import { createChildLogger } from '../telemetry/logger.js';
import { eventBus } from '../events/event-bus.js';
import { streamHealthMonitor } from './stream-health.js';
import { EVENTS, type SlotUpdate } from '@solstice/shared';
import { rpcManager } from '../solana/rpc-manager.js';

const log = createChildLogger('yellowstone-grpc');

export class YellowstoneClient {
  private client: any = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private mockInterval: NodeJS.Timeout | null = null;
  private fallbackSubId: number | null = null;

  async connect(): Promise<void> {
    if (env.MOCK_MODE) {
      log.info('MOCK_MODE enabled — starting mock slot streaming');
      streamHealthMonitor.onConnect();
      
      let mockSlot = 245000000;
      (global as any).mockCurrentSlot = mockSlot;

      this.mockInterval = setInterval(() => {
        mockSlot++;
        (global as any).mockCurrentSlot = mockSlot;
        
        const update: SlotUpdate = {
          slot: mockSlot,
          parent: mockSlot - 1,
          status: 'processed',
          timestamp: Date.now(),
        };
        eventBus.emit(EVENTS.SLOT_NEW, update);
        streamHealthMonitor.onMessage();
      }, 400);
      
      return;
    }

    if (!env.YELLOWSTONE_GRPC_URL) {
      log.warn('YELLOWSTONE_GRPC_URL not configured — streaming disabled');
      return;
    }

    try {
      log.info({ url: env.YELLOWSTONE_GRPC_URL }, 'connecting to Yellowstone gRPC');

      let Client;
      try {
        const { default: LoadedClient } = await import('@triton-one/yellowstone-grpc');
        Client = LoadedClient;
      } catch (importError: any) {
        log.warn(
          { error: importError.message },
          'Yellowstone gRPC library could not be loaded (likely missing native bindings on Windows/Node 24). Falling back to RPC slot listener.'
        );
        this.startRpcFallback();
        return;
      }

      this.client = new Client(env.YELLOWSTONE_GRPC_URL, env.YELLOWSTONE_GRPC_TOKEN, undefined);
      
      const stream = await this.client.subscribe();

      stream.on('data', (data: any) => {
        streamHealthMonitor.onMessage();
        this.handleStreamData(data);
      });

      stream.on('error', (error: any) => {
        log.error({ error: error.message }, 'gRPC stream error');
        streamHealthMonitor.onDisconnect(error.message);
        this.scheduleReconnect();
      });

      stream.on('end', () => {
        log.warn('gRPC stream ended by server');
        streamHealthMonitor.onDisconnect('Server closed stream');
        this.scheduleReconnect();
      });

      streamHealthMonitor.onConnect();

      // Configure subscriptions
      this.setupSubscriptions(stream);
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'failed to connect to Yellowstone gRPC. Falling back to RPC slot listener.');
      this.startRpcFallback();
    }
  }

  private startRpcFallback(): void {
    if (this.fallbackSubId !== null) return;

    log.info('Initializing fallback Solana RPC slot change listener');
    try {
      const connection = rpcManager.getConnection();
      this.fallbackSubId = connection.onSlotChange((slotInfo) => {
        streamHealthMonitor.onMessage();
        
        const update: SlotUpdate = {
          slot: slotInfo.slot,
          parent: slotInfo.parent,
          status: 'processed',
          timestamp: Date.now(),
        };
        eventBus.emit(EVENTS.SLOT_NEW, update);
      });
      
      streamHealthMonitor.onConnect();
      log.info('Fallback Solana RPC slot subscription active');
    } catch (error: any) {
      log.error({ error: error.message }, 'failed to start fallback RPC slot subscription');
      this.scheduleFallbackReconnect();
    }
  }

  private scheduleFallbackReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startRpcFallback();
    }, 5000);
  }

  private setupSubscriptions(stream: any): void {
    const request: any = {
      slots: {
        all: { filterByCommitment: true },
      },
      accounts: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: 1, // processed
      accountsDataSlice: [],
      ping: undefined,
    };

    stream.write(request, (err: Error | null) => {
      if (err) {
        log.error({ error: err.message }, 'failed to write subscribe request');
      } else {
        log.info('subscription request sent successfully');
      }
    });
  }

  private handleStreamData(data: any): void {
    if (data.slot) {
      const update: SlotUpdate = {
        slot: parseInt(data.slot.slot, 10),
        parent: parseInt(data.slot.parent, 10),
        status: data.slot.status,
        timestamp: Date.now(),
      };
      
      const statusStr = String(update.status).toUpperCase();
      
      if (statusStr === 'PROCESSED' || statusStr === '1') {
        eventBus.emit(EVENTS.SLOT_NEW, update);
      } else if (statusStr === 'CONFIRMED' || statusStr === '2') {
        eventBus.emit(EVENTS.SLOT_CONFIRMED, update);
      } else if (statusStr === 'FINALIZED' || statusStr === '3') {
        eventBus.emit(EVENTS.SLOT_FINALIZED, update);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    streamHealthMonitor.onReconnecting();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  async disconnect(): Promise<void> {
    if (this.mockInterval) {
      clearInterval(this.mockInterval);
      this.mockInterval = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      this.client = null;
      streamHealthMonitor.onDisconnect('Client disconnected manually');
    }

    if (this.fallbackSubId !== null) {
      try {
        const connection = rpcManager.getConnection();
        connection.removeSlotChangeListener(this.fallbackSubId);
      } catch (err: any) {
        log.warn({ error: err.message }, 'failed to clean up slot change listener');
      }
      this.fallbackSubId = null;
      streamHealthMonitor.onDisconnect('Fallback subscription disconnected manually');
    }
  }
}

export const yellowstoneClient = new YellowstoneClient();
