import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from '../../types/disk.js';

function getDiskDataDir(): string {
  return path.join(os.homedir(), '.hakanmcp', 'disk');
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(getDiskDataDir(), { recursive: true });
}

export async function logOperation(
  action: string,
  params: Record<string, unknown>,
  result: { success: boolean; summary: string },
  durationMs: number,
): Promise<HistoryEntry> {
  await ensureDataDir();
  const { rules: _rules, ...safeParams } = params;
  const entry: HistoryEntry = {
    id: randomUUID(),
    action,
    params: safeParams,
    result,
    timestamp: new Date().toISOString(),
    durationMs,
  };
  const historyFile = path.join(getDiskDataDir(), 'history.jsonl');
  await fs.appendFile(historyFile, JSON.stringify(entry) + '\n');
  return entry;
}

export async function getHistory(
  limit: number = 50,
  actionFilter?: string,
): Promise<HistoryEntry[]> {
  const historyFile = path.join(getDiskDataDir(), 'history.jsonl');
  try {
    const content = await fs.readFile(historyFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (!actionFilter || entry.action === actionFilter) {
          entries.push(entry);
        }
      } catch {
        // skip malformed lines
      }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export async function getDataDir(): Promise<string> {
  await ensureDataDir();
  return getDiskDataDir();
}
