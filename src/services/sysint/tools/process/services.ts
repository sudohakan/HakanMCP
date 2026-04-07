/**
 * PRC-08: service-list
 */
import { buildSuccess, buildError, getPlatformName, execAsync } from './shared.js';
import type { SysIntResult } from './shared.js';

interface ServiceRow {
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'pending' | 'unknown';
  startType: 'auto' | 'manual' | 'disabled' | 'unknown';
}

function mapWindowsStatus(status: number): ServiceRow['status'] {
  switch (status) {
    case 4: return 'running';
    case 1: return 'stopped';
    case 2: case 3: return 'pending';
    default: return 'unknown';
  }
}

function mapWindowsStartType(startType: number): ServiceRow['startType'] {
  switch (startType) {
    case 2: return 'auto';
    case 3: return 'manual';
    case 4: return 'disabled';
    default: return 'unknown';
  }
}

export async function runServiceList(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = 'Get-Service | Select-Object -Property Name,DisplayName,Status,StartType | ConvertTo-Json -Compress';
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const services = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(services) ? services : [services];
      const rows: ServiceRow[] = list.map((s: Record<string, unknown>) => ({
        name: String(s['Name'] ?? ''),
        displayName: String(s['DisplayName'] ?? ''),
        status: mapWindowsStatus(Number(s['Status'] ?? 0)),
        startType: mapWindowsStartType(Number(s['StartType'] ?? 0)),
      }));
      return buildSuccess(rows, 'service-list', platform);
    } else {
      const { stdout } = await execAsync('systemctl list-units --type=service --output=json --no-pager 2>/dev/null', { timeout: 30_000 });
      const units = JSON.parse(stdout.trim() || '[]');
      const list = Array.isArray(units) ? units : [units];
      const rows: ServiceRow[] = list.map((u: Record<string, unknown>) => ({
        name: String(u['unit'] ?? '').replace('.service', ''),
        displayName: String(u['description'] ?? ''),
        status: String(u['sub'] ?? '') === 'running' ? 'running' : String(u['active'] ?? '') === 'inactive' ? 'stopped' : 'unknown' as ServiceRow['status'],
        startType: 'unknown' as const,
      }));
      return buildSuccess(rows, 'service-list', platform);
    }
  } catch (err) {
    return buildError(`service-list failed: ${String(err)}`, 'EXEC_FAILED', 'service-list');
  }
}
