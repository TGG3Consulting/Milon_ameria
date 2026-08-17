import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '../config/env.js';

const logPath = resolve(env.ACTIVITY_LOG_PATH ?? 'data/activity-log.json');
let loaded = false;
let entries = [];
let writeQueue = Promise.resolve();

async function ensureLoaded() {
  if (loaded) return;

  try {
    const content = await readFile(logPath, 'utf8');
    const parsed = JSON.parse(content);
    entries = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  loaded = true;
}

async function persist() {
  await mkdir(dirname(logPath), { recursive: true });
  const temporaryPath = `${logPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(entries, null, 2), 'utf8');
  await rename(temporaryPath, logPath);
}

export async function getActivityLog() {
  await ensureLoaded();
  return entries.slice();
}

export async function addActivity(entry) {
  await ensureLoaded();
  const nextEntry = {
    id: entry.id ?? `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    ...entry
  };

  entries.unshift(nextEntry);
  entries = entries.slice(0, 1000);
  writeQueue = writeQueue.then(persist, persist);
  await writeQueue;
  return nextEntry;
}
