import axios from 'axios';
import { env } from '../config/env.js';

let cachedToken = null;

export function createAmeriaClient() {
  const baseURL = env.AMERIA_BASE_URL;

  if (!baseURL) {
    return null;
  }

  return axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

export async function getAmeriaToken() {
  if (cachedToken?.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const client = createAmeriaClient();
  if (!client) {
    throw new Error('AMERIA_BASE_URL is not configured');
  }

  const credentials = {
    clientId: env.AMERIA_CLIENT_ID,
    clientSecret: env.AMERIA_CLIENT_SECRET,
    username: env.AMERIA_USERNAME,
    password: env.AMERIA_PASSWORD
  };
  const request = env.AMERIA_AUTH_MODE === 'form'
    ? {
        body: new URLSearchParams({
          grant_type: env.AMERIA_USERNAME ? 'password' : 'client_credentials',
          client_id: credentials.clientId ?? '',
          client_secret: credentials.clientSecret ?? '',
          username: credentials.username ?? '',
          password: credentials.password ?? ''
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    : { body: credentials, headers: undefined };
  const { data } = await client.post(env.AMERIA_AUTH_PATH, request.body, { headers: request.headers });

  if (!data?.access_token) {
    throw new Error('Ameriabank authentication response does not contain access_token');
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max((data.expires_in ?? 300) - 30, 30) * 1000
  };

  return cachedToken.accessToken;
}

export async function getAmeriaStatus() {
  const configured = Boolean(env.AMERIA_BASE_URL);

  return {
    configured,
    authenticated: Boolean(cachedToken?.expiresAt > Date.now())
  };
}

export async function fetchAmeriaTransactions(params = {}) {
  const client = createAmeriaClient();

  if (!client) {
    throw new Error('AMERIA_BASE_URL is not configured');
  }

  const token = await getAmeriaToken();
  const { data } = await client.get(env.AMERIA_TRANSACTIONS_PATH, {
    params,
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (Array.isArray(data)) {
    return data;
  }

  const transactions = data.transactions ?? data.items ?? data.data ?? [];

  if (!Array.isArray(transactions)) {
    throw new Error('Ameriabank transactions response has an unsupported structure');
  }

  return transactions;
}
