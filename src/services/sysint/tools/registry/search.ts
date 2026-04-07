/**
 * REG-01: registry-search — Search Windows registry for keys/values matching a pattern.
 * Windows/WSL only. Returns PLATFORM_UNSUPPORTED on Linux.
 */
import {
  buildSuccess,
  buildError,
  getPlatformName,
  assertWindowsOrWsl,
  execPs,
  parseArg,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface RegistrySearchRow {
  hive: string;
  key: string;
  valueName: string;
  valueType: string;
  valueData: string;
}

export function parseRegistrySearchOutput(output: string): RegistrySearchRow[] {
  const rows: RegistrySearchRow[] = [];

  // PowerShell output format: tab-separated PSCustomObject fields
  // PSHive \t PSKey \t Name \t Type \t Data
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const [hive, key, name, type, data] = parts;
    if (!hive || !key) continue;
    rows.push({
      hive: (hive ?? '').trim(),
      key: (key ?? '').trim(),
      valueName: (name ?? '').trim(),
      valueType: (type ?? '').trim(),
      valueData: (data ?? '').trim(),
    });
  }

  return rows;
}

async function runRegistrySearch(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOrWsl('registry-search');
  if (platformGuard) return platformGuard;

  const pattern = parseArg(args, '--pattern');
  if (!pattern) {
    return buildError('registry-search requires --pattern <regex>', 'EXEC_FAILED', 'registry-search');
  }

  const hiveArg = parseArg(args, '--hive') ?? 'HKLM,HKCU';
  const depth = parseInt(parseArg(args, '--depth') ?? '3', 10);
  const hives = hiveArg.split(',').map((h) => h.trim()).filter(Boolean);

  const script = `
$hives = @(${hives.map((h) => `'${h}'`).join(',')})
$pattern = [regex]'${pattern.replace(/'/g, "''")}'
$depth = ${depth}
$results = @()

foreach ($hive in $hives) {
  $rootPath = "\${hive}:\\"
  try {
    Get-ChildItem -Path $rootPath -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 2000 |
      ForEach-Object {
        $keyPath = $_.PSPath -replace 'Microsoft.PowerShell.Core\\\\Registry::', ''
        $hivePart = $keyPath.Split('\\')[0]
        $subPath = ($keyPath.Split('\\') | Select-Object -Skip 1) -join '\\'
        try {
          $vals = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
          if ($vals) {
            $vals.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
              $n = $_.Name
              $v = [string]$_.Value
              if ($keyPath -match $pattern -or $n -match $pattern -or $v -match $pattern) {
                $t = $_.TypeNameOfValue -replace 'System\\.', ''
                "$hivePart\t$subPath\t$n\t$t\t$v"
              }
            }
          }
        } catch {}
      }
  } catch {}
}
`.trim();

  try {
    const { stdout } = await execPs(script, 30000);
    const rows = parseRegistrySearchOutput(stdout);
    return buildSuccess(rows, 'registry-search', getPlatformName());
  } catch (err) {
    return buildError(`registry-search failed: ${String(err)}`, 'EXEC_FAILED', 'registry-search');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'registry-search': runRegistrySearch,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
