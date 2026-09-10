import { env } from '../config/env.js';
import { fetchAmeriaTransactions } from './ameriaClient.js';
import { addActivity } from './activityStore.js';
import { importBankTransaction } from './matchEngine.js';

let activeSync = null;
let schedulerTimer = null;
let schedulerStartedAt = null;

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function getSyncRanges(params = {}) {
  const now = new Date();
  const dateFrom = String(params.dateFrom ?? env.AMERIA_SYNC_FROM_DATE);
  const dateTo = String(params.dateTo ?? toDateString(now));
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    const error = new Error('Invalid Ameria sync date range');
    error.status = 400;
    throw error;
  }

  const ranges = [];
  let cursor = start;
  while (cursor <= end) {
    const yearEnd = new Date(Date.UTC(cursor.getUTCFullYear(), 11, 31));
    const chunkEnd = yearEnd < end ? yearEnd : end;
    ranges.push({ ...params, dateFrom: toDateString(cursor), dateTo: toDateString(chunkEnd) });
    cursor = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  return ranges;
}

function transactionKey(transaction) {
  const account = transaction.accountNumber ?? '';
  const id = transaction.transactionId ?? transaction.bankTransactionId ?? transaction.transferId;
  return id ? `${account}:${id}` : null;
}

export function syncAmeriaTransactions(params = {}) {
  if (activeSync) return activeSync;

  activeSync = runSync(params).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function runSync(params) {
  const transactionMap = new Map();
  let rangeCount = 0;

  for (const range of getSyncRanges(params)) {
    rangeCount += 1;
    const transactions = await fetchAmeriaTransactions(range);
    for (const transaction of transactions) {
      const key = transactionKey(transaction);
      if (key) transactionMap.set(key, transaction);
      else transactionMap.set(Symbol(), transaction);
    }
  }

  const transactions = [...transactionMap.values()];
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
    ranges: rangeCount,
    receipts: results.map((result) => result.receipt)
  };
}

export function getAmeriaSchedulerStatus() {
  return {
    running: Boolean(schedulerTimer),
    startedAt: schedulerStartedAt,
    intervalMs: env.AMERIA_SYNC_INTERVAL_MS,
    fromDate: env.AMERIA_SYNC_FROM_DATE
  };
}

export function startAmeriaScheduler({ force = false, runImmediately = false } = {}) {
  if (!force && !env.AMERIA_SYNC_ENABLED) return getAmeriaSchedulerStatus();
  if (schedulerTimer) return getAmeriaSchedulerStatus();

  const run = () => {
    syncAmeriaTransactions().catch((error) => {
      console.error('Scheduled Ameriabank sync failed:', error.message);
    });
  };
  const timer = setInterval(run, env.AMERIA_SYNC_INTERVAL_MS);
  timer.unref();
  schedulerTimer = timer;
  schedulerStartedAt = new Date().toISOString();

  if (runImmediately || env.AMERIA_SYNC_RUN_ON_START) run();
  return getAmeriaSchedulerStatus();
}

export function stopAmeriaScheduler() {
  if (schedulerTimer) globalThis.clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerStartedAt = null;
  return getAmeriaSchedulerStatus();
}
