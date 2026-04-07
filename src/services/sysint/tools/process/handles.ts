/**
 * PRC-05: process-handles
 */
import { readlink, readdir } from 'node:fs/promises';
import { buildSuccess, buildError, getPlatformName, execAsync } from './shared.js';
import type { SysIntResult } from './shared.js';

interface HandleRow {
  fd: number | string;
  path: string;
}

export async function runProcessHandles(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const pid = args[0];
  if (!pid) return buildError('PID required', 'EXEC_FAILED', 'process-handles');
  if (!/^\d+$/.test(pid)) return buildError('Invalid PID: must be a positive integer', 'EXEC_FAILED', 'process-handles');
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `$p = Get-Process -Id ${pid} -ErrorAction Stop; @{HandleCount=$p.HandleCount} | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl' ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"` : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const data = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '{}');
      return buildSuccess([{ pid: parseInt(pid, 10), handleCount: data['HandleCount'] ?? 0 }], 'process-handles', platform);
    } else {
      // Linux: /proc/{pid}/fd/ — use fs.promises.readlink/readdir to avoid shell injection
      let fds: string[];
      try {
        fds = await readdir(`/proc/${pid}/fd`);
      } catch {
        fds = [];
      }
      const rows: HandleRow[] = [];
      for (const fd of fds) {
        let target = '';
        try {
          target = await readlink(`/proc/${pid}/fd/${fd}`);
        } catch {
          // ignore unreadable fds
        }
        rows.push({ fd: parseInt(fd, 10), path: target });
      }
      return buildSuccess(rows, 'process-handles', platform);
    }
  } catch (err) {
    return buildError(`process-handles failed: ${String(err)}`, 'EXEC_FAILED', 'process-handles');
  }
}
