const BASE = 'http://localhost:3001';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fired = [];
async function fire(path, label) {
  try {
    const r = await fetch(BASE + path, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    const j = await r.json();
    fired.push({ id: j.transactionId, label });
    console.log(new Date().toISOString(), 'FIRED', label, j.transactionId);
  } catch (e) { console.log('fire error', label, e.message); }
}
(async () => {
  // 8 standard bundles, spaced 28s to respect Jito regional rate limits
  for (let i = 1; i <= 8; i++) { await fire('/api/v1/transactions', `standard-${i}`); await sleep(28000); }
  // 2 fault-injected (expired blockhash) — these fail then autonomously retry
  for (let i = 1; i <= 2; i++) { await fire('/api/v1/transactions/expired', `fault-${i}`); await sleep(45000); }
  // Settle, then dump final lifecycle for the fired txs
  console.log('--- settling 60s ---'); await sleep(60000);
  const txs = await (await fetch(BASE + '/api/v1/transactions')).json();
  const rd = await (await fetch(BASE + '/api/v1/readiness')).json();
  const rows = fired.map(f => {
    const t = txs.find(x => x.id === f.id) || {};
    const lat = (t.finalizedAt && t.createdAt) ? ((t.finalizedAt - t.createdAt)/1000).toFixed(2) : '';
    return { label: f.label, id: f.id, status: t.status, slot: t.slot, tip: t.tipLamports, retries: t.retryCount, cat: t.failureCategory, lat, sig: t.signature };
  });
  console.log('=== RESULTS ===');
  console.log(JSON.stringify({ readiness: { proven: rd.claims.mainnetJitoLandingProven, landed: rd.tips.totalLanded, dropped: rd.tips.totalDropped, rate: rd.tips.landingRate, realJito: rd.evidence.realJitoBundleLandings }, rows }, null, 2));
})();
