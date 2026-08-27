import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDealScheduleSummaryPersisted,
  dealMatchesReceipt,
  filterDealsForSearch,
  getDealScheduleSummaryFields,
  getDefaultStages,
  parsePurpose,
  planScheduleUpdates,
  sumAmdVouchers
} from '../src/services/matchEngine.js';

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

test('uses the voucher custom amount before stale opportunity', () => {
  const total = sumAmdVouchers([
    { id: '1', opportunity: 1000000, ufCrm19_1785737375: 20000000, ufCrm19_1785737270: 1651, currencyId: 'AMD' }
  ]);

  assert.equal(total, 20000000);
});

test('writes deal totals only to the confirmed production fields', () => {
  const fields = getDealScheduleSummaryFields(
    [makeSchedule(839, 10400000), makeSchedule(841, 10400000), makeSchedule(843, 10400000), makeSchedule(845, 10400000)],
    20760000
  );

  assert.deepEqual(fields, {
    UF_CRM_1785062378: ['839', '841', '843', '845'],
    UF_CRM_1776322253480: '20840000|AMD',
    UF_CRM_1776609678581: '20760000|AMD'
  });
  assert.equal('UF_CRM_1785062920' in fields, false);
  assert.equal('UF_CRM_1785062958' in fields, false);
});

test('detects when Bitrix automation overwrites a saved deal total', () => {
  const expected = {
    UF_CRM_1776322253480: '20840000|AMD',
    UF_CRM_1776609678581: '20760000|AMD'
  };

  assert.doesNotThrow(() => assertDealScheduleSummaryPersisted(expected, expected));
  assert.throws(
    () => assertDealScheduleSummaryPersisted({ ...expected, UF_CRM_1776609678581: null }, expected),
    (error) => error.status === 409 && error.code === 'BITRIX_AUTOMATION_CONFLICT'
  );
});

test('does not suggest a deal with a different explicit apartment number', () => {
  const receipt = {
    parsed: parsePurpose('test payment բն.502 for Deal 6655'),
    payerName: 'Միրզախանյան Միրզախան test'
  };
  const wrongApartmentDeal = {
    apartmentNumber: '501',
    buyerName: 'Միրզախանյան Միրզախան test',
    searchableText: 'Միրզախանյան Միրզախան test բնակարան 501 linked receipt mentions 502'
  };

  assert.equal(dealMatchesReceipt(receipt, wrongApartmentDeal), false);
});

test('manual search matches apartment only against the structured deal apartment', () => {
  const deals = [
    {
      id: '6653',
      projectId: '1507',
      apartmentNumber: '501',
      searchableText: 'buyer apartment 501 linked receipt mentions 502'
    },
    {
      id: '6655',
      projectId: '1507',
      apartmentNumber: '502',
      searchableText: 'buyer apartment 502'
    }
  ];

  const results = filterDealsForSearch(deals, { apartment: '502' });

  assert.deepEqual(results.map((deal) => deal.id), ['6655']);
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

test('keeps a partially paid schedule partial when only part of the remainder is covered', () => {
  const partial = { ...makeSchedule(1, 100000, stages.schedule.partial), remaining: 40000, partialPaid: 60000 };
  const updates = planScheduleUpdates([partial], 70000, stages);

  assert.equal(updates[0].fields.stageId, stages.schedule.partial);
  assert.equal(updates[0].fields.ufCrm17_1785747159082, 70000);
  assert.equal(updates[0].fields.ufCrm17_1785747288489, 30000);
});

test('produces no updates when nothing is paid yet', () => {
  assert.deepEqual(planScheduleUpdates([makeSchedule(1, 100000)], 0, stages), []);
});
