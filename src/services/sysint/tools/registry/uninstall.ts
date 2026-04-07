/**
 * REG-05: registry-uninstall — List installed programs from Uninstall registry keys.
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

export interface UninstallRow {
  displayName: string;
  publisher: string;
  version: string;
  installDate: string;
  installLocation: string;
  uninstallString: string;
  is64Bit: boolean;
}

export function parseUninstallOutput(output: string): UninstallRow[] {
  const rows: UninstallRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [name, publisher, version, installDate, location, uninstall, is64Str] = parts;
    if (!name || name.trim() === '') continue;
    rows.push({
      displayName: (name ?? '').trim(),
      publisher: (publisher ?? '').trim(),
      version: (version ?? '').trim(),
      installDate: (installDate ?? '').trim(),
      installLocation: (location ?? '').trim(),
      uninstallString: (uninstall ?? '').trim(),
      is64Bit: (is64Str ?? '').trim() === 'true',
    });
  }
  return rows;
}

async function runRegistryUninstall(_args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOrWsl('registry-uninstall');
  if (platformGuard) return platformGuard;

  const script = `
$paths = @(
  @{Path='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; Is64=$true},
  @{Path='HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; Is64=$false},
  @{Path='HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; Is64=$true}
)

foreach ($p in $paths) {
  try {
    Get-ChildItem -Path $p.Path -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $v = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
        $name = [string]$v.DisplayName
        if ($name -and $name.Trim() -ne '') {
          "$name\t$([string]$v.Publisher)\t$([string]$v.DisplayVersion)\t$([string]$v.InstallDate)\t$([string]$v.InstallLocation)\t$([string]$v.UninstallString)\t$($p.Is64.ToString().ToLower())"
        }
      } catch {}
    }
  } catch {}
}
`.trim();

  try {
    const { stdout } = await execPs(script);
    const rows = parseUninstallOutput(stdout);
    // Deduplicate by displayName+version
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      const key = `${r.displayName}|${r.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return buildSuccess(unique, 'registry-uninstall', getPlatformName());
  } catch (err) {
    return buildError(`registry-uninstall failed: ${String(err)}`, 'EXEC_FAILED', 'registry-uninstall');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'registry-uninstall': runRegistryUninstall,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
