/**
 * PRC-01: process-list
 * PRC-07: process-tree
 */
import si from 'systeminformation';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from './shared.js';

interface ProcessRow {
  pid: number;
  parentPid: number;
  name: string;
  cpu: number;
  memoryBytes: number;
  user: string;
  commandLine: string;
  state: string;
}

interface ProcessTreeRow {
  pid: number;
  parentPid: number;
  name: string;
  children: number[];
}

export async function runProcessList(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const data = await si.processes();
    const rows: ProcessRow[] = data.list.map((p) => ({
      pid: p.pid,
      parentPid: p.parentPid ?? 0,
      name: p.name,
      cpu: Math.round((p.cpu ?? 0) * 10) / 10,
      memoryBytes: (p as unknown as Record<string, unknown>)['mem_rss'] as number ?? 0,
      user: p.user ?? '',
      commandLine: [p.command, p.params].filter(Boolean).join(' '),
      state: p.state ?? '',
    }));
    return buildSuccess(rows, 'process-list', platform);
  } catch (err) {
    return buildError(`process-list failed: ${String(err)}`, 'EXEC_FAILED', 'process-list');
  }
}

export async function runProcessTree(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const data = await si.processes();
    const byPid = new Map(data.list.map((p) => [p.pid, { pid: p.pid, parentPid: p.parentPid ?? 0, name: p.name, children: [] as number[] }]));
    for (const p of data.list) {
      if (p.parentPid && byPid.has(p.parentPid)) {
        byPid.get(p.parentPid)!.children.push(p.pid);
      }
    }
    const rows: ProcessTreeRow[] = [...byPid.values()];
    return buildSuccess(rows, 'process-tree', platform);
  } catch (err) {
    return buildError(`process-tree failed: ${String(err)}`, 'EXEC_FAILED', 'process-tree');
  }
}
