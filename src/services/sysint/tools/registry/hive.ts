/**
 * REG-03: registry-hive — Read offline Windows registry hive files.
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

export interface HiveRow {
  key: string;
  valueName: string;
  valueType: string;
  valueData: string;
}

export function parseHiveOutput(output: string): HiveRow[] {
  const rows: HiveRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [key, name, type, data] = parts;
    if (!key) continue;
    rows.push({
      key: (key ?? '').trim(),
      valueName: (name ?? '').trim(),
      valueType: (type ?? '').trim(),
      valueData: (data ?? '').trim(),
    });
  }
  return rows;
}

async function runRegistryHive(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOrWsl('registry-hive');
  if (platformGuard) return platformGuard;

  const hivePath = parseArg(args, '--hive-file');
  if (!hivePath) {
    return buildError('registry-hive requires --hive-file <path>', 'EXEC_FAILED', 'registry-hive');
  }

  const subKey = parseArg(args, '--key') ?? '';

  // Use reg load → query → unload approach
  // Temp mount key in HKU\SysIntTmpHive to avoid conflicts
  const tmpName = `SysIntTmpHive_${Date.now()}`;
  const script = `
$hivePath = '${hivePath.replace(/'/g, "''")}'
$tmpName = '${tmpName}'
$subKey = '${subKey.replace(/'/g, "''")}'

try {
  # Load the hive
  $null = reg load "HKU\\$tmpName" "$hivePath" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to load hive: $hivePath"
    exit 1
  }

  $rootPath = if ($subKey) { "HKU:\\$tmpName\\$subKey" } else { "HKU:\\$tmpName" }

  try {
    Get-ChildItem -Path $rootPath -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 3000 |
      ForEach-Object {
        $keyPath = $_.PSPath -replace 'Microsoft.PowerShell.Core\\\\Registry::HKU\\\\' + $tmpName, ''
        try {
          $vals = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
          if ($vals) {
            $vals.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
              $t = $_.TypeNameOfValue -replace 'System\\.', ''
              "$keyPath\t$($_.Name)\t$t\t$([string]$_.Value)"
            }
          }
        } catch {}
      }
  } finally {
    # Unload the hive
    [gc]::Collect()
    $null = reg unload "HKU\\$tmpName" 2>&1
  }
} catch {
  Write-Error $_
}
`.trim();

  try {
    const { stdout, stderr } = await execPs(script, 30000);
    if (stderr && !stdout) {
      return buildError(`registry-hive failed: ${stderr}`, 'EXEC_FAILED', 'registry-hive');
    }
    const rows = parseHiveOutput(stdout);
    return buildSuccess(rows, 'registry-hive', getPlatformName());
  } catch (err) {
    return buildError(`registry-hive failed: ${String(err)}`, 'EXEC_FAILED', 'registry-hive');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'registry-hive': runRegistryHive,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
