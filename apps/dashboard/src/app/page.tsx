'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Copy,
  Database,
  ExternalLink,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface Transaction {
  id: string;
  signature: string | null;
  status: string;
  createdAt: number;
  simulatedAt: number | null;
  signedAt: number | null;
  bundledAt: number | null;
  submittedAt: number | null;
  processedAt: number | null;
  confirmedAt: number | null;
  finalizedAt: number | null;
  failedAt: number | null;
  abandonedAt: number | null;
  slot: number | null;
  leader: string | null;
  bundleId: string | null;
  tipLamports: number | null;
  computeUnitsConsumed: number | null;
  computeUnitLimit: number | null;
  computeUnitPrice: number | null;
  retryCount: number;
  lastError: string | null;
  failureCategory: string | null;
  aiDecision?: {
    timestamp: number;
    modelUsed: string;
    wasOverridden: boolean;
    latencyMs: number;
    decision: {
      shouldRetry: boolean;
      newTipLamports: number | null;
      delayMs: number;
      splitBundle: boolean;
      waitForJitoLeader: boolean;
      confidence: number;
      reasoning: string;
    };
  } | null;
}

interface Readiness {
  network: string;
  mode: string;
  claims: {
    devnetPrototype: boolean;
    mainnetJitoPathWired: boolean;
    mainnetJitoLandingProven: boolean;
    swqosStakedLaneActive: boolean;
    rpcFallbackDisclosed: boolean;
  };
  evidence: {
    totalTransactions: number;
    finalizedTransactions: number;
    failedOrAbandonedTransactions: number;
    retriedTransactions: number;
    completeLifecycleTransactions: number;
    realJitoBundleLandings: number;
    jitoTipsLanded: number;
    directRpcExecutionRecords: number;
    aiDecisions: number;
  };
  stream: {
    status: string;
    reconnectCount: number;
    messagesPerSecond: number;
    lastMessageAt: number;
  };
  leader: {
    cachedEpoch: number;
    scheduleSize: number;
    knownJitoValidators: number;
  };
  tips: {
    totalSent: number;
    totalLanded: number;
    totalDropped: number;
    landingRate: number;
    avgTipLanded: number;
    avgTipDropped: number;
  };
  nextWork: string[];
}

type Notice = { type: 'success' | 'error'; message: string } | null;

export default function Dashboard() {
  const [health, setHealth] = useState<any>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [connected, setConnected] = useState(false);
  const [currentSlot, setCurrentSlot] = useState<number | null>(null);
  const [slotAge, setSlotAge] = useState(0);
  const [leaderInfo, setLeaderInfo] = useState<any>(null);
  const [activeBundlesCount, setActiveBundlesCount] = useState(0);
  const [liveAiDecisionsCount, setLiveAiDecisionsCount] = useState(0);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchJson = async <T,>(path: string): Promise<T> => {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return (await response.json()) as T;
  };

  const refreshData = async () => {
    setLoadError(null);
    try {
      const [healthResponse, readinessResponse, txResponse] = await Promise.all([
        fetchJson<any>('/health'),
        fetchJson<Readiness>('/api/v1/readiness'),
        fetchJson<Transaction[]>('/api/v1/transactions'),
      ]);
      setHealth(healthResponse.details);
      setReadiness(readinessResponse);
      setTransactions(txResponse.sort((a, b) => b.createdAt - a.createdAt));
      // Sync live AI decisions counter from backend truth
      const aiCount = txResponse.filter((tx) => tx.aiDecision != null || tx.retryCount > 0).length;
      setLiveAiDecisionsCount(aiCount);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
    const healthInterval = setInterval(refreshData, 5000);
    const ageInterval = setInterval(() => setSlotAge((prev) => prev + 50), 50);

    const connectWs = () => {
      const wsUrl = process.env['NEXT_PUBLIC_WS_URL'] || (API_BASE.startsWith('https') ? API_BASE.replace('https://', 'wss://') : API_BASE.replace('http://', 'ws://')) + '/ws';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connectWs, 3000);
      };
      ws.onerror = () => setConnected(false);
      ws.onmessage = (event) => {
        try {
          const { type, data } = JSON.parse(event.data);
          if (type === 'slot:new') {
            setCurrentSlot(data.slot);
            setSlotAge(0);
          } else if (type === 'leader:current') {
            setLeaderInfo(data);
          } else if (type === 'bundle:sent') {
            setActiveBundlesCount((prev) => prev + 1);
          } else if (type === 'bundle:landed' || type === 'bundle:dropped') {
            setActiveBundlesCount((prev) => Math.max(0, prev - 1));
          } else if (type === 'ai:decision:received') {
            setLiveAiDecisionsCount((prev) => prev + 1);
            setTransactions((prev) =>
              prev.map((tx) => (tx.id === data.transactionId ? { ...tx, aiDecision: data } : tx)),
            );
          } else if (type.startsWith('tx:')) {
            setTransactions((prev) => {
              const exists = prev.some((tx) => tx.id === data.id);
              if (!exists) return [data, ...prev].slice(0, 80);
              return prev.map((tx) => (tx.id === data.id ? { ...tx, ...data } : tx));
            });
          }
        } catch {
          setNotice({ type: 'error', message: 'Live feed returned an unreadable event.' });
        }
      };
    };

    connectWs();
    return () => {
      clearInterval(healthInterval);
      clearInterval(ageInterval);
      wsRef.current?.close();
    };
  }, []);

  const submitTransaction = async (path: string, successMessage: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch(`${API_BASE}${path}`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Backend rejected the submission.');
      setNotice({ type: 'success', message: successMessage });
      await refreshData();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Transaction submission failed.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  };

  const stats = useMemo(() => {
    const finalized = transactions.filter((tx) => tx.status === 'FINALIZED').length;
    const retried = transactions.filter((tx) => tx.retryCount > 0).length;
    const failed = transactions.filter((tx) => tx.status === 'FAILED' || tx.status === 'ABANDONED').length;
    const complete = transactions.filter((tx) => tx.processedAt && tx.confirmedAt && tx.finalizedAt).length;
    const latest = transactions[0] ?? null;
    return { finalized, retried, failed, complete, latest };
  }, [transactions]);

  const activeStepIndex = useMemo(() => {
    if (!stats.latest) return 0;
    const s = stats.latest.status;
    if (s === 'FINALIZED') return 5;
    if (s === 'CONFIRMED' || s === 'PROCESSED') return 4;
    if (s === 'RETRYING') return 4;
    if (stats.latest.submittedAt) return 3;
    if (stats.latest.simulatedAt) return 2;
    return 1;
  }, [stats.latest]);

  const chartData = useMemo(() => {
    return transactions
      .slice(0, 15)
      .reverse()
      .map((tx) => {
        const finalityMs = tx.finalizedAt && tx.createdAt ? tx.finalizedAt - tx.createdAt : 0;
        return {
          name: tx.id.slice(-6),
          latency: finalityMs ? parseFloat((finalityMs / 1000).toFixed(2)) : 0,
          tip: tx.tipLamports ? parseFloat((tx.tipLamports / 1e9).toFixed(6)) : 0,
        };
      });
  }, [transactions]);

  const pipelineSteps = [
    { label: 'Stream', state: connected ? 'Live' : 'Retrying' },
    { label: 'Build', state: 'Versioned TX' },
    { label: 'Simulate', state: 'Preflight' },
    { label: 'Route', state: readiness?.claims.rpcFallbackDisclosed ? 'RPC fallback' : 'Jito' },
    { label: 'Recover', state: `${stats.retried} retries` },
    { label: 'Finalize', state: `${stats.finalized} landed` },
  ];

  // Effective AI decisions = live WS count OR readiness evidence (whichever is higher)
  const effectiveAiDecisions = Math.max(liveAiDecisionsCount, readiness?.evidence.aiDecisions ?? 0);

  return (
    <main className="min-h-screen bg-ambient-glow text-zinc-100 py-6 font-sans">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

        {/* ── Floating Header ── */}
        <header className="sticky top-4 z-30 mb-6 rounded-2xl border border-white/[0.06] bg-[#060709]/80 px-6 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)] animate-pulse-glow">
                <Zap className="h-5 w-5 text-emerald-400" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-white">Solstice</h1>
                  <Pill tone={readiness?.claims.mainnetJitoLandingProven ? 'emerald' : 'amber'}>
                    {readiness?.mode === 'MAINNET_JITO_PROVEN'
                      ? 'Mainnet · Jito proven'
                      : readiness?.network === 'devnet'
                        ? 'Devnet fallback lane'
                        : 'Mainnet · path wired'}
                  </Pill>
                  <Pill tone={connected ? 'emerald' : 'rose'}>{connected ? 'Live stream' : 'Reconnecting'}</Pill>
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Validator-aware transaction infrastructure. Smart routing, AI-guided recovery.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Live slot ticker */}
              {currentSlot && (
                <div className="hidden sm:flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981] animate-pulse" />
                  <span className="font-mono text-xs text-zinc-300 tabular-nums">
                    slot <span className="text-white font-bold">{currentSlot.toLocaleString()}</span>
                  </span>
                  <span className="text-zinc-600 text-[10px]">{slotAge}ms</span>
                </div>
              )}
              <ActionButton
                onClick={() => submitTransaction('/api/v1/transactions', 'Standard transaction submitted to the orchestrator.')}
                disabled={isSubmitting}
                icon={isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              >
                Send test
              </ActionButton>
              <ActionButton
                variant="danger"
                onClick={() =>
                  submitTransaction(
                    '/api/v1/transactions/expired',
                    'Expired blockhash fault queued. Watch recovery.',
                  )
                }
                disabled={isSubmitting}
                icon={isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
              >
                Inject fault
              </ActionButton>
              <button
                type="button"
                onClick={refreshData}
                className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-zinc-200 transition-all duration-200 hover:bg-white/[0.08] hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Refresh
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-6">
          {notice && <NoticeBar notice={notice} />}
          {loadError && <ErrorBar message={loadError} onRetry={refreshData} />}

          {/* ── KPI Strip ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label="Finalized"
              value={stats.finalized.toLocaleString()}
              sub={`of ${transactions.length} total`}
              accent="emerald"
              icon={<Check className="h-4 w-4" />}
            />
            <KpiCard
              label="Inflight Bundles"
              value={activeBundlesCount.toLocaleString()}
              sub="live via WebSocket"
              accent="sky"
              icon={<Radio className="h-4 w-4" />}
            />
            <KpiCard
              label="AI Decisions"
              value={effectiveAiDecisions.toLocaleString()}
              sub="fault recovery ops"
              accent="violet"
              icon={<Brain className="h-4 w-4" />}
            />
            <KpiCard
              label="Retry Events"
              value={stats.retried.toLocaleString()}
              sub={`${stats.failed} abandoned`}
              accent="amber"
              icon={<RotateCcw className="h-4 w-4" />}
            />
          </div>

          {/* ── Main Grid ── */}
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">

            {/* Left: Pipeline + Chart */}
            <div className="overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.01] backdrop-blur-md shadow-2xl">
              <div className="border-b border-white/[0.05] p-6 bg-white/[0.01]">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Execution path</p>
                    <p className="mt-1 text-xs text-zinc-500 max-w-sm">
                      Live stream → simulated build → Jito/RPC routing → on-chain finality
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Signal label="Finalized" value={stats.finalized.toLocaleString()} />
                    <Signal label="Complete" value={`${stats.complete}/${transactions.length}`} />
                    <Signal label="Retries" value={stats.retried.toLocaleString()} />
                    <Signal label="Faults" value={stats.failed.toLocaleString()} />
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-zinc-200 tracking-tight">Pipeline stepper</h2>
                    <p className="mt-0.5 text-xs text-zinc-500">Active step highlighted. Progress tracked per latest transaction.</p>
                  </div>
                  <span className="hidden font-mono text-xs text-zinc-500 bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/5 sm:block">
                    leader:{' '}
                    <span className="text-emerald-400 font-bold">
                      {leaderInfo ? truncate(leaderInfo.validator ?? leaderInfo.leader ?? 'unknown', 6) : 'pending'}
                    </span>
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-6 relative z-10">
                  <div className="absolute top-[28px] left-6 right-6 h-0.5 bg-white/[0.03] hidden md:block -z-10" />
                  <div
                    className="absolute top-[28px] left-6 h-0.5 bg-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)] hidden md:block -z-10 transition-all duration-700"
                    style={{ width: `${(Math.min(activeStepIndex, 5) / 5) * 83}%` }}
                  />
                  {pipelineSteps.map((step, index) => (
                    <PipelineStep key={step.label} step={step} index={index} active={index <= activeStepIndex} />
                  ))}
                </div>

                {/* Readiness callout */}
                <div className="mt-6 rounded-2xl border border-white/[0.05] bg-white/[0.01] p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">
                        {readiness?.claims.mainnetJitoLandingProven
                          ? 'Mainnet Jito proof captured'
                          : readiness?.network === 'devnet'
                            ? 'Devnet fallback active & disclosed'
                            : 'Mainnet path wired · Jito landing not yet claimed'}
                      </p>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
                        This run proves construction, lifecycle tracking, retry recovery, and telemetry. It does
                        not pretend an RPC fallback execution is a landed Jito bundle —{' '}
                        <code className="text-zinc-400">mainnetJitoLandingProven</code> stays false until{' '}
                        <code className="text-zinc-400">tips.totalLanded &gt; 0</code>.
                      </p>
                    </div>
                    <a
                      href={`${API_BASE}/api/v1/readiness`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 text-sm font-semibold text-zinc-300 transition-all duration-200 hover:bg-white/[0.08] hover:text-white active:scale-[0.98] focus-visible:outline-none"
                    >
                      Readiness JSON
                      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </div>
                </div>

                {/* Latency Area Chart */}
                <div className="mt-6 border-t border-white/[0.05] pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        On-Chain Landing Latency
                      </h3>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        Confirmation timings (seconds) across the last 15 submissions.
                      </p>
                    </div>
                    {chartData.length > 0 && (
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/5 px-2.5 py-0.5 rounded-lg border border-emerald-500/10">
                        avg:{' '}
                        {(chartData.reduce((acc, curr) => acc + curr.latency, 0) / chartData.length).toFixed(2)}s
                      </span>
                    )}
                  </div>
                  <div className="h-44 w-full bg-black/15 rounded-xl border border-white/[0.02] p-2.5">
                    {chartData.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-xs text-zinc-600 font-mono">
                        Awaiting transaction landing data...
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.12} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" vertical={false} />
                          <XAxis
                            dataKey="name"
                            stroke="rgba(255,255,255,0.2)"
                            fontSize={9}
                            fontFamily="var(--font-mono)"
                            tickLine={false}
                          />
                          <YAxis
                            stroke="rgba(255,255,255,0.2)"
                            fontSize={9}
                            fontFamily="var(--font-mono)"
                            tickLine={false}
                            axisLine={false}
                            unit="s"
                          />
                          <ChartTooltip
                            contentStyle={{
                              background: 'rgba(6,7,9,0.9)',
                              border: '1px solid rgba(255,255,255,0.08)',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                            }}
                            itemStyle={{ color: '#34d399' }}
                            labelClassName="text-zinc-500 font-semibold"
                          />
                          <Area
                            type="monotone"
                            dataKey="latency"
                            stroke="#10b981"
                            strokeWidth={1.5}
                            fillOpacity={1}
                            fill="url(#colorLatency)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Panels */}
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
              <LeaderPanel leaderInfo={leaderInfo} readiness={readiness} />
              <ReadinessPanel
                readiness={readiness}
                activeBundlesCount={activeBundlesCount}
                aiDecisionsCount={effectiveAiDecisions}
              />
              <HealthPanel health={health} readiness={readiness} />
            </div>
          </section>

          {/* ── Evidence Ledger ── */}
          <section className="overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.01] shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-white/[0.05] p-5 bg-white/[0.01] lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-bold text-zinc-200 tracking-tight">Evidence ledger</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Newest transactions first. Expand a row when a judge asks, {"\"prove it.\""}
                </p>
              </div>
              {stats.latest && (
                <p className="font-mono text-xs text-zinc-500 bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/5">
                  latest: <span className="text-zinc-300 font-bold">{stats.latest.id}</span>
                  <span className="text-zinc-600 mx-1">|</span>
                  {formatTime(stats.latest.createdAt)}
                </p>
              )}
            </div>

            <div className="p-3">
              {isLoading ? (
                <LedgerSkeleton />
              ) : transactions.length === 0 ? (
                <EmptyLedger
                  onStart={() =>
                    submitTransaction('/api/v1/transactions', 'Standard transaction submitted to the orchestrator.')
                  }
                />
              ) : (
                <div className="divide-y divide-white/[0.03] bg-transparent">
                  {transactions.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      isExpanded={expandedTxId === tx.id}
                      onToggle={() => setExpandedTxId(expandedTxId === tx.id ? null : tx.id)}
                      copied={copied}
                      onCopy={copyText}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <footer className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-white/[0.04] pt-6 pb-4 sm:flex-row">
            <p className="text-[10px] text-zinc-600">© 2026 Solstice Intelligence. All rights reserved.</p>
            <p className="text-[10px] text-zinc-600 font-mono">
              Design philosophy inspired by Emil Kowalski · emilkowal.ski
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
type AccentColor = 'emerald' | 'sky' | 'violet' | 'amber';

function KpiCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  accent: AccentColor;
  icon: ReactNode;
}) {
  const accentMap: Record<AccentColor, { border: string; bg: string; text: string; iconBg: string; glow: string }> = {
    emerald: {
      border: 'border-emerald-500/15',
      bg: 'bg-emerald-500/[0.03]',
      text: 'text-emerald-400',
      iconBg: 'bg-emerald-500/10 border-emerald-500/20',
      glow: 'shadow-[0_0_20px_-8px_rgba(16,185,129,0.3)]',
    },
    sky: {
      border: 'border-sky-500/15',
      bg: 'bg-sky-500/[0.03]',
      text: 'text-sky-400',
      iconBg: 'bg-sky-500/10 border-sky-500/20',
      glow: 'shadow-[0_0_20px_-8px_rgba(56,189,248,0.3)]',
    },
    violet: {
      border: 'border-violet-500/15',
      bg: 'bg-violet-500/[0.03]',
      text: 'text-violet-400',
      iconBg: 'bg-violet-500/10 border-violet-500/20',
      glow: 'shadow-[0_0_20px_-8px_rgba(139,92,246,0.3)]',
    },
    amber: {
      border: 'border-amber-500/15',
      bg: 'bg-amber-500/[0.03]',
      text: 'text-amber-400',
      iconBg: 'bg-amber-500/10 border-amber-500/20',
      glow: 'shadow-[0_0_20px_-8px_rgba(245,158,11,0.3)]',
    },
  };
  const a = accentMap[accent];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 transition-all duration-200 hover:scale-[1.01] ${a.border} ${a.bg} ${a.glow}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{label}</p>
          <p className={`mt-2 font-mono text-3xl font-extrabold tabular-nums tracking-tight ${a.text}`}>
            {value}
          </p>
          <p className="mt-1 truncate text-[10px] text-zinc-600">{sub}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${a.iconBg} ${a.text}`}>
          {icon}
        </span>
      </div>
    </div>
  );
}

// ── Leader Panel ──────────────────────────────────────────────────────────────
function LeaderPanel({ leaderInfo, readiness }: { leaderInfo: any; readiness: Readiness | null }) {
  const isJito = leaderInfo?.isJitoValidator ?? false;
  const validatorKey = leaderInfo?.validator ?? leaderInfo?.leader ?? null;

  return (
    <section className="glass-card rounded-2xl border border-white/[0.05] p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-bold text-zinc-200 tracking-tight">Current leader</h2>
          <p className="mt-0.5 text-xs text-zinc-500 font-mono">Validator-aware routing</p>
        </div>
        <Pill tone={isJito ? 'emerald' : 'amber'}>{isJito ? 'Jito validator' : 'Standard leader'}</Pill>
      </div>

      <div className="space-y-2.5">
        <div className="rounded-xl border border-white/[0.04] bg-black/20 px-3.5 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Validator</p>
          <p className="font-mono text-xs text-zinc-200 break-all leading-relaxed">
            {validatorKey ?? <span className="text-zinc-600 animate-pulse">Polling...</span>}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Fact
            label="Type"
            value={isJito ? 'Jito' : leaderInfo ? 'Standard' : '—'}
          />
          <Fact
            label="Epoch"
            value={readiness?.leader.cachedEpoch ? readiness.leader.cachedEpoch.toString() : '—'}
          />
          <Fact
            label="Jito count"
            value={(readiness?.leader.knownJitoValidators ?? 0).toString()}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Fact
            label="Schedule size"
            value={readiness?.leader.scheduleSize ? readiness.leader.scheduleSize.toLocaleString() : '—'}
          />
          <Fact
            label="Messages/s"
            value={readiness?.stream.messagesPerSecond
              ? readiness.stream.messagesPerSecond.toFixed(1)
              : '—'}
          />
        </div>

        {/* Jito tips performance */}
        {readiness?.tips && (
          <div className="mt-1 rounded-xl border border-white/[0.03] bg-white/[0.005] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
              Jito tips performance
            </p>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
              <div>
                <p className="text-[10px] text-zinc-600">Sent</p>
                <p className="font-mono text-xs font-bold text-zinc-300">{readiness.tips.totalSent}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-600">Landed</p>
                <p className="font-mono text-xs font-bold text-emerald-400">{readiness.tips.totalLanded}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-600">Rate</p>
                <p className="font-mono text-xs font-bold text-emerald-400">
                  {(readiness.tips.landingRate * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-600">Avg landed</p>
                <p className="font-mono text-xs font-bold text-zinc-300">
                  {readiness.tips.avgTipLanded
                    ? `${(readiness.tips.avgTipLanded / 1e9).toFixed(5)} SOL`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-600">Dropped</p>
                <p className="font-mono text-xs font-bold text-rose-400">{readiness.tips.totalDropped}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-600">Avg dropped</p>
                <p className="font-mono text-xs font-bold text-zinc-400">
                  {readiness.tips.avgTipDropped
                    ? `${(readiness.tips.avgTipDropped / 1e9).toFixed(5)} SOL`
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Readiness Panel ───────────────────────────────────────────────────────────
function ReadinessPanel({
  readiness,
  activeBundlesCount,
  aiDecisionsCount,
}: {
  readiness: Readiness | null;
  activeBundlesCount: number;
  aiDecisionsCount: number;
}) {
  const claims = [
    ['Devnet prototype', readiness?.claims.devnetPrototype],
    ['RPC fallback disclosed', readiness?.claims.rpcFallbackDisclosed],
    ['Mainnet Jito wired', readiness?.claims.mainnetJitoPathWired],
    ['SWQoS staked lane active', readiness?.claims.swqosStakedLaneActive],
    ['Jito landing proven', readiness?.claims.mainnetJitoLandingProven],
  ] as const;

  return (
    <section className="glass-card rounded-2xl border border-white/[0.05] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-zinc-200 tracking-tight">Submission posture</h2>
          <p className="mt-0.5 text-xs text-zinc-500 font-mono capitalize">
            {readiness?.mode?.replaceAll('_', ' ') ?? 'Loading readiness'}
          </p>
        </div>
        <Pill tone={readiness?.claims.mainnetJitoLandingProven ? 'emerald' : 'amber'}>
          {readiness?.network?.toUpperCase() ?? '...'}
        </Pill>
      </div>
      <div className="mt-4 space-y-2.5">
        {claims.map(([label, ok]) => (
          <div key={label} className="flex items-center justify-between gap-3 border-b border-white/[0.03] py-2 last:border-b-0">
            <span className="text-xs text-zinc-400">{label}</span>
            {ok ? (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Check className="h-3 w-3 text-emerald-400" aria-label="Complete" />
              </div>
            ) : (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 border border-zinc-800">
                <CircleDashed className="h-3 w-3 text-zinc-600 animate-spin [animation-duration:8s]" aria-label="Pending" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <Fact label="AI Decisions" value={aiDecisionsCount.toString()} />
        <Fact label="Complete rows" value={(readiness?.evidence.completeLifecycleTransactions ?? 0).toString()} />
        <Fact label="Inflight" value={activeBundlesCount.toString()} />
      </div>
    </section>
  );
}

// ── Health Panel ──────────────────────────────────────────────────────────────
function HealthPanel({ health, readiness }: { health: any; readiness: Readiness | null }) {
  return (
    <section className="glass-card rounded-2xl border border-white/[0.05] p-5">
      <h2 className="text-sm font-bold text-zinc-200 tracking-tight">System pulse</h2>
      <p className="mt-0.5 text-xs text-zinc-500">Quiet status. No fake greenwashing.</p>
      <div className="mt-4 space-y-3">
        <HealthItem
          icon={<Radio className="h-4 w-4" />}
          label="Stream"
          status={health?.stream?.status}
          detail={health?.stream?.message || readiness?.stream.status || 'Waiting'}
        />
        <HealthItem
          icon={<Activity className="h-4 w-4" />}
          label="RPC"
          status={health?.rpc?.status}
          detail={health?.rpc?.latencyMs ? `${health.rpc.latencyMs}ms` : 'Primary reachable'}
        />
        <HealthItem
          icon={<Database className="h-4 w-4" />}
          label="State"
          status={health?.postgres?.status}
          detail={health?.postgres?.latencyMs ? `${health.postgres.latencyMs}ms` : 'Prisma ready'}
        />
        <HealthItem
          icon={<Server className="h-4 w-4" />}
          label="Jito path"
          status={health?.jito?.status}
          detail={
            readiness?.claims.mainnetJitoLandingProven ? 'Proof captured' : 'Wired, not claimed'
          }
        />
      </div>
    </section>
  );
}

// ── Health Item ───────────────────────────────────────────────────────────────
function HealthItem({
  icon,
  label,
  status,
  detail,
}: {
  icon: ReactNode;
  label: string;
  status?: string;
  detail: string;
}) {
  const healthy = status === 'healthy';
  const degraded = status === 'degraded';

  const statusColor = healthy
    ? 'text-emerald-400 border-emerald-500/25 bg-emerald-500/5'
    : degraded
    ? 'text-amber-400 border-amber-500/25 bg-amber-500/5'
    : 'text-zinc-500 border-white/5 bg-white/[0.01]';

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl border border-white/[0.02] bg-white/[0.005] hover:bg-white/[0.015] transition-all duration-200">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm ${statusColor}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-zinc-300">{label}</p>
        <p className="truncate text-[10px] text-zinc-500 font-mono mt-0.5">{detail}</p>
      </div>
      <span className="flex h-1.5 w-1.5 relative">
        {healthy && (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500 shadow-[0_0_8px_#10b981]" />
          </>
        )}
        {degraded && (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500 shadow-[0_0_8px_#f59e0b]" />
          </>
        )}
        {!healthy && !degraded && (
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-zinc-600" />
        )}
      </span>
    </div>
  );
}

// ── Action Button ─────────────────────────────────────────────────────────────
function ActionButton({
  children,
  icon,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'danger';
}) {
  const classes =
    variant === 'primary'
      ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400 focus-visible:ring-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.2)]'
      : 'border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 focus-visible:ring-rose-500 shadow-[0_4px_12px_rgba(239,68,68,0.1)]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${classes}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Signal ────────────────────────────────────────────────────────────────────
function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 border-l border-white/10 pl-3">
      <p className="text-xs font-semibold text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

// ── Pipeline Step ─────────────────────────────────────────────────────────────
function PipelineStep({
  step,
  index,
  active,
}: {
  step: { label: string; state: string };
  index: number;
  active: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-4 transition-all duration-200 ${
        active
          ? 'border-emerald-500/20 bg-emerald-500/[0.02] shadow-[0_4px_20px_-8px_rgba(16,185,129,0.15)]'
          : 'border-white/[0.04] bg-white/[0.005]'
      }`}
    >
      {active && (
        <span className="absolute top-3 right-3 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      )}
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${
            active ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 text-zinc-500'
          }`}
        >
          {index + 1}
        </span>
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-300">{step.label}</p>
      </div>
      <p className="mt-3 truncate font-mono text-xs text-zinc-400 bg-black/25 px-2 py-1 rounded border border-white/[0.03]">
        {step.state}
      </p>
    </div>
  );
}

// ── Transaction Row ───────────────────────────────────────────────────────────
function TransactionRow({
  tx,
  isExpanded,
  onToggle,
  copied,
  onCopy,
}: {
  tx: Transaction;
  isExpanded: boolean;
  onToggle: () => void;
  copied: string | null;
  onCopy: (label: string, text: string) => void;
}) {
  const finalityMs = tx.finalizedAt ? tx.finalizedAt - tx.createdAt : null;
  const mode = tx.bundleId?.startsWith('rpc_fallback') ? 'RPC fallback' : tx.bundleId ? 'Bundle record' : 'Pending';

  return (
    <article className={`transition-all duration-200 ${isExpanded ? 'bg-white/[0.01]' : 'bg-transparent'}`}>
      <button
        type="button"
        onClick={onToggle}
        className="grid min-h-[72px] w-full grid-cols-1 gap-4 px-5 py-4 text-left transition-all duration-200 hover:bg-white/[0.02] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 md:grid-cols-[minmax(220px,1fr)_140px_140px_120px_32px] md:items-center border-b border-white/[0.03]"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-zinc-100 tracking-tight">{tx.id}</span>
            <StatusBadge status={tx.status} />
            {tx.retryCount > 0 && <Pill tone="amber">Retry {tx.retryCount}</Pill>}
          </div>
          <p className="mt-1 truncate text-xs text-zinc-500 font-mono">
            {tx.signature ? truncate(tx.signature, 8) : 'Signature pending'}
          </p>
        </div>
        <Field label="Mode" value={mode} />
        <Field label="Slot" value={tx.slot ? tx.slot.toLocaleString() : '--'} />
        <Field label="Latency" value={finalityMs ? `${(finalityMs / 1000).toFixed(2)}s` : '--'} />
        <span className="hidden justify-self-end md:block">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-zinc-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-zinc-400" />
            )}
          </div>
        </span>
      </button>

      {isExpanded && (
        <div className="px-5 pb-5 pt-3">
          <div className="rounded-2xl border border-white/[0.05] bg-black/20 p-5 shadow-inner">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-5">
                {tx.signature && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Transaction Signature</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <code className="min-w-0 flex-1 truncate rounded-xl bg-black/45 border border-white/[0.03] px-4 py-2.5 font-mono text-xs text-emerald-400">
                        {tx.signature}
                      </code>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onCopy(tx.id, tx.signature!)}
                          className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-xs font-semibold text-zinc-300 transition-all duration-200 hover:bg-white/[0.08] active:scale-[0.97]"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          {copied === tx.id ? 'Copied' : 'Copy'}
                        </button>
                        <a
                          href={`https://explorer.solana.com/tx/${tx.signature}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 text-xs font-semibold text-emerald-300 transition-all duration-200 hover:bg-emerald-500/10 active:scale-[0.97]"
                        >
                          Explorer
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {tx.lastError && (
                  <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.02] p-4 text-xs text-rose-300">
                    <p className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px] text-rose-400">
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Failure Diagnosis
                    </p>
                    <p className="mt-2.5 break-all font-mono text-xs leading-relaxed bg-black/25 p-3 rounded-lg border border-rose-500/10 text-rose-200">
                      {tx.lastError}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Lifecycle Milestones</p>
                  <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-5">
                    <Stage label="Created" time={tx.createdAt} active />
                    <Stage label="Processed" time={tx.processedAt} active={Boolean(tx.processedAt)} />
                    <Stage label="Confirmed" time={tx.confirmedAt} active={Boolean(tx.confirmedAt)} />
                    <Stage
                      label="Finalized"
                      time={tx.finalizedAt}
                      active={Boolean(tx.finalizedAt)}
                      success={tx.status === 'FINALIZED'}
                    />
                    <Stage
                      label="Retry"
                      time={tx.failedAt}
                      active={tx.retryCount > 0}
                      warn={tx.retryCount > 0}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {tx.aiDecision ? (
                  <div className="rounded-xl border border-violet-500/25 bg-black/45 shadow-[inset_0_1px_1px_rgba(255,255,255,0.01),0_0_24px_-8px_rgba(139,92,246,0.18)] overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-3.5 py-2">
                      <div className="flex gap-1.5 items-center">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                      </div>
                      <span className="font-mono text-[9px] text-violet-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <Brain className="h-3 w-3 animate-pulse" />
                        AI Optimization Engine
                      </span>
                    </div>
                    <div className="p-3.5 font-mono text-[11px] leading-relaxed space-y-3">
                      <div className="flex items-center justify-between text-zinc-500 border-b border-white/[0.03] pb-1.5">
                        <span>Model: {tx.aiDecision.modelUsed}</span>
                        <span>Latency: {tx.aiDecision.latencyMs}ms</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-violet-950/20 p-2.5 rounded-lg border border-violet-500/10 text-violet-200">
                        <div>
                          <span className="text-violet-400">shouldRetry:</span>{' '}
                          {tx.aiDecision.decision.shouldRetry ? 'true' : 'false'}
                        </div>
                        <div>
                          <span className="text-violet-400">splitBundle:</span>{' '}
                          {tx.aiDecision.decision.splitBundle ? 'true' : 'false'}
                        </div>
                        <div>
                          <span className="text-violet-400">delayMs:</span> {tx.aiDecision.decision.delayMs}ms
                        </div>
                        <div>
                          <span className="text-violet-400">confidence:</span>{' '}
                          {(tx.aiDecision.decision.confidence * 100).toFixed(0)}%
                        </div>
                        <div className="col-span-2 truncate">
                          <span className="text-violet-400">newTip:</span>{' '}
                          {tx.aiDecision.decision.newTipLamports
                            ? `${(tx.aiDecision.decision.newTipLamports / 1e9).toFixed(6)} SOL`
                            : 'null'}
                        </div>
                      </div>
                      <div className="text-zinc-300 leading-normal border-t border-white/[0.03] pt-2">
                        <span className="text-emerald-400 font-bold">$</span> cat reasoning.log
                        <span className="inline-block h-3 w-1.5 bg-emerald-400/80 ml-1.5 align-middle animate-cursor-blink" />
                        <p className="mt-1.5 text-zinc-400 italic font-sans text-xs">
                          {tx.aiDecision.decision.reasoning}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/5 bg-black/30 p-4 font-mono text-xs leading-normal">
                    <div className="flex items-center gap-2 text-zinc-400 mb-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                      <span>No Optimization Trace</span>
                    </div>
                    <p className="font-sans text-xs text-zinc-500">
                      This transaction did not require an AI failure diagnostic path.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Fact label="Tip" value={tx.tipLamports ? `${(tx.tipLamports / 1e9).toFixed(6)} SOL` : '--'} />
                  <Fact label="CU limit" value={tx.computeUnitLimit ? tx.computeUnitLimit.toLocaleString() : '--'} />
                  <Fact label="CU price" value={tx.computeUnitPrice ? `${tx.computeUnitPrice}` : '--'} />
                  <Fact label="Failure" value={tx.failureCategory ?? '--'} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

// ── Notice / Error Bars ───────────────────────────────────────────────────────
function NoticeBar({ notice }: { notice: Exclude<Notice, null> }) {
  return (
    <div
      className={`rounded-xl border p-4 text-xs font-semibold ${
        notice.type === 'success'
          ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300 shadow-[0_4px_12px_rgba(16,185,129,0.1)]'
          : 'border-rose-500/20 bg-rose-500/5 text-rose-300 shadow-[0_4px_12px_rgba(239,68,68,0.1)]'
      }`}
    >
      {notice.message}
    </div>
  );
}

function ErrorBar({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-xs text-rose-300 shadow-[0_4px_12px_rgba(239,68,68,0.1)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 font-semibold text-rose-200 transition-all duration-200 hover:bg-rose-500/20 active:scale-[0.98] focus-visible:outline-none"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    </div>
  );
}

// ── Empty / Skeleton States ───────────────────────────────────────────────────
function EmptyLedger({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.005] p-6 text-center">
      <Database className="h-8 w-8 text-zinc-600" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-zinc-300">No evidence rows yet</p>
        <p className="mt-1 max-w-sm text-xs leading-normal text-zinc-500">
          Send one transaction, then inject a failure. The ledger will start telling the story.
        </p>
      </div>
      <ActionButton onClick={onStart} icon={<Zap className="h-4 w-4" />}>
        Create first row
      </ActionButton>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-xl bg-white/[0.01] border border-white/[0.02]" />
      ))}
    </div>
  );
}

// ── Shared Micro-components ───────────────────────────────────────────────────
function Stage({
  label,
  time,
  active,
  success,
  warn,
}: {
  label: string;
  time: number | null;
  active: boolean;
  success?: boolean;
  warn?: boolean;
}) {
  const dotColor = success
    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
    : warn
    ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
    : active
    ? 'bg-sky-400 shadow-[0_0_8px_#38bdf8]'
    : 'bg-zinc-700';
  return (
    <div className={`rounded-xl border p-3 ${active ? 'border-white/5 bg-white/[0.015]' : 'border-white/[0.02] bg-white/[0.002]'}`}>
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-300">{label}</p>
      </div>
      <p className="mt-2 font-mono text-[10px] tabular-nums text-zinc-500">
        {time ? formatTime(time) : 'Pending'}
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-semibold tabular-nums text-zinc-300">{value}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-bold tabular-nums text-zinc-200">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'FINALIZED'
      ? 'emerald'
      : status === 'FAILED' || status === 'ABANDONED'
      ? 'rose'
      : status === 'RETRYING'
      ? 'amber'
      : 'sky';
  return <Pill tone={tone}>{status}</Pill>;
}

function Pill({
  tone,
  children,
}: {
  tone: 'emerald' | 'amber' | 'rose' | 'sky';
  children: ReactNode;
}) {
  const styles = {
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-[0_0_8px_-2px_rgba(16,185,129,0.15)]',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-400 shadow-[0_0_8px_-2px_rgba(245,158,11,0.15)]',
    rose: 'border-rose-500/20 bg-rose-500/10 text-rose-400 shadow-[0_0_8px_-2px_rgba(239,68,68,0.15)]',
    sky: 'border-sky-500/20 bg-sky-500/10 text-sky-400 shadow-[0_0_8px_-2px_rgba(56,189,248,0.15)]',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold leading-none ${styles[tone]}`}>
      {children}
    </span>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function truncate(value: string, chars = 4) {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString();
}
