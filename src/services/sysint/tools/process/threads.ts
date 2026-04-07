/**
 * PRC-04: process-threads
 */
import { buildSuccess, buildError, getPlatformName, execAsync } from './shared.js';
import type { SysIntResult } from './shared.js';

interface ThreadRow {
  threadId: number;
  state: string;
}

export async function runProcessThreads(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const pid = args[0];
  if (!pid) return buildError('PID required', 'EXEC_FAILED', 'process-threads');
  if (!/^\d+$/.test(pid)) return buildError('Invalid PID: must be a positive integer', 'EXEC_FAILED', 'process-threads');
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `(Get-Process -Id ${pid} -ErrorAction Stop).Threads | Select-Object -Property Id,ThreadState | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl' ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"` : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const threads = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(threads) ? threads : [threads];
      const rows: ThreadRow[] = list.map((t: Record<string, unknown>) => ({
        threadId: Number(t['Id'] ?? 0),
        state: String(t['ThreadState'] ?? ''),
      }));
      return buildSuccess(rows, 'process-threads', platform);
    } else {
      const { stdout } = await execAsync(`ls /proc/${pid}/task/ 2>/dev/null`, { timeout: 10_000 });
      const rows: ThreadRow[] = stdout.trim().split('\n').filter(Boolean).map((tid) => ({
        threadId: parseInt(tid.trim(), 10),
        state: '',
      }));
      return buildSuccess(rows, 'process-threads', platform);
    }
  } catch (err) {
    return buildError(`process-threads failed: ${String(err)}`, 'EXEC_FAILED', 'process-threads');
  }
}
