/**
 * PRC-06: process-io
 */
import { readFile } from 'node:fs/promises';
import { buildSuccess, buildError, getPlatformName, execAsync } from './shared.js';
import type { SysIntResult } from './shared.js';

interface IORow {
  pid: number;
  name: string;
  readBytes: number;
  writeBytes: number;
}

export async function runProcessIO(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const pid = args[0];
  if (!pid) return buildError('PID required', 'EXEC_FAILED', 'process-io');
  if (!/^\d+$/.test(pid)) return buildError('Invalid PID: must be a positive integer', 'EXEC_FAILED', 'process-io');
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `(Get-Process -Id ${pid} -ErrorAction Stop).SI | Select-Object -Property @{N='Name';E={$_.Process.Name}},ReadTransferCount,WriteTransferCount | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl' ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"` : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const data = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '{}');
      const row: IORow = {
        pid: parseInt(pid, 10),
        name: String(data['Name'] ?? ''),
        readBytes: Number(data['ReadTransferCount'] ?? 0),
        writeBytes: Number(data['WriteTransferCount'] ?? 0),
      };
      return buildSuccess([row], 'process-io', platform);
    } else {
      const content = await readFile(`/proc/${pid}/io`, 'utf8').catch(() => '');
      const getValue = (key: string): number => {
        const match = content.match(new RegExp(`${key}:\\s*(\\d+)`));
        return match ? parseInt(match[1], 10) : 0;
      };
      const row: IORow = {
        pid: parseInt(pid, 10),
        name: '',
        readBytes: getValue('read_bytes'),
        writeBytes: getValue('write_bytes'),
      };
      return buildSuccess([row], 'process-io', platform);
    }
  } catch (err) {
    return buildError(`process-io failed: ${String(err)}`, 'EXEC_FAILED', 'process-io');
  }
}
