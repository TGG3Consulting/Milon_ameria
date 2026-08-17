import { env } from '../config/env.js';
import { fetchAmeriaTransactions } from './ameriaClient.js';
import { addActivity } from './activityStore.js';
import { importBankTransaction } from './matchEngine.js';

let activeSync = null;

export function syncAmeriaTransactions(params = {}) {
  if (activeSync) return activeSync;

  activeSync = runSync(params).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function runSync(params) {
  const transactions = await fetchAmeriaTransactions(params);
  const results = [];

  for (const transaction of transactions) {
    results.push(await importBankTransaction(transaction));
  }

  const imported = results.filter((result) => result.created).length;
  const skipped = results.length - imported;
  await addActivity({
    receiptId: '-',
    action: `Ameriabank sync completed: ${imported} imported, ${skipped} skipped`,
    actor: 'System'
  });

  return {
    ok: true,
    received: transactions.length,
    imported,
    skipped,
    receipts: results.map((result) => result.receipt)
  };
}

export function startAmeriaScheduler() {
  if (!env.AMERIA_SYNC_ENABLED) return null;

  const run = () => {
    syncAmeriaTransactions().catch((error) => {
      console.error('Scheduled Ameriabank sync failed:', error.message);
    });
  };
  const timer = setInterval(run, env.AMERIA_SYNC_INTERVAL_MS);
  timer.unref();

  if (env.AMERIA_SYNC_RUN_ON_START) run();
  return timer;
}
