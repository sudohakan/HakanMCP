/**
 * SYS-04: installed-apps     — Installed applications listing.
 * SYS-05: update-history     — Windows Update / package update history.
 * SYS-20: installed-packages — Package manager listing (winget/choco/dpkg/rpm).
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export interface AppRow {
  name: string;
  publisher: string;
  version: string;
  installDate: string;
  sizeBytes: number;
}

export interface UpdateRow {
  id: string;
  description: string;
  installedAt: string;
  source: string;
}

export interface PackageRow {
  name: string;
  version: string;
  source: string;
  sizeBytes: number;
}

// ── Exported parsers ─────────────────────────────────────────────────────────

export function parseInstalledAppsWindows(json: string): AppRow[] {
  const raw = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((a: Record<string, unknown>) => a['DisplayName'])
    .map((a: Record<string, unknown>) => ({
      name: String(a['DisplayName'] ?? ''),
      publisher: String(a['Publisher'] ?? ''),
      version: String(a['DisplayVersion'] ?? ''),
      installDate: String(a['InstallDate'] ?? ''),
      sizeBytes: Number(a['EstimatedSize'] ?? 0) * 1024,
    }));
}

export function parseInstalledAppsLinux(text: string): AppRow[] {
  const rows: AppRow[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Desired')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    // dpkg-query format: package version installed-size
    rows.push({
      name: parts[0] ?? '',
      publisher: '',
      version: parts[1] ?? '',
      installDate: '',
      sizeBytes: Number(parts[2] ?? 0) * 1024,
    });
  }
  return rows;
}

export function parseHotFix(json: string): UpdateRow[] {
  const raw = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((h: Record<string, unknown>) => ({
    id: String(h['HotFixID'] ?? h['Id'] ?? ''),
    description: String(h['Description'] ?? ''),
    installedAt: String(h['InstalledOn'] ?? h['InstalledDate'] ?? ''),
    source: 'Windows Update',
  }));
}

export function parseDpkgLog(text: string): UpdateRow[] {
  const rows: UpdateRow[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.includes(' install ') && !trimmed.includes(' upgrade ')) continue;
    const parts = trimmed.split(' ');
    // format: 2024-01-15 10:23:45 install/upgrade package:arch oldver newver
    const timestamp = `${parts[0] ?? ''} ${parts[1] ?? ''}`;
    const action = parts[2] ?? '';
    const pkgInfo = parts[3]?.split(':')[0] ?? '';
    if (pkgInfo) {
      rows.push({
        id: pkgInfo,
        description: `${action} ${pkgInfo}`,
        installedAt: timestamp,
        source: 'dpkg',
      });
    }
  }
  return rows;
}

// ── SYS-04: installed-apps ──────────────────────────────────────────────────

async function runInstalledApps(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [filter] = args;

  try {
    let rows: AppRow[] = [];
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `
        $apps = @()
        $apps += Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue |
          Where-Object {$_.DisplayName} | Select-Object DisplayName,Publisher,DisplayVersion,InstallDate,EstimatedSize
        $apps += Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue |
          Where-Object {$_.DisplayName} | Select-Object DisplayName,Publisher,DisplayVersion,InstallDate,EstimatedSize
        $apps += Get-ItemProperty 'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue |
          Where-Object {$_.DisplayName} | Select-Object DisplayName,Publisher,DisplayVersion,InstallDate,EstimatedSize
        $apps | Sort-Object DisplayName -Unique | ConvertTo-Json -Compress
      `.trim().replace(/\n\s+/g, ' ');
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 60_000 });
      rows = parseInstalledAppsWindows(stdout);
    } else {
      // dpkg first, then rpm
      try {
        const { stdout } = await execAsync("dpkg-query -W -f='${Package}\t${Version}\t${Installed-Size}\n' 2>/dev/null", { timeout: 30_000 });
        rows = parseInstalledAppsLinux(stdout);
      } catch {
        const { stdout } = await execAsync("rpm -qa --queryformat '%{NAME}\t%{VERSION}\t%{SIZE}\n' 2>/dev/null", { timeout: 30_000 });
        rows = parseInstalledAppsLinux(stdout);
      }
    }

    if (filter) {
      const f = filter.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(f));
    }
    return buildSuccess(rows, 'installed-apps', platform);
  } catch (err) {
    return buildError(`installed-apps failed: ${String(err)}`, 'EXEC_FAILED', 'installed-apps');
  }
}

// ── SYS-05: update-history ──────────────────────────────────────────────────

async function runUpdateHistory(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    let rows: UpdateRow[] = [];
    if (platform === 'win32' || platform === 'wsl') {
      const ps = 'Get-HotFix | Select-Object HotFixID,Description,InstalledOn | ConvertTo-Json -Compress';
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      rows = parseHotFix(stdout);
    } else {
      try {
        const { stdout } = await execAsync("grep -E ' (install|upgrade) ' /var/log/dpkg.log 2>/dev/null | tail -100", { timeout: 10_000 });
        rows = parseDpkgLog(stdout);
      } catch {
        const { stdout } = await execAsync('dnf history list --reverse 2>/dev/null | tail -50', { timeout: 15_000 }).catch(() => ({ stdout: '' }));
        // minimal parsing for dnf history
        rows = stdout.split('\n').filter((l) => l.trim() && /^\s*\d+/.test(l)).map((l) => {
          const parts = l.trim().split(/\s{2,}/);
          return { id: parts[0] ?? '', description: parts[2] ?? '', installedAt: parts[1] ?? '', source: 'dnf' };
        });
      }
    }
    return buildSuccess(rows, 'update-history', platform);
  } catch (err) {
    return buildError(`update-history failed: ${String(err)}`, 'EXEC_FAILED', 'update-history');
  }
}

// ── SYS-20: installed-packages ──────────────────────────────────────────────

async function runInstalledPackages(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const rows: PackageRow[] = [];
    if (platform === 'win32' || platform === 'wsl') {
      // Try winget
      try {
        const cmd = platform === 'wsl'
          ? 'winget.exe list --source winget 2>/dev/null'
          : 'winget list --source winget 2>/dev/null';
        const { stdout } = await execAsync(cmd, { timeout: 30_000 });
        for (const line of stdout.replace(/\r\n/g, '\n').split('\n').slice(2)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('-')) continue;
          const parts = trimmed.split(/\s{2,}/);
          if (parts.length >= 2) {
            rows.push({ name: parts[0] ?? '', version: parts[1] ?? '', source: 'winget', sizeBytes: 0 });
          }
        }
      } catch {
        // winget not available
      }
    } else {
      try {
        const { stdout } = await execAsync("dpkg-query -W -f='${Package}\t${Version}\t${Installed-Size}\n' 2>/dev/null", { timeout: 30_000 });
        for (const line of stdout.split('\n')) {
          const [name, version, sizeKb] = line.split('\t');
          if (name) rows.push({ name, version: version ?? '', source: 'dpkg', sizeBytes: Number(sizeKb ?? 0) * 1024 });
        }
      } catch {
        const { stdout } = await execAsync("rpm -qa --queryformat '%{NAME}\t%{VERSION}\t%{SIZE}\n' 2>/dev/null", { timeout: 30_000 });
        for (const line of stdout.split('\n')) {
          const [name, version, sizeBytes] = line.split('\t');
          if (name) rows.push({ name, version: version ?? '', source: 'rpm', sizeBytes: Number(sizeBytes ?? 0) });
        }
      }
    }
    return buildSuccess(rows, 'installed-packages', platform);
  } catch (err) {
    return buildError(`installed-packages failed: ${String(err)}`, 'EXEC_FAILED', 'installed-packages');
  }
}

// ── Run dispatcher ──────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'installed-apps': runInstalledApps,
  'update-history': runUpdateHistory,
  'installed-packages': runInstalledPackages,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
