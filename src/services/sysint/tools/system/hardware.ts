/**
 * SYS-06: driver-list       — Installed drivers.
 * SYS-07: startup-programs  — Startup programs listing.
 * SYS-08: scheduled-tasks   — Scheduled tasks.
 * SYS-11: usb-history       — USB device history.
 * SYS-12: battery-info      — Battery capacity and health.
 * SYS-13: monitor-info      — Monitor/display info.
 * SYS-23: hardware-info     — Motherboard, BIOS, serial.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

// ── Exported parsers ─────────────────────────────────────────────────────────

export function parseDriverQuery(csv: string): Array<{ name: string; description: string; type: string; state: string; startMode: string }> {
  const rows: Array<{ name: string; description: string; type: string; state: string; startMode: string }> = [];
  const lines = csv.replace(/\r\n/g, '\n').split('\n');
  const headers = lines[0]?.split(',').map((h) => h.replace(/"/g, '').trim());
  if (!headers) return rows;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const vals = line.split(',').map((v) => v.replace(/"/g, '').trim());
    const get = (name: string): string => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? (vals[idx] ?? '') : '';
    };
    rows.push({
      name: get('Module Name') || get('Name') || (vals[0] ?? ''),
      description: get('Display Name') || get('Description'),
      type: get('Driver Type') || get('Type'),
      state: get('State'),
      startMode: get('Start Mode'),
    });
  }
  return rows;
}

export function parseLsmod(text: string): Array<{ name: string; sizeBytes: number; usedBy: string }> {
  const rows: Array<{ name: string; sizeBytes: number; usedBy: string }> = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    rows.push({
      name: parts[0] ?? '',
      sizeBytes: Number(parts[1] ?? 0),
      usedBy: parts.slice(3).join(' '),
    });
  }
  return rows;
}

export function parseScheduledTasks(csv: string): Array<{ name: string; status: string; nextRunTime: string; lastRunTime: string; author: string; command: string }> {
  const rows: Array<{ name: string; status: string; nextRunTime: string; lastRunTime: string; author: string; command: string }> = [];
  const lines = csv.replace(/\r\n/g, '\n').split('\n');
  if (!lines[0]) return rows;
  const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const vals = line.split(',').map((v) => v.replace(/"/g, '').trim());
    const get = (name: string): string => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? (vals[idx] ?? '') : '';
    };
    rows.push({
      name: get('TaskName') || get('Task To Run') || (vals[0] ?? ''),
      status: get('Status'),
      nextRunTime: get('Next Run Time'),
      lastRunTime: get('Last Run Time'),
      author: get('Author') || get('Run As User'),
      command: get('Task To Run'),
    });
  }
  return rows;
}

export function parseCrontab(text: string): Array<{ name: string; status: string; nextRunTime: string; lastRunTime: string; author: string; command: string }> {
  const rows: Array<{ name: string; status: string; nextRunTime: string; lastRunTime: string; author: string; command: string }> = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 6) continue;
    const schedule = parts.slice(0, 5).join(' ');
    const command = parts.slice(5).join(' ');
    rows.push({
      name: command.split('/').pop() ?? command,
      status: 'enabled',
      nextRunTime: '',
      lastRunTime: '',
      author: 'current user',
      command: `${schedule} ${command}`,
    });
  }
  return rows;
}

// ── SYS-06: driver-list ─────────────────────────────────────────────────────

async function runDriverList(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const cmd = platform === 'wsl'
        ? 'driverquery.exe /FO CSV /V 2>/dev/null'
        : 'driverquery /FO CSV /V 2>/dev/null';
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const rows = parseDriverQuery(stdout);
      return buildSuccess(rows, 'driver-list', platform);
    } else {
      const { stdout } = await execAsync('lsmod 2>/dev/null', { timeout: 10_000 });
      const rows = parseLsmod(stdout);
      return buildSuccess(rows, 'driver-list', platform);
    }
  } catch (err) {
    return buildError(`driver-list failed: ${String(err)}`, 'EXEC_FAILED', 'driver-list');
  }
}

// ── SYS-07: startup-programs ────────────────────────────────────────────────

async function runStartupPrograms(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = 'Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | ConvertTo-Json -Compress';
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const raw = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(raw) ? raw : [raw];
      const rows = list.map((s: Record<string, unknown>) => ({
        name: String(s['Name'] ?? ''),
        command: String(s['Command'] ?? ''),
        location: String(s['Location'] ?? ''),
        user: String(s['User'] ?? ''),
        type: 'startup-command',
      }));
      return buildSuccess(rows, 'startup-programs', platform);
    } else {
      const { stdout } = await execAsync('systemctl list-unit-files --state=enabled --type=service --no-pager 2>/dev/null', { timeout: 20_000 });
      const rows = stdout
        .replace(/\r\n/g, '\n').split('\n')
        .filter((l) => l.includes('.service'))
        .map((l) => {
          const parts = l.trim().split(/\s+/);
          return {
            name: (parts[0] ?? '').replace('.service', ''),
            command: '',
            location: 'systemd',
            user: 'system',
            type: 'systemd-service',
          };
        });
      return buildSuccess(rows, 'startup-programs', platform);
    }
  } catch (err) {
    return buildError(`startup-programs failed: ${String(err)}`, 'EXEC_FAILED', 'startup-programs');
  }
}

// ── SYS-08: scheduled-tasks ─────────────────────────────────────────────────

async function runScheduledTasks(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const cmd = platform === 'wsl'
        ? 'schtasks.exe /Query /FO CSV /V 2>/dev/null'
        : 'schtasks /Query /FO CSV /V 2>/dev/null';
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const rows = parseScheduledTasks(stdout);
      return buildSuccess(rows, 'scheduled-tasks', platform);
    } else {
      const rows = [];
      try {
        const { stdout: crontabOut } = await execAsync('crontab -l 2>/dev/null', { timeout: 10_000 });
        rows.push(...parseCrontab(crontabOut));
      } catch {
        // no crontab
      }
      try {
        const { stdout: timerOut } = await execAsync('systemctl list-timers --all --no-pager 2>/dev/null', { timeout: 20_000 });
        for (const line of timerOut.replace(/\r\n/g, '\n').split('\n').slice(1)) {
          const parts = line.trim().split(/\s{2,}/);
          if (parts.length >= 3 && parts[2]?.includes('.timer')) {
            rows.push({
              name: parts[2].replace('.timer', ''),
              status: 'enabled',
              nextRunTime: parts[0] ?? '',
              lastRunTime: parts[3] ?? '',
              author: 'systemd',
              command: '',
            });
          }
        }
      } catch {
        // no systemctl timers
      }
      return buildSuccess(rows, 'scheduled-tasks', platform);
    }
  } catch (err) {
    return buildError(`scheduled-tasks failed: ${String(err)}`, 'EXEC_FAILED', 'scheduled-tasks');
  }
}

// ── SYS-11: usb-history ─────────────────────────────────────────────────────

async function runUsbHistory(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = "Get-PnpDevice -Class USB -ErrorAction SilentlyContinue | Select-Object FriendlyName,Status,DeviceID | ConvertTo-Json -Compress";
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const raw = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(raw) ? raw : [raw];
      const rows = list.map((d: Record<string, unknown>) => ({
        deviceId: String(d['DeviceID'] ?? ''),
        name: String(d['FriendlyName'] ?? ''),
        manufacturer: '',
        status: String(d['Status'] ?? ''),
        connectedAt: '',
      }));
      return buildSuccess(rows, 'usb-history', platform);
    } else {
      const { stdout } = await execAsync('lsusb 2>/dev/null', { timeout: 10_000 });
      const rows = stdout
        .replace(/\r\n/g, '\n').split('\n')
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/Bus \d+ Device \d+: ID (\S+) (.+)/);
          return {
            deviceId: match?.[1] ?? '',
            name: match?.[2] ?? line,
            manufacturer: '',
            status: 'connected',
            connectedAt: '',
          };
        });
      return buildSuccess(rows, 'usb-history', platform);
    }
  } catch (err) {
    return buildError(`usb-history failed: ${String(err)}`, 'EXEC_FAILED', 'usb-history');
  }
}

// ── SYS-12: battery-info ────────────────────────────────────────────────────

async function runBatteryInfo(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const battData = await si.battery();
    if (!battData.hasBattery) {
      return buildSuccess([{ hasBattery: false }], 'battery-info', platform);
    }
    const row = {
      manufacturer: String(battData.manufacturer ?? ''),
      model: String(battData.model ?? ''),
      voltageDesigned: Number((battData as unknown as Record<string, unknown>)['voltageDesigned'] ?? 0),
      voltageActual: Number(battData.voltage ?? 0),
      percent: Number(battData.percent ?? 0),
      timeRemaining: Number(battData.timeRemaining ?? -1),
      charging: Boolean(battData.isCharging ?? false),
      hasBattery: true,
    };
    return buildSuccess([row], 'battery-info', platform);
  } catch (err) {
    return buildError(`battery-info failed: ${String(err)}`, 'EXEC_FAILED', 'battery-info');
  }
}

// ── SYS-13: monitor-info ────────────────────────────────────────────────────

async function runMonitorInfo(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const graphics = await si.graphics();
    const rows = (graphics.displays ?? []).map((d) => ({
      model: String(d.model ?? ''),
      main: Boolean(d.main ?? false),
      connection: String(d.connection ?? ''),
      resolutionX: Number(d.resolutionX ?? 0),
      resolutionY: Number(d.resolutionY ?? 0),
      refreshRate: Number(d.currentRefreshRate ?? (d as unknown as Record<string, unknown>)['refreshRate'] ?? 0),
      currentResX: Number(d.currentResX ?? d.resolutionX ?? 0),
      currentResY: Number(d.currentResY ?? d.resolutionY ?? 0),
    }));
    return buildSuccess(rows, 'monitor-info', platform);
  } catch (err) {
    return buildError(`monitor-info failed: ${String(err)}`, 'EXEC_FAILED', 'monitor-info');
  }
}

// ── SYS-23: hardware-info ───────────────────────────────────────────────────

async function runHardwareInfo(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const [systemData, biosData, boardData] = await Promise.all([
      si.system(),
      si.bios(),
      si.baseboard(),
    ]);
    const row = {
      manufacturer: String(systemData.manufacturer ?? ''),
      model: String(systemData.model ?? ''),
      version: String(systemData.version ?? ''),
      serial: String(systemData.serial ?? ''),
      biosVendor: String(biosData.vendor ?? ''),
      biosVersion: String(biosData.version ?? ''),
      biosDate: String(biosData.releaseDate ?? ''),
      boardManufacturer: String(boardData.manufacturer ?? ''),
      boardModel: String(boardData.model ?? ''),
    };
    return buildSuccess([row], 'hardware-info', platform);
  } catch (err) {
    return buildError(`hardware-info failed: ${String(err)}`, 'EXEC_FAILED', 'hardware-info');
  }
}

// ── Run dispatcher ──────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'driver-list': runDriverList,
  'startup-programs': runStartupPrograms,
  'scheduled-tasks': runScheduledTasks,
  'usb-history': runUsbHistory,
  'battery-info': runBatteryInfo,
  'monitor-info': runMonitorInfo,
  'hardware-info': runHardwareInfo,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
