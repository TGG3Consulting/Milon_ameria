import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

const currentDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(currentDir, '../../../../.env') });
config();

const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional());
const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().optional());
const optionalBoolean = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : String(value).toLowerCase() === 'true'),
  z.boolean().optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: optionalUrl.default('http://localhost:5173'),
  BITRIX_ALLOWED_DOMAINS: optionalString,
  BITRIX_CLIENT_ID: optionalString,
  BITRIX_CLIENT_SECRET: optionalString,
  BITRIX_REDIRECT_URI: optionalUrl,
  BITRIX_WEBHOOK_URL: optionalUrl,
  AMERIA_BASE_URL: optionalUrl,
  AMERIA_CLIENT_ID: optionalString,
  AMERIA_CLIENT_SECRET: optionalString,
  AMERIA_USERNAME: optionalString,
  AMERIA_PASSWORD: optionalString,
  AMERIA_AUTH_PATH: optionalString.default('/oauth/token'),
  AMERIA_AUTH_MODE: z.enum(['json', 'form']).default('json'),
  AMERIA_TRANSACTIONS_PATH: optionalString.default('/transactions'),
  AMERIA_SYNC_ENABLED: optionalBoolean.default(false),
  AMERIA_SYNC_RUN_ON_START: optionalBoolean.default(false),
  AMERIA_SYNC_INTERVAL_MS: z.coerce.number().int().min(60000).default(300000),
  ACTIVITY_LOG_PATH: optionalString,
  BITRIX_REFRESH_STAGE_IDS: optionalBoolean.default(false),
  // Additive matching layer (smartMatch.js + parsePurposeV2). Off by default: while it is false
  // the legacy parser and the legacy suggestion order stay byte-for-byte unchanged.
  SMART_MATCH_V2: optionalBoolean.default(false)
});

export const env = envSchema.parse(process.env);
