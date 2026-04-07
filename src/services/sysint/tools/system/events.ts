/**
 * SYS-09: event-log      — Windows Event Log / Linux journald reader.
 * SYS-10: crash-analysis — BSOD/crash minidump / Linux dmesg panic.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export interface EventRow {
  timestamp: string;
  id: number;
  level: string;
  source: string;
  message: string;
}

export interface CrashRow {
  fileName?: string;
  crashedAt?: string;
  sizeBytes?: number;
  bugCheck?: string;
  timestamp?: string;
  message?: string;
  severity?: string;
}

// ── Exported parsers ─────────────────────────────────────────────────────────

export function parseWinEvent(json: string): EventRow[] {
  const raw = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((e: Record<string, unknown>) => ({
    timestamp: String(e['TimeCreated'] ?? e['TimeGenerated'] ?? ''),
    id: Number(e['Id'] ?? e['EventID'] ?? 0),
    level: String(e['LevelDisplayName'] ?? e['Level'] ?? ''),
    source: String(e['ProviderName'] ?? e['Source'] ?? ''),
    message: String(e['Message'] ?? '').slice(0, 500),
  }));
}

export function parseJournalctl(json: string): EventRow[] {
  const rows: EventRow[] = [];
  for (const line of json.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as Record<string, unknown>;
      const ts = e['__REALTIME_TIMESTAMP'];
      const timestamp = ts ? new Date(Number(ts) / 1000).toISOString() : '';
      const priority = Number(e['PRIORITY'] ?? 6);
      const levelMap: Record<number, string> = {
        0: 'emergency', 1: 'alert', 2: 'critical', 3: 'error',
        4: 'warning', 5: 'notice', 6: 'info', 7: 'debug',
      };
      rows.push({
        timestamp,
        id: 0,
        level: levelMap[priority] ?? 'info',
        source: String(e['_SYSTEMD_UNIT'] ?? e['SYSLOG_IDENTIFIER'] ?? ''),
        message: String(e['MESSAGE'] ?? '').slice(0, 500),
      });
    } catch {
      // skip malformed lines
    }
  }
  return rows;
}

export function parseMinidumpList(files: string[]): CrashRow[] {
  return files
    .filter((f) => f.endsWith('.dmp'))
    .map((f) => {
      // Filename format: APPNAME.EXE-HASH.dmp or Mini010124-01.dmp
      const baseName = f.split('/').pop() ?? f;
      return {
        fileName: baseName,
        crashedAt: '',
        sizeBytes: 0,
        bugCheck: '',
      };
    });
}

// ── SYS-09: event-log ───────────────────────────────────────────────────────

const LEVEL_MAP: Record<string, number> = {
  critical: 1, error: 2, warning: 3, information: 4, info: 4, all: 0,
};

async function runEventLog(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [level = 'all', source, hoursStr = '24', limitStr = '100'] = args;
  const hours = parseInt(hoursStr, 10) || 24;
  const limit = parseInt(limitStr, 10) || 100;

  try {
    if (platform === 'win32' || platform === 'wsl') {
      const levelNum = LEVEL_MAP[level.toLowerCase()] ?? 0;
      const levelFilter = levelNum > 0 ? `, Level=${levelNum}` : '';
      const sourceFilter = source ? `, ProviderName='${source}'` : '';
      const ps = `Get-WinEvent -FilterHashtable @{LogName='System','Application'; StartTime=(Get-Date).AddHours(-${hours})${levelFilter}${sourceFilter}} -MaxEvents ${limit} -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,Message | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 60_000 });
      const rows = parseWinEvent(stdout);
      return buildSuccess(rows, 'event-log', platform);
    } else {
      const priorities = level === 'all' ? '' : level === 'error' || level === 'critical' ? '-p err..emerg' : level === 'warning' ? '-p warning..emerg' : '';
      const unitFilter = source ? `--unit=${source}` : '';
      const cmd = `journalctl ${priorities} ${unitFilter} -n ${limit} --since "${hours} hours ago" -o json --no-pager 2>/dev/null`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const rows = parseJournalctl(stdout);
      return buildSuccess(rows, 'event-log', platform);
    }
  } catch (err) {
    return buildError(`event-log failed: ${String(err)}`, 'EXEC_FAILED', 'event-log');
  }
}

// ── SYS-10: crash-analysis ──────────────────────────────────────────────────

async function runCrashAnalysis(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const dumpDir = platform === 'wsl' ? '/mnt/c/Windows/Minidump' : 'C:\\Windows\\Minidump';
      const rows: CrashRow[] = [];

      try {
        const files = await readdir(dumpDir);
        for (const file of files.filter((f) => f.endsWith('.dmp'))) {
          const filePath = join(dumpDir, file);
          let sizeBytes = 0;
          let mtime = '';
          try {
            const st = await stat(filePath);
            sizeBytes = st.size;
            mtime = st.mtime.toISOString();
          } catch {
            // ignore
          }
          rows.push({
            fileName: file,
            crashedAt: mtime,
            sizeBytes,
            bugCheck: '',
          });
        }
      } catch {
        // No minidump directory or access denied
      }

      // Also check WER crash events
      try {
        const ps = "Get-WinEvent -FilterHashtable @{LogName='Application'; Id=@(1000,1001,1002)} -MaxEvents 10 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,Message | ConvertTo-Json -Compress";
        const cmd = platform === 'wsl'
          ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`
          : `powershell -NoProfile -Command "${ps}"`;
        const { stdout } = await execAsync(cmd, { timeout: 30_000 });
        const events = parseWinEvent(stdout);
        for (const ev of events) {
          rows.push({
            fileName: '',
            crashedAt: ev.timestamp,
            sizeBytes: 0,
            bugCheck: ev.message.slice(0, 200),
          });
        }
      } catch {
        // ignore
      }

      return buildSuccess(rows, 'crash-analysis', platform);
    } else {
      const { stdout } = await execAsync("dmesg 2>/dev/null | grep -iE '(panic|oops|bug:|kernel BUG|call trace)' | tail -50", { timeout: 15_000 });
      const rows: CrashRow[] = stdout
        .replace(/\r\n/g, '\n').split('\n')
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^\[\s*([\d.]+)\]/);
          return {
            timestamp: match ? `+${match[1]}s` : '',
            message: line.trim(),
            severity: line.toLowerCase().includes('panic') ? 'critical' : 'error',
          };
        });
      return buildSuccess(rows, 'crash-analysis', platform);
    }
  } catch (err) {
    return buildError(`crash-analysis failed: ${String(err)}`, 'EXEC_FAILED', 'crash-analysis');
  }
}

// ── Run dispatcher ──────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'event-log': runEventLog,
  'crash-analysis': runCrashAnalysis,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
