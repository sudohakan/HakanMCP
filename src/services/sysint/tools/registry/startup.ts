/**
 * REG-04: registry-startup — List startup programs from Run/RunOnce registry keys.
 * Windows/WSL only. Returns PLATFORM_UNSUPPORTED on Linux.
 */
import {
  buildSuccess,
  buildError,
  getPlatformName,
  assertWindowsOrWsl,
  execPs,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface StartupRow {
  hive: string;
  key: string;
  name: string;
  command: string;
  runOnce: boolean;
}

export function parseStartupOutput(output: string): StartupRow[] {
  const rows: StartupRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const [hive, key, name, command, runOnceStr] = parts;
    if (!hive || !name) continue;
    rows.push({
      hive: (hive ?? '').trim(),
      key: (key ?? '').trim(),
      name: (name ?? '').trim(),
      command: (command ?? '').trim(),
      runOnce: (runOnceStr ?? '').trim() === 'true',
    });
  }
  return rows;
}

async function runRegistryStartup(_args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOrWsl('registry-startup');
  if (platformGuard) return platformGuard;

  const script = `
$keys = @(
  @{Hive='HKLM'; Path='SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; RunOnce=$false},
  @{Hive='HKLM'; Path='SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce'; RunOnce=$true},
  @{Hive='HKCU'; Path='SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; RunOnce=$false},
  @{Hive='HKCU'; Path='SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce'; RunOnce=$true},
  @{Hive='HKLM'; Path='SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; RunOnce=$false},
  @{Hive='HKLM'; Path='SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\RunOnce'; RunOnce=$true}
)

foreach ($k in $keys) {
  $regPath = "$($k.Hive):\\$($k.Path)"
  try {
    $vals = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
    if ($vals) {
      $vals.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
        "$($k.Hive)\t$($k.Path)\t$($_.Name)\t$([string]$_.Value)\t$($k.RunOnce.ToString().ToLower())"
      }
    }
  } catch {}
}
`.trim();

  try {
    const { stdout } = await execPs(script);
    const rows = parseStartupOutput(stdout);
    return buildSuccess(rows, 'registry-startup', getPlatformName());
  } catch (err) {
    return buildError(`registry-startup failed: ${String(err)}`, 'EXEC_FAILED', 'registry-startup');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'registry-startup': runRegistryStartup,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
