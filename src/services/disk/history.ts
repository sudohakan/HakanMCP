import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from '../../types/disk.js';

const DISK_DATA_DIR = path.join(process.env.HOME || '/tmp', '.hakanmcp', 'disk');
const HISTORY_FILE = path.join(DISK_DATA_DIR, 'history.jsonl');

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DISK_DATA_DIR, { recursive: true });
}

export async function logOperation(
  action: string,
  params: Record<string, unknown>,
  result: { success: boolean; summary: string },
  durationMs: number,
): Promise<HistoryEntry> {
  await ensureDataDir();
  const entry: HistoryEntry = {
    id: randomUUID(),
    action,
    params,
    result,
    timestamp: new Date().toISOString(),
    durationMs,
  };
  await fs.appendFile(HISTORY_FILE, JSON.stringify(entry) + '\n');
  return entry;
}

export async function getHistory(
  limit: number = 50,
  actionFilter?: string,
): Promise<HistoryEntry[]> {
  try {
    const content = await fs.readFile(HISTORY_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    let entries: HistoryEntry[] = lines.map((line) => JSON.parse(line));
    if (actionFilter) {
      entries = entries.filter((e) => e.action === actionFilter);
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export async function getDataDir(): Promise<string> {
  await ensureDataDir();
  return DISK_DATA_DIR;
}
