# Solstice 🌅

**Validator-Aware Smart Transaction Execution & Intelligence Infrastructure for Solana**

Solstice is a production-grade transaction execution engine designed to maximize Solana transaction landing probability. It combines real-time slot and leader scheduling telemetry with Jito bundle submission, dynamic tip management, and an AI-driven autonomous retry engine.

---

## Submission Posture

Solstice is currently configured for the **acceptable fallback path** in the challenge: a working **Devnet** prototype with an honest, clearly disclosed RPC fallback where mainnet-only Jito behavior cannot be proven on Devnet.

**Proven now**

* Devnet transaction construction, signing, submission, confirmation, and finalization.
* Expired blockhash fault injection and autonomous retry.
* Persistent lifecycle evidence in Prisma/SQLite.
* Yellowstone/Geyser preferred streaming with disclosed RPC WebSocket fallback.
* Jito bundle construction, tip manager, sender, and tracker modules wired for the mainnet proof run.
* AI retry decision infrastructure with JSON schema validation and fallback safeguards.

**Not claimed in Devnet mode**

* A Devnet run is not represented as a successful mainnet Jito bundle landing.
* `rpc_fallback_*` records are direct RPC execution records, not Jito bundle IDs.
* Real Jito landing proof requires the planned capped mainnet wallet run.

The dashboard exposes this posture directly through `/api/v1/readiness` so judges can see what is proven, what is wired, and what remains for the final mainnet proof.

---

## 🏗️ Core Architecture & Key Features

*   **Dual-Mode slot Streaming (gRPC & WebSocket Fallback)**: Monitors live slot and leader updates via Yellowstone Geyser gRPC (Triton/Helius). If native binding issues exist on target operating systems (e.g. Windows Node 24 napi-rs crashes), the client automatically downgrades to an RPC WebSocket `onSlotChange` listener without crashing.
*   **Leader-Aware Submission Timing**: Caches the epoch-level leader schedule from the RPC pool and tracks upcoming validator windows to submit Jito bundles precisely when Jito-enabled leaders are active.
*   **Decoupled Event-Driven Pipeline**: Decouples transaction simulation, bundle construction, and poller tracking via an asynchronous type-safe `EventEmitter3` Event Bus.
*   **AI-Assisted Decision Engine (Gemini 2.0 Flash)**: When a transaction drops or fails, an AI decision agent analyzes error logs, network congestion levels, and tip metrics to decide whether to adjust fees, delay execution, wait for Jito slots, split the bundle, or abandon the transaction.
*   **Deterministic Fallback Safeguards**: Features a hardcoded, rules-based recovery system that executes immediately if the AI agent rate-limits (429), times out, or the API circuit breaker opens.
*   **Robust RPC Direct Fallback**: Jito block engines return `404 Not Found` rejections on Solana Devnet. Solstice automatically handles this by stripping the Jito tip instruction and routing the transaction directly to the RPC cluster, ensuring the prototype runs seamlessly on Devnet.
*   **Fault Injection Interface**: Provides a debug route to inject simulated blockhash expiry failures on-chain, proving autonomous recovery under error conditions.
*   **Premium Telemetry Dashboard**: A real-time Next.js dashboard featuring real-time slot clocks, leader details, active bundles count, AI decisions logging, and complete state timeline trackers.

---

## 📈 Transaction Lifecycle Compliance Log
Below is the log output of **10 real transaction submissions** executed on Solana Devnet (slots verified via Solana Explorer), showing our 8 standard transactions and 2 fault-injected blockhash expiry failures recovering autonomously using our retry queue and fallback engine:

| Tx ID | Type | Status | Slot | Tip Lamports | Retries | Failure Category | Latency (Sim -> Finalized) |
|---|---|---|---|---|---|---|---|
| `txn_5ef3cd816d0c4711` | Standard | FINALIZED | `465671699` | 10,000 | 0 | -- | 15.88s |
| `txn_fb38f60ad97c40fd` | Standard | FINALIZED | `465671699` | 10,000 | 0 | -- | 13.86s |
| `txn_57d34b19b7f545ff` | Standard | FINALIZED | `465671704` | 10,000 | 0 | -- | 13.95s |
| `txn_50b9310b86474867` | Standard | FINALIZED | `465671709` | 10,000 | 0 | -- | 14.06s |
| `txn_950389a57b734687` | Standard | FINALIZED | `465671715` | 10,000 | 0 | -- | 15.97s |
| `txn_6d7ed607afab4a16` | Standard | FINALIZED | `465671721` | 10,000 | 0 | -- | 15.97s |
| `txn_d46076b57e0b4d2b` | Standard | FINALIZED | `465671728` | 10,000 | 0 | -- | 16.66s |
| `txn_26f5a7c267684843` | Standard | FINALIZED | `465671731` | 10,000 | 0 | -- | 14.65s |
| `txn_89b7e119715f45e1` | Expired | FINALIZED | `465671900` | 10,000 | 1 | BLOCKHASH_EXPIRED | 77.91s |
| `txn_5be3c5c26f7b440e` | Expired | FINALIZED | `465671901` | 10,000 | 1 | BLOCKHASH_EXPIRED | 75.89s |

*   *Note: Standard transactions bypass Jito (on Devnet) and land directly. Expired blockhash simulations fail on-chain, trigger the polling timeout, get classified as `BLOCKHASH_EXPIRED`, route to the BullMQ scheduler with a fresh blockhash, and land successfully on attempt 2.*

---

## 🧠 Hackathon Questions & Protocol Understanding

### Question 1: What does the delta between `processed_at` and `confirmed_at` tell you about network health at the time of submission?
**Answer:**
The delta represents the duration required for a transaction, once included in a block by the leader (`processed`), to receive votes from a supermajority (66.6%+) of active stake on that block (`confirmed`). 
*   **Under normal conditions**, this delta is extremely low (typically 1–2 slots, or ~400–800ms) as votes propagate rapidly through the turbine gossip network.
*   **Under high network congestion or stress**, this delta spikes significantly. A large delta indicates voting latency, consensus partitions, high fork rates, or validators failing to process vote transactions due to full queues. Observing a growing delta signals that you must use a higher priority fee or wait longer before attempting to read state dependent on that transaction.

### Question 2: Why should you never use `finalized` commitment when fetching a blockhash for a time-sensitive transaction?
**Answer:**
A Solana blockhash is valid for exactly 150 slots (~60 seconds) after the block that produced it. 
*   The `finalized` commitment requires a supermajority vote to be locked in on top of the confirmed block (usually taking 31+ slots or ~13 seconds behind the tip of the chain).
*   If you fetch a blockhash using `finalized` commitment, you are retrieving a blockhash that is already **13+ seconds (31+ slots) old**.
*   Since the transaction must land in a block where its blockhash is still valid, using a finalized blockhash shrinks your available submission window from 150 slots down to ~118 slots. In a congested network, this drastically increases the probability of the transaction expiring before it can be processed. You should always query for blockhashes at `confirmed` or `processed` commitments.

### Question 3: What happens to your bundle if the Jito leader skips their slot?
**Answer:**
Jito bundles are sent out-of-band directly to Jito Block Engines, which route them *only* to the specific Jito-enabled validator scheduled to lead the upcoming slot. Unlike standard transactions, bundles are not broadcasted through the general TPU mempool to other validators. 
If the scheduled Jito validator skips their slot (due to network dropouts, late block production, or crash failure):
1.  The bundle is **never processed** and is permanently dropped by the block engine.
2.  The transactions inside the bundle do not execute, and you do not pay any execution fees or Jito tips.
3.  The stack must detect the skip (via slot tracking or bundle status timeouts) and resubmit the transactions in a new bundle targetting the next scheduled Jito leader.

---

## ⚡ Getting Started & Setup Instructions

### Prerequisites
*   **Node.js**: v18 or newer
*   **pnpm**: v8 or newer
*   **Docker**: For database and queue caching infrastructure

### 1. Environment Configuration
Create a `.env` file at the root of the project by copying `.env.example`:
```env
# Solana Network Configuration
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PRIVATE_KEY=your_base58_private_key

# Jito Configuration
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf

# Gemini AI Key
GEMINI_API_KEY=your_gemini_api_key

# Infrastructure Credentials
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/solstice
REDIS_URL=redis://localhost:6379
```

### 2. Boot Local Infrastructure
Solstice uses Redis for BullMQ retry queues and PostgreSQL/SQLite for metric histories. Spin them up with Docker:
```bash
docker-compose up -d
```

### 3. Initialize & Install
Run the monorepo setup commands from the root directory:
```bash
pnpm install
pnpm turbo build
```

### 4. Running the Applications
Start the backend transaction gateway and telemetry dashboard in development mode:
```bash
# In terminal 1 (starts Fastify gateway at http://localhost:3001)
cd apps/backend
pnpm run dev

# In terminal 2 (starts Next.js app at http://localhost:3000)
cd apps/dashboard
pnpm run dev
```

### 5. Testing and Fault Injection
*   Open the Dashboard at `http://localhost:3000`.
*   Click **Test Transaction** to submit a standard transfer directly to the Solana Devnet RPC cluster.
*   Click **Simulate Expired Blockhash** to execute our fault injection simulation. The dashboard will show the transaction fail, register the poller timeout, schedule a BullMQ retry, and succeed on-chain with a fresh blockhash!
