import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { env } from '../src/config/env.js';
import { getDefaultStages, resetStageCache, undoMatch } from '../src/services/matchEngine.js';

test('clears the final receipt link with an explicit blank Bitrix value', async (t) => {
  const previous = { ...env };
  env.BITRIX_WEBHOOK_URL = 'https://bitrix.example/rest/';
  env.BITRIX_REFRESH_STAGE_IDS = false;
  resetStageCache();
  t.after(() => { Object.assign(env, previous); resetStageCache(); });

  const stages = getDefaultStages();
  const deal = {
    ID: '6653',
    CATEGORY_ID: '5',
    UF_CRM_1785744431: ['901'],
    UF_CRM_1785062378: [],
    UF_CRM_1789311265873: 0,
    UF_CRM_1789311290719: 0
  };
  // This is the recoverable state left by the old bug: the receipt itself is already
  // unmatched, while the deal's multiple CRM field still contains its ID.
  const receipt = {
    id: 901,
    categoryId: 35,
    parentId2: null,
    contactId: null,
    stageId: stages.voucher.new
  };
  const dealWrites = [];

  t.mock.method(axios, 'create', () => ({
    async post(method, params) {
      let result;
      if (method === 'crm.item.get.json') {
        result = { item: params.entityTypeId === 2 ? { ...deal } : { ...receipt } };
      } else if (method === 'crm.deal.get.json') {
        result = { ...deal };
      } else if (method === 'crm.item.list.json') {
        assert.equal(params.entityTypeId, 1056);
        result = { items: [] };
      } else if (method === 'crm.item.update.json') {
        assert.equal(params.entityTypeId, 2);
        dealWrites.push(params.fields);
        Object.assign(deal, params.fields);
        if (params.fields.UF_CRM_1785744431) {
          deal.UF_CRM_1785744431 = params.fields.UF_CRM_1785744431.filter(Boolean);
        }
        result = { item: {} };
      } else {
        assert.fail(`Unexpected CRM call: ${method}`);
      }

      return { data: { result } };
    }
  }));

  const result = await undoMatch({ receiptId: '901', dealId: '6653' });

  assert.deepEqual(dealWrites[0], { UF_CRM_1785744431: [''] });
  assert.deepEqual(deal.UF_CRM_1785744431, []);
  assert.equal(result.recalculation.amdTotal, 0);
});
