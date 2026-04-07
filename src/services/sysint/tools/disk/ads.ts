/**
 * DSK-08: disk-ads — Alternate Data Stream viewer (NTFS, Windows-only).
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export interface AdsRow {
  filePath: string;
  streamName: string;
  sizeBytes: number;
}

export function parseAdsOutput(json: string): AdsRow[] {
  const raw = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((d: Record<string, unknown>) => ({
    filePath: String(d['PSParentPath'] ?? d['FileName'] ?? ''),
    streamName: String(d['Stream'] ?? ''),
    sizeBytes: Number(d['Length'] ?? 0),
  }));
}

export async function run(_toolId: string, args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();

  if (platform === 'linux') {
    return buildError('disk-ads is Windows-only (NTFS Alternate Data Streams not available on Linux)', 'PLATFORM_UNSUPPORTED', 'disk-ads');
  }

  const [targetPath = 'C:\\'] = args;
  try {
    const safePath = targetPath.replace(/'/g, "''");
    const ps = `Get-Item -Path '${safePath}' -Stream * -ErrorAction SilentlyContinue | Where-Object {$_.Stream -ne ':$DATA'} | Select-Object PSParentPath,Stream,Length | ConvertTo-Json -Compress`;
    const cmd = platform === 'wsl'
      ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
      : `powershell -NoProfile -Command "${ps}"`;
    const { stdout } = await execAsync(cmd, { timeout: 30_000 });
    const rows = parseAdsOutput(stdout || '[]');
    return buildSuccess(rows, 'disk-ads', platform);
  } catch (err) {
    return buildError(`disk-ads failed: ${String(err)}`, 'EXEC_FAILED', 'disk-ads');
  }
}
