import { Router } from 'express';
import { z } from 'zod';
import { confirmMatch, importBankTransaction, listBuildingOptions, listReceipts, searchDeals } from '../services/matchEngine.js';

export const receiptsRouter = Router();

receiptsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listReceipts());
  } catch (error) {
    next(error);
  }
});

receiptsRouter.get('/deals/search', async (req, res, next) => {
  try {
    const query = z.object({
      name: z.string().trim().max(100).optional().default(''),
      building: z.enum(['', '1503', '1505', '1507']).optional().default(''),
      apartment: z
        .string()
        .trim()
        .max(20)
        .optional()
        .default('')
        .transform((value) => value.replace(/[^\d.,/]/gu, ''))
    }).parse(req.query);
    res.json({
      deals: await searchDeals(query)
    });
  } catch (error) {
    next(error);
  }
});

receiptsRouter.get('/buildings', async (_req, res, next) => {
  try {
    res.json({
      buildings: await listBuildingOptions()
    });
  } catch (error) {
    next(error);
  }
});

receiptsRouter.post('/bank/import', async (req, res, next) => {
  try {
    const result = await importBankTransaction(req.body);
    res.json({
      ok: true,
      created: result.created,
      receipt: result.receipt
    });
  } catch (error) {
    next(error);
  }
});

receiptsRouter.post('/match', async (req, res, next) => {
  try {
    const payload = z
      .object({
        receiptId: z.string().regex(/^\d+$/),
        dealId: z.string().regex(/^\d+$/),
        scheduleIds: z.array(z.string().regex(/^\d+$/)).max(100).default([])
      })
      .parse(req.body);

    res.json({
      ok: true,
      receipt: await confirmMatch(payload)
    });
  } catch (error) {
    next(error);
  }
});
