// Solstice Hackathon Compliance Test & Log Generator
// ============================================================

const BACKEND_URL = 'http://localhost:3001';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('⚡ Starting 10-transaction compliance test script...');
  const txIds = [];

  // 1. Submit 8 normal transactions (spread out slightly to avoid nonce collision/congestion)
  for (let i = 1; i <= 8; i++) {
    try {
      console.log(`[${i}/10] Submitting standard transaction...`);
      const response = await fetch(`${BACKEND_URL}/api/v1/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (response.ok) {
        const data = await response.json();
        txIds.push(data.transactionId);
        console.log(`    Success: ${data.transactionId}`);
      } else {
        console.error(`    Failed standard submission: HTTP ${response.status}`);
      }
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
    await sleep(2000); // 2 second delay between submissions
  }

  // 2. Submit 2 expired blockhash fault injection transactions
  for (let i = 1; i <= 2; i++) {
    try {
      console.log(`[${8 + i}/10] Submitting expired blockhash fault transaction...`);
      const response = await fetch(`${BACKEND_URL}/api/v1/transactions/expired`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (response.ok) {
        const data = await response.json();
        txIds.push(data.transactionId);
        console.log(`    Success: ${data.transactionId}`);
      } else {
        console.error(`    Failed expired submission: HTTP ${response.status}`);
      }
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
    await sleep(2000);
  }

  console.log('\n⌛ All 10 transactions submitted. Waiting 90 seconds for all confirmations and retries to finalize...');
  await sleep(90000);

  console.log('\n📊 Fetching transaction lifecycle records from backend...');
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/transactions`);
    if (!response.ok) {
      throw new Error(`Failed to fetch transactions: HTTP ${response.status}`);
    }
    const txs = await response.json();

    // Filter to only include the ones we just triggered
    const triggeredTxs = txs.filter((t) => txIds.includes(t.id));

    console.log('\n📋 --- TRANSACTION LIFECYCLE COMPLIANCE LOG ---');
    console.log('| Tx ID | Type | Status | Slot | Tip Lamports | Retries | Failure Category | Latency (Sim -> Finalized) |');
    console.log('|---|---|---|---|---|---|---|---|');

    for (const tx of triggeredTxs) {
      const isExpired = tx.metadata?.forceExpiredBlockhash ? 'Expired' : 'Standard';
      const tipStr = tx.tipLamports ? `${tx.tipLamports.toLocaleString()}` : '--';
      const slotStr = tx.slot ? tx.slot : '--';
      const failures = tx.failureCategory ? tx.failureCategory : '--';
      
      let latencyStr = '--';
      if (tx.finalizedAt && tx.createdAt) {
        latencyStr = `${((tx.finalizedAt - tx.createdAt) / 1000).toFixed(2)}s`;
      }

      console.log(`| ${tx.id} | ${isExpired} | ${tx.status} | ${slotStr} | ${tipStr} | ${tx.retryCount} | ${failures} | ${latencyStr} |`);
    }

    console.log('\nDone.');
  } catch (err) {
    console.error(`Error fetching results: ${err.message}`);
  }
}

run();
