# Solana Infrastructure Concepts — Solstice Reference

> This document is the theoretical foundation for every engineering decision in Solstice.
> Read this before touching any code. Every subsystem maps back to a concept here.

---

## 1. Solana Architecture Overview

Solana is a high-performance Layer 1 blockchain optimized for throughput and latency.
Unlike Ethereum's block-at-a-time model, Solana streams transactions continuously
to the current leader validator, achieving ~400ms block times and ~65,000 TPS theoretical capacity.

### Key Architectural Pillars

| Innovation | What It Does | Why It Matters for Solstice |
|-----------|-------------|---------------------------|
| **Proof of History (PoH)** | Cryptographic clock — SHA-256 hash chain | Provides verifiable ordering without consensus overhead |
| **Tower BFT** | PoH-optimized PBFT consensus | Reduces voting overhead, enables fast finality |
| **Gulf Stream** | Mempool-less transaction forwarding | Transactions go directly to leaders — no mempool |
| **Turbine** | Block propagation via erasure coding | Fast block distribution across validators |
| **Sealevel** | Parallel transaction execution | Non-conflicting transactions execute simultaneously |
| **Pipeline** | Transaction processing pipeline | GPU-accelerated signature verification |
| **Cloudbreak** | Horizontally-scaled accounts DB | Memory-mapped concurrent account access |

### Solstice Implication

Solana's architecture means:
- **No mempool to monitor** — transactions are forwarded directly to leaders via Gulf Stream
- **Leader identity matters** — you must know WHO the current leader is to optimize submission
- **Timing matters** — submitting at the right moment in the slot window is critical
- **Transaction ordering is leader-controlled** — unlike Ethereum, there's no public mempool to front-run (Jito changes this via private bundles)

---

## 2. Validators, Leaders, Slots, and Epochs

### Validators

Validators are nodes that participate in consensus. Each validator:
- Runs the Solana validator software (Agave client or Jito-Solana client)
- Maintains a copy of the ledger
- Votes on blocks
- May or may not be a **leader** at any given time

### Leaders

A **leader** is the validator currently responsible for producing blocks. Key facts:
- Only ONE validator is the leader at any given slot
- Leaders are assigned in advance for the entire epoch
- Each leader gets **4 consecutive slots** (~1.6 seconds total)
- The leader schedule is deterministic and public

### Slots

A **slot** is ~400ms of block production time. Details:
- Each slot can contain one block (or be skipped if the leader is offline)
- Slots are numbered sequentially from genesis
- The current slot number is a key piece of state for Solstice

### Epochs

An **epoch** is ~432,000 slots (~2 days). At each epoch boundary:
- A new leader schedule is generated
- Validator stake weights are recalculated
- Rewards are distributed

### The Leader Schedule

```
Epoch N Leader Schedule (simplified):
┌─────────────┬────────────────────────────┐
│ Slot Range  │ Leader Validator           │
├─────────────┼────────────────────────────┤
│ 0-3         │ ValidatorA (4 slots)       │
│ 4-7         │ ValidatorB (4 slots)       │
│ 8-11        │ ValidatorC (4 slots)       │
│ 12-15       │ ValidatorA (4 slots again) │
│ ...         │ ...                        │
└─────────────┴────────────────────────────┘
```

**Solstice uses this to:**
1. Know which validator is currently leading
2. Predict upcoming leaders
3. Identify when Jito-enabled validators will lead (critical for bundle submission)
4. Time transaction submission to arrive during the target leader's window

---

## 3. Transaction Lifecycle

A Solana transaction goes through these stages:

```
  Client                    RPC Node              Leader (TPU)           Validators
    │                          │                      │                      │
    │─── sendTransaction ─────>│                      │                      │
    │                          │── forward via ──────>│                      │
    │                          │   Gulf Stream        │                      │
    │                          │   (QUIC protocol)    │── execute ──────────>│
    │                          │                      │                      │
    │                          │                      │── include in block ─>│
    │                          │                      │                      │
    │<── signature ────────────│                      │                      │
    │                          │                      │                      │
    │─── getSignatureStatus ──>│                      │                      │
    │<── { processed } ────────│                      │                      │
    │                          │                      │                      │
    │─── getSignatureStatus ──>│                      │                      │
    │<── { confirmed } ────────│                      │                      │
    │                          │                      │                      │
    │─── getSignatureStatus ──>│                      │                      │
    │<── { finalized } ────────│                      │                      │
```

### Transaction Structure

A Solana transaction contains:
1. **Recent blockhash** — ties the transaction to a recent block (expires after ~150 slots / ~60s)
2. **Instructions** — the actual operations (transfer, program call, etc.)
3. **Signatures** — from all required signers
4. **Address Lookup Tables** (v0 transactions) — compress account lists

### Why Transactions Get Dropped

| Reason | Frequency | Solstice Handling |
|--------|-----------|-------------------|
| **Blockhash expired** | Common during congestion | Rebuild with fresh blockhash, resubmit |
| **Low priority fee** | Common | Dynamic priority fee based on recent fees |
| **Leader offline/slow** | Occasional | Detect via slot tracking, wait for next leader |
| **RPC node overloaded** | During high activity | RPC failover to backup endpoints |
| **Duplicate transaction** | User error | Dedup by signature before submission |
| **Program error** | Depends on program | Simulate first, classify error |
| **Write lock contention** | DeFi operations | Delay and retry with backoff |

---

## 4. TPU, Gulf Stream, and QUIC

### TPU (Transaction Processing Unit)

The TPU is the leader's transaction ingestion pipeline:
```
Incoming TX ──> Fetch Stage ──> SigVerify Stage ──> Banking Stage ──> Broadcast
                  (receive)     (GPU verify sigs)    (execute tx)     (to validators)
```

### Gulf Stream

Gulf Stream is Solana's mempool-less transaction forwarding protocol:
- Clients send transactions to their connected RPC node
- The RPC node forwards directly to the current (and next) leader
- No mempool = no public view of pending transactions
- Transactions arrive at the leader within milliseconds

### QUIC Protocol

Since Solana v1.15, all transaction forwarding uses QUIC (not UDP):
- **Connection-oriented** — reduces spam
- **Stake-weighted priority** — validators with more stake get more bandwidth
- **Rate limiting** — per-connection rate limits prevent abuse
- **Implication for Solstice**: Using an RPC provider with high stake or direct TPU access improves landing rates

---

## 5. Priority Fees and Compute Budget

### Compute Units (CU)

Every Solana instruction consumes compute units. Defaults:
- **Max per transaction**: 1,400,000 CU (but default is 200,000)
- **Max per block**: 48,000,000 CU

### Compute Budget Instructions

Two special instructions control compute allocation:

```typescript
// 1. Set compute unit limit
ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })

// 2. Set compute unit price (priority fee)
ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })
```

### Priority Fee Calculation

```
Total priority fee = computeUnitPrice × computeUnitsConsumed
```

Example:
- `computeUnitPrice = 50,000 microLamports`
- `computeUnitsConsumed = 200,000 CU`
- Total fee = 50,000 × 200,000 = 10,000,000,000 microLamports = 10,000 lamports = 0.00001 SOL

### Solstice Strategy

1. **Simulate first** to get actual CU consumption
2. **Set CU limit** to simulated value + 10% buffer (reduces wasted CU, improves scheduling)
3. **Set CU price** based on recent fee percentiles (p50 for normal, p90 for urgent)
4. **Adjust dynamically** based on landing rates and congestion

---

## 6. Commitment Levels

Solana has three commitment levels, each representing a different confidence in finality:

| Level | Meaning | Latency | Use Case |
|-------|---------|---------|----------|
| `processed` | Executed by leader, not yet voted on | ~400ms | Real-time display |
| `confirmed` | Voted on by 2/3+ of stake | ~5-10s | Most operations |
| `finalized` | Rooted — maximum 32 slots deep | ~12-15s | Financial settlement |

### Blockhash Commitment

The `getLatestBlockhash` call accepts a commitment level:
- **Use `confirmed`** for transaction building (good balance of freshness and stability)
- The returned blockhash has a `lastValidBlockHeight` — transactions using it expire after this height

### Solstice Tracking

Solstice tracks EVERY commitment level transition:
```
processed ──> confirmed ──> finalized
     │              │
     └── may revert └── very unlikely to revert
```

Each transition is timestamped and stored. This gives judges evidence of lifecycle understanding.

---

## 7. Jito Architecture

Jito is the dominant MEV infrastructure on Solana. ~80%+ of validators run Jito-Solana.

### How Jito Works

```
  Searcher                   Block Engine              Jito Validator (Leader)
    │                            │                           │
    │── sendBundle ─────────────>│                           │
    │   (1-5 transactions       │                           │
    │    + tip instruction)     │                           │
    │                            │── auction ───────────────>│
    │                            │   (highest tip wins)      │
    │                            │                           │
    │                            │<── accept bundle ─────────│
    │                            │                           │
    │<── bundle_id ──────────────│                           │
    │                            │                           │── include in block
    │                            │                           │
    │── getBundleStatuses ──────>│                           │
    │<── { landed: true } ───────│                           │
```

### Bundle Mechanics

- A **bundle** is 1-5 transactions that execute atomically (all-or-nothing)
- The last transaction MUST include a **tip** to a Jito tip account
- Bundles compete in an auction — highest tip wins inclusion
- Bundles are ONLY processed when a Jito-enabled validator is the leader

### Tip Accounts

Jito has 8 designated tip accounts. The tip is a SOL transfer instruction:
```typescript
SystemProgram.transfer({
  fromPubkey: searcher.publicKey,
  toPubkey: tipAccount,       // one of the 8 tip accounts
  lamports: tipAmount,        // the tip in lamports
})
```

**Tip accounts rotate** — always fetch current tip accounts via the Jito API.

### Jito Block Engine Endpoints

| Region | URL |
|--------|-----|
| Global (recommended) | `https://mainnet.block-engine.jito.wtf` |
| Amsterdam | `https://amsterdam.mainnet.block-engine.jito.wtf` |
| Frankfurt | `https://frankfurt.mainnet.block-engine.jito.wtf` |
| New York | `https://ny.mainnet.block-engine.jito.wtf` |
| Tokyo | `https://tokyo.mainnet.block-engine.jito.wtf` |

### Why Bundles Get Dropped

| Reason | Solstice Detection | Solstice Response |
|--------|-------------------|-------------------|
| Tip too low | Compare with recent landed tips | AI increases tip |
| Non-Jito leader | Leader schedule check | Wait for next Jito leader |
| Blockhash expired | Timing analysis | Rebuild with fresh hash |
| Simulation failure | Pre-simulation | Fix or abandon |
| Bundle conflict | Error code analysis | Retry with delay |

---

## 8. Yellowstone / Geyser

### What is Geyser?

Geyser is a Solana validator plugin that streams real-time data to external consumers.
Instead of polling RPC endpoints, you receive a push-based stream of:
- **Slot updates** — new slot processed/confirmed/finalized
- **Block updates** — full block data including transactions
- **Transaction updates** — individual transaction results
- **Account updates** — changes to specific accounts

### Yellowstone gRPC

Yellowstone is Triton One's implementation of the Geyser interface over gRPC.
It's the standard way to consume Geyser data in production.

```typescript
import Client from "@triton-one/yellowstone-grpc";

const client = new Client("YOUR_GRPC_ENDPOINT", "YOUR_TOKEN");
const stream = await client.subscribe();

// Subscribe to slot updates
stream.write({
  slots: { "slot-sub": {} },
  commitment: CommitmentLevel.CONFIRMED,
});

// Handle incoming data
stream.on("data", (update) => {
  if (update.slot) {
    console.log(`New slot: ${update.slot.slot}`);
  }
});
```

### Why Streaming vs. Polling?

| Aspect | Polling (RPC) | Streaming (Yellowstone) |
|--------|--------------|------------------------|
| Latency | 100-500ms per poll | <50ms push |
| Load | High (many requests) | Low (single connection) |
| Data completeness | May miss slots | Guaranteed delivery |
| Cost | Rate limited | Single connection |
| Reliability | Depends on poll interval | Persistent stream |

### Solstice Uses Yellowstone For:
1. **Slot tracking** — know the current slot in real-time
2. **Leader detection** — combine with leader schedule to identify current leader
3. **Transaction confirmation** — receive confirmation events for tracked signatures
4. **Congestion detection** — monitor slot rate to detect network slowdowns
5. **Stream health** — the connection itself is a health signal

---

## 9. Leader Scheduling and Transaction Landing Optimization

### The 4-Slot Window

Each leader gets 4 consecutive slots. Optimal submission timing:
```
Leader A's Window:
  Slot N   │ Slot N+1 │ Slot N+2 │ Slot N+3 │ Slot N+4 (next leader)
  ─────────┼──────────┼──────────┼──────────┼──────────
  SUBMIT   │          │          │          │ TOO LATE
  HERE     │ STILL OK │ GETTING  │ RISKY    │
           │          │ LATE     │          │
```

### Transaction Landing Optimization Strategy

1. **Know the leader** — query the leader schedule
2. **Detect Jito leaders** — bundles ONLY work with Jito validators
3. **Submit early in the window** — ideally slots N or N+1
4. **Pre-flight simulation** — simulate before the window opens
5. **Have transactions ready** — pre-build and pre-sign, waiting for the right slot
6. **Use priority fees** — higher fees = higher scheduling priority
7. **Use Jito bundles** — guaranteed atomic execution + tip-based priority

### Congestion Detection

Solstice monitors several congestion signals:
- **Slot rate** — slots/second should be ~2.5; lower means congestion
- **Skip rate** — percentage of skipped slots
- **Priority fee percentiles** — rising fees indicate congestion
- **Transaction landing rate** — our own success rate over time

---

## 10. MEV Concepts for Solstice

### What is MEV?

MEV (Maximal Extractable Value) is the value that can be extracted by reordering, inserting, or censoring transactions. On Solana, MEV primarily manifests as:
- **Arbitrage** — profiting from price differences across DEXes
- **Liquidations** — liquidating under-collateralized positions
- **Sandwich attacks** — front-running and back-running swap transactions

### Solstice's Relationship to MEV

Solstice is NOT an MEV bot. It is **transaction infrastructure** that:
- Uses Jito bundles for reliable transaction inclusion (the same infrastructure MEV searchers use)
- Optimizes tips to ensure bundles land
- Times submissions for optimal inclusion
- The AI reasons about the same network conditions MEV searchers care about

### Searcher Infrastructure Patterns

Patterns from professional MEV/searcher teams that Solstice borrows:
1. **Pre-simulation** — always simulate before submitting
2. **Leader tracking** — know who's producing blocks
3. **Tip optimization** — dynamic tips based on competition
4. **Retry sophistication** — not all failures are equal
5. **Observability** — measure everything, optimize everything
6. **Latency consciousness** — every millisecond matters

---

## 11. Solana's Lack of a Traditional Mempool

Unlike Ethereum, Solana has no public mempool:
- Transactions are forwarded directly to the leader via Gulf Stream
- No one except the leader sees the transaction before execution
- This means traditional "mempool monitoring" doesn't apply
- Jito's Block Engine creates a private "pseudo-mempool" for bundle auctions

**Implication for Solstice**: We cannot "watch" pending transactions. Instead, we:
- Stream confirmed/finalized data via Yellowstone
- Track our own transactions through the lifecycle
- Use Jito for guaranteed ordering within bundles

---

## 12. Practical Constants

```typescript
// Timing
const SLOT_DURATION_MS = 400;
const SLOTS_PER_LEADER = 4;
const LEADER_WINDOW_MS = SLOT_DURATION_MS * SLOTS_PER_LEADER; // 1600ms
const SLOTS_PER_EPOCH = 432_000;
const EPOCH_DURATION_HOURS = 48; // approximately

// Blockhash
const BLOCKHASH_EXPIRY_SLOTS = 150;
const BLOCKHASH_EXPIRY_MS = BLOCKHASH_EXPIRY_SLOTS * SLOT_DURATION_MS; // ~60s

// Compute
const MAX_COMPUTE_UNITS_PER_TX = 1_400_000;
const DEFAULT_COMPUTE_UNITS = 200_000;
const MAX_COMPUTE_UNITS_PER_BLOCK = 48_000_000;

// Jito
const MAX_BUNDLE_SIZE = 5; // max 5 transactions per bundle
const MIN_TIP_LAMPORTS = 1_000; // 0.000001 SOL minimum viable tip

// Network
const TPS_THEORETICAL_MAX = 65_000;
const TPS_PRACTICAL_MAX = 4_000; // typical real-world sustained TPS
```
