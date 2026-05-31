// ============================================================
// AI Decision Prompts
// ============================================================
// System and user prompts for the Gemini-powered AI decision engine.
// The AI acts as a Solana infrastructure operator, not a chatbot.
// ============================================================

import type { AiDecisionContext } from '@solstice/shared';
import { lamportsToSol, truncatePublicKey } from '@solstice/shared';

export const SYSTEM_PROMPT = `You are an autonomous Solana transaction infrastructure operator.
Your job is to make real-time operational decisions about transaction retry strategy, tip optimization, timing, and resource allocation.

You are NOT a chatbot. You are an infrastructure decision engine.

Context you receive:
- Current Solana slot and upcoming leader schedule
- Network congestion metrics (slot rate, skip rate, priority fees)
- Recent transaction/bundle failure history
- Retry history for the specific transaction
- Bundle performance metrics (landing rate, avg tip for landed vs dropped)
- Latency metrics across all subsystems

Decisions you make:
- Should we retry this failed transaction?
- What tip amount should we use? (in lamports)
- How long should we delay before retrying? (milliseconds)
- Should we split the bundle into individual transactions?
- Should we wait for the next Jito-enabled leader?
- Should we abandon this transaction entirely?
- Should we adjust the compute unit limit?
- Should we rebroadcast via standard RPC as well?

Decision principles:
1. COST EFFICIENCY: Don't over-tip. Base tip decisions on recent landed vs dropped tip data.
2. TIMING: Align retries with Jito leader windows for bundles. Don't submit during non-Jito leader slots if bundling.
3. CONGESTION AWARENESS: During high congestion, increase tips and priority fees. During low congestion, be conservative.
4. FAILURE PATTERN RECOGNITION: Repeated same-category failures suggest systemic issues — consider abandoning.
5. LATENCY SENSITIVITY: Factor in RPC and submission latency when timing retries.
6. NEVER GUESS: If confidence is low, say so. The system has deterministic fallback rules.

Response format: JSON object matching the specified schema. Always include reasoning.`;

export function buildUserPrompt(context: AiDecisionContext): string {
  const leaderLines = context.upcomingLeaders
    .map(
      (l) =>
        `  Slot ${l.slot} (in ${l.slotsUntil} slots): ${truncatePublicKey(l.validator)} ${l.isJitoValidator ? '[JITO]' : '[STANDARD]'}`,
    )
    .join('\n');

  const failureLines = context.recentFailures
    .map((f) => `  ${f.category}: ${f.count}x (last: ${new Date(f.lastOccurrence).toISOString()})`)
    .join('\n');

  const retryLines = context.retryHistory
    .map(
      (r) =>
        `  Attempt ${r.attempt}: ${r.failureCategory} → ${r.outcome} (tip: ${r.tipLamports} lamports)`,
    )
    .join('\n');

  return `Current network state and transaction context:

SLOT: ${context.currentSlot}
CONGESTION: ${context.congestionLevel}

UPCOMING LEADERS:
${leaderLines || '  No leader data available'}

RECENT FAILURES (system-wide):
${failureLines || '  No recent failures'}

RETRY HISTORY (this transaction):
${retryLines || '  No prior retries'}
Current retry count: ${context.retryCount}
Transaction age: ${context.transactionAge}ms

BUNDLE PERFORMANCE (recent):
  Landing rate: ${(context.bundlePerformance.landingRate * 100).toFixed(1)}%
  Total sent: ${context.bundlePerformance.totalSent}
  Avg tip (landed): ${context.bundlePerformance.avgTipLanded} lamports (${lamportsToSol(context.bundlePerformance.avgTipLanded)} SOL)
  Avg tip (dropped): ${context.bundlePerformance.avgTipDropped} lamports

CURRENT TIP: ${context.currentTipLamports} lamports (${lamportsToSol(context.currentTipLamports)} SOL)

LATENCY:
  RPC: ${context.latencyMetrics.rpcLatencyMs}ms
  Stream: ${context.latencyMetrics.streamLatencyMs}ms
  Bundle submit: ${context.latencyMetrics.bundleSubmitLatencyMs}ms
  Simulation: ${context.latencyMetrics.simulationLatencyMs}ms
  AI decision: ${context.latencyMetrics.aiDecisionLatencyMs}ms

What should we do with this transaction? Respond with a JSON object.`;
}
