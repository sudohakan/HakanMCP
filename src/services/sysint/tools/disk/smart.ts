/**
 * DSK-01: disk-smart — Disk SMART data reader.
 * Windows: Get-PhysicalDisk via PowerShell.
 * Linux: smartctl -A -j, fallback to lsblk.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export interface SmartRow {
  device: string;
  model: string;
  serialNumber: string;
  health: string;
  temperature: number;
  powerOnHours: number;
  reallocatedSectors: number;
  mediaType: string;
  sizeBytes: number;
}

// ── Exported parsers for unit testing ──────────────────────────────────────

export function parseDiskSmartWindows(json: string): SmartRow[] {
  const raw = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((d: Record<string, unknown>) => ({
    device: String(d['DeviceId'] ?? d['UniqueId'] ?? ''),
    model: String(d['Model'] ?? d['FriendlyName'] ?? ''),
    serialNumber: String(d['SerialNumber'] ?? ''),
    health: String(d['HealthStatus'] ?? 'Unknown'),
    temperature: Number(d['Temperature'] ?? 0),
    powerOnHours: Number(d['PowerOnHours'] ?? 0),
    reallocatedSectors: Number(d['ReallocatedSectorCount'] ?? 0),
    mediaType: String(d['MediaType'] ?? 'Unspecified'),
    sizeBytes: Number(d['Size'] ?? 0),
  }));
}

export function parseDiskSmartLinux(output: string): SmartRow[] {
  // smartctl --scan -j or lsblk -J output
  try {
    const data = JSON.parse(output.trim());
    if (data.devices && Array.isArray(data.devices)) {
      // smartctl --scan -j output
      return data.devices.map((d: Record<string, unknown>) => ({
        device: String(d['name'] ?? ''),
        model: String(d['model_name'] ?? d['product'] ?? ''),
        serialNumber: String(d['serial_number'] ?? ''),
        health: String((d['smart_status'] as Record<string, unknown>)?.['passed'] === true ? 'Healthy' : 'Unknown'),
        temperature: Number((d['temperature'] as Record<string, unknown>)?.['current'] ?? 0),
        powerOnHours: Number((d['power_on_time'] as Record<string, unknown>)?.['hours'] ?? 0),
        reallocatedSectors: 0,
        mediaType: String(d['rotation_rate'] === 0 ? 'SSD' : d['rotation_rate'] ? 'HDD' : 'Unspecified'),
        sizeBytes: Number((d['user_capacity'] as Record<string, unknown>)?.['bytes'] ?? 0),
      }));
    }
    // lsblk -J fallback
    if (data.blockdevices) {
      return (data.blockdevices as Array<Record<string, unknown>>)
        .filter((d) => d['type'] === 'disk')
        .map((d) => ({
          device: String(d['name'] ?? ''),
          model: String(d['model'] ?? ''),
          serialNumber: String(d['serial'] ?? ''),
          health: 'Unknown',
          temperature: 0,
          powerOnHours: 0,
          reallocatedSectors: 0,
          mediaType: String(d['rota'] === '0' ? 'SSD' : 'HDD'),
          sizeBytes: 0,
        }));
    }
  } catch {
    // fall through
  }
  return [];
}

export async function run(_toolId: string, _args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = 'Get-PhysicalDisk | Select-Object DeviceId,FriendlyName,Model,SerialNumber,HealthStatus,OperationalStatus,MediaType,Size | ConvertTo-Json -Compress';
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const rows = parseDiskSmartWindows(stdout);
      return buildSuccess(rows, 'disk-smart', platform);
    } else {
      // Try smartctl --scan -j first
      try {
        const { stdout } = await execAsync('smartctl --scan -j 2>/dev/null', { timeout: 15_000 });
        const rows = parseDiskSmartLinux(stdout);
        if (rows.length > 0) return buildSuccess(rows, 'disk-smart', platform);
      } catch {
        // fall through to lsblk
      }
      const { stdout } = await execAsync('lsblk -o NAME,SIZE,TYPE,MODEL,ROTA,SERIAL -J 2>/dev/null', { timeout: 10_000 });
      const rows = parseDiskSmartLinux(stdout);
      return buildSuccess(rows, 'disk-smart', platform);
    }
  } catch (err) {
    return buildError(`disk-smart failed: ${String(err)}`, 'EXEC_FAILED', 'disk-smart');
  }
}
