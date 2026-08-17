import { Router } from 'express';
import { env } from '../config/env.js';
import { assertAllowedBitrixDomain, callBitrixMethod, exchangeBitrixCode, getBitrixStatus } from '../services/bitrixClient.js';

export const bitrixRouter = Router();

bitrixRouter.get('/status', (_req, res) => {
  res.json(getBitrixStatus());
});

bitrixRouter.post('/webhook/test', async (_req, res, next) => {
  try {
    const profile = await callBitrixMethod('profile');

    res.json({
      ok: true,
      profile
    });
  } catch (error) {
    next(error);
  }
});

bitrixRouter.get('/oauth/callback', async (req, res, next) => {
  try {
    const { code, domain } = req.query;

    if (!code || !domain) {
      return res.status(400).json({ error: 'Bitrix OAuth code and domain are required' });
    }

    if (!env.BITRIX_CLIENT_ID || !env.BITRIX_CLIENT_SECRET || !env.BITRIX_REDIRECT_URI) {
      return res.status(500).json({ error: 'Bitrix OAuth environment is not configured' });
    }

    const allowedDomain = assertAllowedBitrixDomain(domain);
    const token = await exchangeBitrixCode({
      code,
      domain: allowedDomain,
      clientId: env.BITRIX_CLIENT_ID,
      clientSecret: env.BITRIX_CLIENT_SECRET,
      redirectUri: env.BITRIX_REDIRECT_URI
    });

    // Persist token securely once a database is selected.
    res.json({
      ok: true,
      domain: allowedDomain,
      expiresIn: token.expires_in
    });
  } catch (error) {
    next(error);
  }
});
