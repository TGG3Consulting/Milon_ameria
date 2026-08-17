import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultStages, planScheduleUpdates, sumAmdVouchers } from '../src/services/matchEngine.js';

const stages = getDefaultStages();

function makeSchedule(id, amount, status = stages.schedule.unpaid) {
  return { id: String(id), amount, status, remaining: amount, partialPaid: 0 };
}

test('counts only AMD receipts in the deal total', () => {
  const total = sumAmdVouchers([
    { id: '1', ufCrm19_1785737375: 100000, ufCrm19_1785737270: 1651, currencyId: 'AMD' },
    { id: '2', ufCrm19_1785737375: 500, ufCrm19_1785737270: 1653, currencyId: 'USD' },
    // Manager converted a USD receipt by hand: the enum wins over the stale currencyId.
    { id: '3', ufCrm19_1785737375: 200000, ufCrm19_1785737270: 1651, currencyId: 'USD' },
    { id: '4', ufCrm19_1785737375: 700, ufCrm19_1785737270: 1657, currencyId: '' }
  ]);

  assert.equal(total, 300000);
});

test('pays schedules in id order and marks the partially covered one', () => {
  const updates = planScheduleUpdates(
    [makeSchedule(1, 100000), makeSchedule(2, 100000), makeSchedule(3, 100000)],
    150000,
    stages
  );

  assert.deepEqual(
    updates.map((update) => [update.schedule.id, update.fields.stageId]),
    [
      ['1', stages.schedule.paid],
      ['2', stages.schedule.partial]
    ]
  );
  assert.equal(updates[1].fields.ufCrm17_1785747159082, 50000);
  assert.equal(updates[1].fields.ufCrm17_1785747288489, 50000);
  assert.equal(updates[0].fields.ufCrm17_1785747159082, '');
  assert.equal(updates[0].fields.ufCrm17_1785747288489, '');
});

test('skips schedules that are already paid but still consumes their amount', () => {
  const updates = planScheduleUpdates(
    [makeSchedule(1, 100000, stages.schedule.paid), makeSchedule(2, 100000)],
    150000,
    stages
  );

  assert.equal(updates.length, 1);
  assert.equal(updates[0].schedule.id, '2');
  assert.equal(updates[0].fields.stageId, stages.schedule.partial);
  assert.equal(updates[0].fields.ufCrm17_1785747159082, 50000);
});

test('closes a partially paid schedule once the remainder is covered', () => {
  const partial = { ...makeSchedule(1, 100000, stages.schedule.partial), remaining: 40000, partialPaid: 60000 };
  const updates = planScheduleUpdates([partial], 100000, stages);

  assert.equal(updates[0].fields.stageId, stages.schedule.paid);
  assert.equal(updates[0].fields.ufCrm17_1785747159082, '');
  assert.equal(updates[0].fields.ufCrm17_1785747288489, '');
});

test('produces no updates when nothing is paid yet', () => {
  assert.deepEqual(planScheduleUpdates([makeSchedule(1, 100000)], 0, stages), []);
});
