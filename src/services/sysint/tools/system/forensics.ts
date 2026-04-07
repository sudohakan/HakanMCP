/**
 * SYS-14: login-history       — Login/logoff events.
 * SYS-15: boot-history        — System boot/shutdown times.
 * SYS-16: prefetch-info       — Windows prefetch / Linux prelink.
 * SYS-17: shell-extensions    — Windows shell extension listing.
 * SYS-18: running-services    — Running services only (filters service-list).
 * SYS-19: security-software   — Antivirus/security product detection.
 * SYS-21: environment-vars    — Process environment variables.
 * SYS-24: last-activity       — Aggregated activity timeline.
 * SYS-25: jump-lists          — Windows jump list metadata.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

// ── Exported parsers ─────────────────────────────────────────────────────────

export function parseLastOutput(text: string): Array<{ user: string; type: string; fromAddress: string; loginAt: string; logoutAt: string; duration: string }> {
  const rows: Array<{ user: string; type: string; fromAddress: string; loginAt: string; logoutAt: string; duration: string }> = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('wtmp') || trimmed.startsWith('btmp')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const user = parts[0] ?? '';
    if (user === 'reboot' || user === 'shutdown') continue;
    const from = parts[2] ?? '';
    const isAddr = from.includes('.') || from.includes(':') || from === ':0' || from === 'pts/0';
    rows.push({
      user,
      type: isAddr ? 'remote' : 'local',
      fromAddress: isAddr ? from : '',
      loginAt: parts.slice(3, 7).join(' '),
      logoutAt: parts[8] ?? '',
      duration: parts[9] ?? '',
    });
  }
  return rows;
}

export function parseBootEvents(json: string): Array<{ eventType: string; timestamp: string; reason: string }> {
  const raw = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  const ID_MAP: Record<number, string> = { 6005: 'startup', 6006: 'shutdown', 6008: 'unexpected' };
  return list.map((e: Record<string, unknown>) => ({
    eventType: ID_MAP[Number(e['Id'] ?? 0)] ?? 'unknown',
    timestamp: String(e['TimeCreated'] ?? ''),
    reason: String(e['Message'] ?? '').slice(0, 200),
  }));
}

export function parsePrefetchList(json: string): Array<{ appName: string; hash: string; lastRun: string; runCount: number; sizeBytes: number; filePath: string }> {
  const raw = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((f: Record<string, unknown>) => {
    const name = String(f['Name'] ?? '');
    // Prefetch filename: APPNAME.EXE-HASH.pf
    const match = name.match(/^(.+)-([A-F0-9]{8})\.pf$/i);
    return {
      appName: match?.[1] ?? name,
      hash: match?.[2] ?? '',
      lastRun: String(f['LastAccessTime'] ?? f['LastWriteTime'] ?? ''),
      runCount: 0, // not extractable from filesystem metadata alone
      sizeBytes: Number(f['Length'] ?? 0),
      filePath: String(f['FullName'] ?? ''),
    };
  });
}

export function parseJumpListFiles(files: string[]): Array<{ appId: string; fileName: string; lastAccessTime: string; sizeBytes: number }> {
  return files
    .filter((f) => f.endsWith('.automaticDestinations-ms'))
    .map((f) => {
      const baseName = f.split('/').pop()?.split('\\').pop() ?? f;
      return {
        appId: baseName.replace('.automaticDestinations-ms', ''),
        fileName: baseName,
        lastAccessTime: '',
        sizeBytes: 0,
      };
    });
}

// ── SYS-14: login-history ───────────────────────────────────────────────────

async function runLoginHistory(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = "Get-WinEvent -FilterHashtable @{LogName='Security'; Id=@(4624,4634)} -MaxEvents 100 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,Message | ConvertTo-Json -Compress";
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const raw = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(raw) ? raw : [raw];
      const rows = list.map((e: Record<string, unknown>) => {
        const msg = String(e['Message'] ?? '');
        const userMatch = msg.match(/Account Name:\s+(.+)/);
        const addrMatch = msg.match(/Source Network Address:\s+(.+)/);
        return {
          user: userMatch?.[1]?.trim() ?? '',
          type: Number(e['Id']) === 4634 ? 'logout' : 'login',
          fromAddress: addrMatch?.[1]?.trim() ?? '',
          loginAt: String(e['TimeCreated'] ?? ''),
          logoutAt: '',
          duration: '',
        };
      });
      return buildSuccess(rows, 'login-history', platform);
    } else {
      const { stdout } = await execAsync('last -n 100 -F 2>/dev/null', { timeout: 15_000 });
      const rows = parseLastOutput(stdout);
      return buildSuccess(rows, 'login-history', platform);
    }
  } catch (err) {
    return buildError(`login-history failed: ${String(err)}`, 'EXEC_FAILED', 'login-history');
  }
}

// ── SYS-15: boot-history ────────────────────────────────────────────────────

async function runBootHistory(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = "Get-WinEvent -FilterHashtable @{LogName='System'; Id=@(6005,6006,6008)} -MaxEvents 50 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,Message | ConvertTo-Json -Compress";
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const rows = parseBootEvents(stdout);
      return buildSuccess(rows, 'boot-history', platform);
    } else {
      const { stdout } = await execAsync('last -n 50 -F reboot 2>/dev/null', { timeout: 15_000 });
      const rows = stdout
        .replace(/\r\n/g, '\n').split('\n')
        .filter((l) => l.includes('reboot'))
        .map((l) => {
          const parts = l.trim().split(/\s+/);
          return {
            eventType: 'startup',
            timestamp: parts.slice(4, 8).join(' '),
            reason: '',
          };
        });
      return buildSuccess(rows, 'boot-history', platform);
    }
  } catch (err) {
    return buildError(`boot-history failed: ${String(err)}`, 'EXEC_FAILED', 'boot-history');
  }
}

// ── SYS-16: prefetch-info ───────────────────────────────────────────────────

async function runPrefetchInfo(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  if (platform === 'linux') {
    return buildSuccess([], 'prefetch-info', platform);
  }
  try {
    const ps = "Get-Item 'C:\\Windows\\Prefetch\\*.pf' -ErrorAction SilentlyContinue | Select-Object Name,LastAccessTime,LastWriteTime,Length,FullName | ConvertTo-Json -Compress";
    const cmd = platform === 'wsl'
      ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
      : `powershell -NoProfile -Command "${ps}"`;
    const { stdout } = await execAsync(cmd, { timeout: 30_000 });
    const rows = parsePrefetchList(stdout);
    return buildSuccess(rows, 'prefetch-info', platform);
  } catch (err) {
    return buildError(`prefetch-info failed: ${String(err)}`, 'EXEC_FAILED', 'prefetch-info');
  }
}

// ── SYS-17: shell-extensions ────────────────────────────────────────────────

async function runShellExtensions(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  if (platform === 'linux') {
    return buildSuccess([], 'shell-extensions', platform);
  }
  try {
    const ps = "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Approved' -ErrorAction SilentlyContinue | Select-Object * -ExcludeProperty PS* | ConvertTo-Json -Compress";
    const cmd = platform === 'wsl'
      ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
      : `powershell -NoProfile -Command "${ps}"`;
    const { stdout } = await execAsync(cmd, { timeout: 30_000 });
    const raw = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '{}');
    const rows = Object.entries(raw as Record<string, unknown>).map(([guid, name]) => ({
      guid,
      name: String(name),
      approved: true,
      filePath: '',
    }));
    return buildSuccess(rows, 'shell-extensions', platform);
  } catch (err) {
    return buildError(`shell-extensions failed: ${String(err)}`, 'EXEC_FAILED', 'shell-extensions');
  }
}

// ── SYS-18: running-services ────────────────────────────────────────────────

async function runRunningServices(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const { run: processRun } = await import('../process.js');
    const result = await processRun('service-list', []);
    const resultObj = result as unknown as Record<string, unknown>;
    if ('rows' in resultObj) {
      const running = (resultObj['rows'] as Array<Record<string, unknown>>).filter(
        (r) => r['status'] === 'running',
      );
      return buildSuccess(running, 'running-services', platform);
    }
    return buildSuccess([], 'running-services', platform);
  } catch (err) {
    return buildError(`running-services failed: ${String(err)}`, 'EXEC_FAILED', 'running-services');
  }
}

// ── SYS-19: security-software ───────────────────────────────────────────────

async function runSecuritySoftware(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Select-Object displayName,productState,pathToSignedProductExe | ConvertTo-Json -Compress";
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const raw = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(raw) ? raw : [raw];
      const rows = list.map((p: Record<string, unknown>) => ({
        name: String(p['displayName'] ?? ''),
        type: 'antivirus',
        state: String(p['productState'] ?? ''),
        definitionsDate: '',
        provider: String(p['displayName'] ?? ''),
      }));
      return buildSuccess(rows, 'security-software', platform);
    } else {
      // Linux: check for known AV process names
      const KNOWN_AV = ['clamav', 'clamd', 'freshclam', 'sophos', 'symantec', 'avg', 'avast', 'kaspersky', 'bitdefender'];
      const { stdout } = await execAsync('ps aux 2>/dev/null | grep -iE "(clamav|clamd|sophos|symantec|avg|avast)" | grep -v grep', { timeout: 10_000 }).catch(() => ({ stdout: '' }));
      const rows = KNOWN_AV.filter((av) => stdout.toLowerCase().includes(av)).map((av) => ({
        name: av,
        type: 'antivirus',
        state: 'running',
        definitionsDate: '',
        provider: av,
      }));
      return buildSuccess(rows, 'security-software', platform);
    }
  } catch (err) {
    return buildError(`security-software failed: ${String(err)}`, 'EXEC_FAILED', 'security-software');
  }
}

// ── SYS-21: environment-vars ────────────────────────────────────────────────

async function runEnvironmentVars(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [filter] = args;
  try {
    let rows = Object.entries(process.env)
      .filter(([, v]) => v !== undefined)
      .map(([name, value]) => ({ name, value: value ?? '' }));
    if (filter) {
      const f = filter.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(f));
    }
    return buildSuccess(rows, 'environment-vars', platform);
  } catch (err) {
    return buildError(`environment-vars failed: ${String(err)}`, 'EXEC_FAILED', 'environment-vars');
  }
}

// ── SYS-24: last-activity ───────────────────────────────────────────────────

async function runLastActivity(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const events: Array<{ timestamp: string; type: string; description: string; source: string }> = [];

  try {
    // Source 1: Login history
    if (platform === 'win32' || platform === 'wsl') {
      try {
        const ps = "Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624} -MaxEvents 10 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Message | ConvertTo-Json -Compress";
        const cmd = platform === 'wsl'
          ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
          : `powershell -NoProfile -Command "${ps}"`;
        const { stdout } = await execAsync(cmd, { timeout: 20_000 });
        const raw = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
        const list = Array.isArray(raw) ? raw : [raw];
        for (const e of list) {
          events.push({
            timestamp: String(e['TimeCreated'] ?? ''),
            type: 'login',
            description: 'User logged in',
            source: 'Security EventLog',
          });
        }
      } catch {
        // ignore
      }
    } else {
      try {
        const { stdout } = await execAsync('last -n 10 -F 2>/dev/null', { timeout: 10_000 });
        const logins = parseLastOutput(stdout);
        for (const l of logins.slice(0, 10)) {
          events.push({
            timestamp: l.loginAt,
            type: 'login',
            description: `${l.user} logged in from ${l.fromAddress || 'local'}`,
            source: 'wtmp',
          });
        }
      } catch {
        // ignore
      }
    }

    // Source 2: Recently modified files in home dir
    try {
      const homeDir = homedir();
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
      const entries = await readdir(homeDir);
      for (const entry of entries.slice(0, 20)) {
        try {
          const st = await stat(join(homeDir, entry));
          if (st.isFile() && st.mtime > cutoff) {
            events.push({
              timestamp: st.mtime.toISOString(),
              type: 'file_open',
              description: `File modified: ${entry}`,
              source: 'filesystem',
            });
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return buildSuccess(events.slice(0, 50), 'last-activity', platform);
  } catch (err) {
    return buildError(`last-activity failed: ${String(err)}`, 'EXEC_FAILED', 'last-activity');
  }
}

// ── SYS-25: jump-lists ──────────────────────────────────────────────────────

async function runJumpLists(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();

  if (platform === 'linux') {
    return buildError('jump-lists is Windows-only (Windows Jump Lists not available on Linux)', 'PLATFORM_UNSUPPORTED', 'jump-lists');
  }

  try {
    const winUser = process.env['USER'] ?? process.env['USERNAME'] ?? userInfo().username ?? 'Public';
    const appDataDir = platform === 'wsl'
      ? `/mnt/c/Users/${winUser}/AppData/Roaming/Microsoft/Windows/Recent/AutomaticDestinations`
      : `${process.env['APPDATA'] ?? ''}\\Microsoft\\Windows\\Recent\\AutomaticDestinations`;

    const files = await readdir(appDataDir).catch(() => [] as string[]);
    const rows: Array<{ appId: string; fileName: string; lastAccessTime: string; sizeBytes: number }> = [];

    for (const file of files.filter((f) => f.endsWith('.automaticDestinations-ms'))) {
      let sizeBytes = 0;
      let lastAccessTime = '';
      try {
        const st = await stat(join(appDataDir, file));
        sizeBytes = st.size;
        lastAccessTime = st.atime.toISOString();
      } catch {
        // ignore
      }
      rows.push({
        appId: file.replace('.automaticDestinations-ms', ''),
        fileName: file,
        lastAccessTime,
        sizeBytes,
      });
    }
    return buildSuccess(rows, 'jump-lists', platform);
  } catch (err) {
    return buildError(`jump-lists failed: ${String(err)}`, 'EXEC_FAILED', 'jump-lists');
  }
}

// ── Run dispatcher ──────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'login-history': runLoginHistory,
  'boot-history': runBootHistory,
  'prefetch-info': runPrefetchInfo,
  'shell-extensions': runShellExtensions,
  'running-services': runRunningServices,
  'security-software': runSecuritySoftware,
  'environment-vars': runEnvironmentVars,
  'last-activity': runLastActivity,
  'jump-lists': runJumpLists,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
