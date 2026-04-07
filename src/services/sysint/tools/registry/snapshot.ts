/**
 * REG-02: registry-snapshot-diff — Take registry snapshots and diff two snapshots.
 * Windows/WSL only. Returns PLATFORM_UNSUPPORTED on Linux.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  assertWindowsOrWsl,
  execPs,
  parseArg,
  hasFlag,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface SnapshotEntry {
  key: string;
  valueName: string;
  valueType: string;
  valueData: string;
}

export interface DiffRow {
  change: 'added' | 'removed' | 'changed';
  key: string;
  valueName: string;
  before: string;
  after: string;
}

/**
 * Parse PowerShell tab-delimited output into snapshot entries.
 * Format: key\tvalueName\tvalueType\tvalueData
 */
export function parseSnapshotOutput(output: string): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [key, name, type, data] = parts;
    if (!key) continue;
    entries.push({
      key: (key ?? '').trim(),
      valueName: (name ?? '').trim(),
      valueType: (type ?? '').trim(),
      valueData: (data ?? '').trim(),
    });
  }
  return entries;
}

/**
 * Diff two registry snapshots. Returns added/removed/changed rows.
 */
export function diffSnapshots(before: SnapshotEntry[], after: SnapshotEntry[]): DiffRow[] {
  const rows: DiffRow[] = [];

  const makeKey = (e: SnapshotEntry): string => `${e.key}\x00${e.valueName}`;
  const beforeMap = new Map<string, SnapshotEntry>(before.map((e) => [makeKey(e), e]));
  const afterMap = new Map<string, SnapshotEntry>(after.map((e) => [makeKey(e), e]));

  // Removed entries
  for (const [k, e] of beforeMap) {
    if (!afterMap.has(k)) {
      rows.push({ change: 'removed', key: e.key, valueName: e.valueName, before: e.valueData, after: '' });
    }
  }

  // Added and changed entries
  for (const [k, e] of afterMap) {
    const prev = beforeMap.get(k);
    if (!prev) {
      rows.push({ change: 'added', key: e.key, valueName: e.valueName, before: '', after: e.valueData });
    } else if (prev.valueData !== e.valueData) {
      rows.push({ change: 'changed', key: e.key, valueName: e.valueName, before: prev.valueData, after: e.valueData });
    }
  }

  return rows;
}

async function captureSnapshot(rootKey: string): Promise<SnapshotEntry[]> {
  const script = `
$root = '${rootKey.replace(/'/g, "''")}';
try {
  Get-ChildItem -Path "Registry::$root" -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 5000 |
    ForEach-Object {
      $keyPath = $_.PSPath -replace 'Microsoft.PowerShell.Core\\\\Registry::', ''
      try {
        $vals = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
        if ($vals) {
          $vals.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
            $t = $_.TypeNameOfValue -replace 'System\\.', ''
            "$keyPath\t$($_.Name)\t$t\t$([string]$_.Value)"
          }
        }
      } catch {}
    }
} catch {}
`.trim();

  const { stdout } = await execPs(script, 60000);
  return parseSnapshotOutput(stdout);
}

async function runRegistrySnapshotDiff(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOrWsl('registry-snapshot-diff');
  if (platformGuard) return platformGuard;

  const snapshot1Path = parseArg(args, '--snapshot1');
  const snapshot2Path = parseArg(args, '--snapshot2');
  const takeSnapshot = hasFlag(args, '--take-snapshot');
  const outputPath = parseArg(args, '--output');
  const rootKey = parseArg(args, '--root') ?? 'HKLM';

  // Mode 1: take a snapshot and save it
  if (takeSnapshot) {
    if (!outputPath) {
      return buildError('--take-snapshot requires --output <path>', 'EXEC_FAILED', 'registry-snapshot-diff');
    }
    try {
      const entries = await captureSnapshot(rootKey);
      writeFileSync(outputPath, JSON.stringify(entries, null, 2), 'utf8');
      return buildSuccess(
        [{ action: 'snapshot_saved', path: outputPath, count: entries.length }],
        'registry-snapshot-diff',
        getPlatformName(),
      );
    } catch (err) {
      return buildError(`Snapshot failed: ${String(err)}`, 'EXEC_FAILED', 'registry-snapshot-diff');
    }
  }

  // Mode 2: diff two snapshot files
  if (!snapshot1Path || !snapshot2Path) {
    return buildError(
      'registry-snapshot-diff requires --snapshot1 <path> --snapshot2 <path> or --take-snapshot --output <path>',
      'EXEC_FAILED',
      'registry-snapshot-diff',
    );
  }

  try {
    const before = JSON.parse(readFileSync(snapshot1Path, 'utf8')) as SnapshotEntry[];
    const after = JSON.parse(readFileSync(snapshot2Path, 'utf8')) as SnapshotEntry[];
    const rows = diffSnapshots(before, after);
    return buildSuccess(rows, 'registry-snapshot-diff', getPlatformName());
  } catch (err) {
    return buildError(`Snapshot diff failed: ${String(err)}`, 'EXEC_FAILED', 'registry-snapshot-diff');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'registry-snapshot-diff': runRegistrySnapshotDiff,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
