/**
 * REG-08: registry-mru — List Most Recently Used file paths from Explorer registry keys.
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

export interface MruRow {
  extension: string;
  slot: number;
  path: string;
}

export function parseMruOutput(output: string): MruRow[] {
  const rows: MruRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [ext, slot, path] = parts;
    if (!ext || !path || (path ?? '').trim() === '') continue;
    rows.push({
      extension: (ext ?? '').trim(),
      slot: parseInt((slot ?? '0').trim(), 10) || 0,
      path: (path ?? '').trim(),
    });
  }
  return rows;
}

async function runRegistryMru(_args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOrWsl('registry-mru');
  if (platformGuard) return platformGuard;

  const script = `
$basePath = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs'
try {
  Get-ChildItem -Path $basePath -ErrorAction SilentlyContinue | ForEach-Object {
    $ext = $_.PSChildName
    try {
      $vals = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
      if ($vals -and $vals.MRUListEx) {
        # MRUListEx is binary: sequence of 4-byte little-endian integers
        $mruList = $vals.MRUListEx
        $slot = 0
        for ($i = 0; $i -lt $mruList.Length - 3; $i += 4) {
          $idx = [System.BitConverter]::ToInt32($mruList, $i)
          if ($idx -eq -1) { break }
          $valName = "$idx"
          $raw = $vals.$valName
          if ($raw -is [byte[]]) {
            # MRU value: unicode string terminated by null, followed by shell item data
            $nullPos = 0
            for ($j = 0; $j -lt $raw.Length - 1; $j += 2) {
              if ($raw[$j] -eq 0 -and $raw[$j+1] -eq 0) { $nullPos = $j; break }
            }
            if ($nullPos -gt 0) {
              $path = [System.Text.Encoding]::Unicode.GetString($raw, 0, $nullPos)
              "$ext\t$slot\t$path"
            }
          } elseif ($raw) {
            "$ext\t$slot\t$([string]$raw)"
          }
          $slot++
        }
      }
    } catch {}
  }
} catch {}
`.trim();

  try {
    const { stdout } = await execPs(script);
    const rows = parseMruOutput(stdout);
    return buildSuccess(rows, 'registry-mru', getPlatformName());
  } catch (err) {
    return buildError(`registry-mru failed: ${String(err)}`, 'EXEC_FAILED', 'registry-mru');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'registry-mru': runRegistryMru,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
