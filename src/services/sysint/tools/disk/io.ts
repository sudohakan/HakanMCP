/**
 * DSK-10: disk-io — Disk IO counters (read/write IOPS, throughput).
 * DSK-11: disk-freespace-log — Free space snapshot/history log.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import si from 'systeminformation';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const FREESPACE_LOG_DIR = join(homedir(), '.cache', 'sysint');
const FREESPACE_LOG_FILE = join(FREESPACE_LOG_DIR, 'freespace-log.json');
const MAX_LOG_ENTRIES = 1000;

export interface DiskIORow {
  name: string;
  readBytes: number;
  writeBytes: number;
  readIOPS: number;
  writeIOPS: number;
}

export interface FreeSpaceEntry {
  timestamp: string;
  mountPoint: string;
  sizeBytes: number;
  freeBytes: number;
  usePercent: number;
}

// ── DSK-10: disk-io ─────────────────────────────────────────────────────────

async function runDiskIO(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const data = await si.disksIO();
    // systeminformation DisksIoData has aggregate fields but no per-disk array
    const rows: DiskIORow[] = [{
      name: 'aggregate',
      readBytes: Number(data.rIO ?? 0),
      writeBytes: Number(data.wIO ?? 0),
      readIOPS: Number(data.rIO_sec ?? 0),
      writeIOPS: Number(data.wIO_sec ?? 0),
    }];
    return buildSuccess(rows, 'disk-io', platform);
  } catch (err) {
    return buildError(`disk-io failed: ${String(err)}`, 'EXEC_FAILED', 'disk-io');
  }
}

// ── DSK-11: disk-freespace-log ──────────────────────────────────────────────

async function loadLog(): Promise<FreeSpaceEntry[]> {
  try {
    const content = await readFile(FREESPACE_LOG_FILE, 'utf8');
    return JSON.parse(content) as FreeSpaceEntry[];
  } catch {
    return [];
  }
}

async function saveLog(entries: FreeSpaceEntry[]): Promise<void> {
  await mkdir(FREESPACE_LOG_DIR, { recursive: true });
  // Keep last MAX_LOG_ENTRIES
  const toSave = entries.slice(-MAX_LOG_ENTRIES);
  await writeFile(FREESPACE_LOG_FILE, JSON.stringify(toSave, null, 2), 'utf8');
}

async function runFreeSpaceLog(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [action = 'snapshot'] = args;

  try {
    if (action === 'list') {
      const entries = await loadLog();
      return buildSuccess(entries.slice(-100), 'disk-freespace-log', platform);
    }

    // snapshot
    const fsSizes = await si.fsSize();
    const timestamp = new Date().toISOString();
    const newEntries: FreeSpaceEntry[] = fsSizes.map((fs) => ({
      timestamp,
      mountPoint: fs.mount ?? '',
      sizeBytes: fs.size ?? 0,
      freeBytes: (fs.size ?? 0) - (fs.used ?? 0),
      usePercent: Math.round((fs.use ?? 0) * 10) / 10,
    }));

    const existing = await loadLog();
    await saveLog([...existing, ...newEntries]);

    return buildSuccess(newEntries, 'disk-freespace-log', platform);
  } catch (err) {
    return buildError(`disk-freespace-log failed: ${String(err)}`, 'EXEC_FAILED', 'disk-freespace-log');
  }
}

// ── Run dispatcher ──────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'disk-io': runDiskIO,
  'disk-freespace-log': runFreeSpaceLog,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
