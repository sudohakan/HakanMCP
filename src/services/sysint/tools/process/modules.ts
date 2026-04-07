/**
 * PRC-03: process-modules
 */
import { readFile } from 'node:fs/promises';
import { buildSuccess, buildError, getPlatformName, execAsync } from './shared.js';
import type { SysIntResult } from './shared.js';

interface ModuleRow {
  name: string;
  path: string;
  version: string;
}

export async function runProcessModules(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const pid = args[0];
  if (!pid) return buildError('PID required', 'EXEC_FAILED', 'process-modules');
  if (!/^\d+$/.test(pid)) return buildError('Invalid PID: must be a positive integer', 'EXEC_FAILED', 'process-modules');
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `Get-Process -Id ${pid} -ErrorAction Stop | Select-Object -ExpandProperty Modules | Select-Object -Property ModuleName,FileName,FileVersionInfo | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl' ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"` : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const mods = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(mods) ? mods : [mods];
      const rows: ModuleRow[] = list.map((m: Record<string, unknown>) => ({
        name: String(m['ModuleName'] ?? ''),
        path: String(m['FileName'] ?? ''),
        version: String((m['FileVersionInfo'] as Record<string, unknown>)?.['FileVersion'] ?? ''),
      }));
      return buildSuccess(rows, 'process-modules', platform);
    } else {
      const maps = await readFile(`/proc/${pid}/maps`, 'utf8').catch(() => '');
      const seen = new Set<string>();
      const rows: ModuleRow[] = [];
      for (const line of maps.split('\n')) {
        const parts = line.split(' ');
        const path = parts[parts.length - 1]?.trim();
        if (path && path.startsWith('/') && !seen.has(path)) {
          seen.add(path);
          rows.push({ name: path.split('/').pop() ?? path, path, version: '' });
        }
      }
      return buildSuccess(rows, 'process-modules', platform);
    }
  } catch (err) {
    return buildError(`process-modules failed: ${String(err)}`, 'EXEC_FAILED', 'process-modules');
  }
}
