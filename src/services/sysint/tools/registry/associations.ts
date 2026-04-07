/**
 * REG-07: registry-associations — List file extension to application associations from HKCR.
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

export interface AssociationRow {
  extension: string;
  progId: string;
  description: string;
  command: string;
}

export function parseAssociationsOutput(output: string): AssociationRow[] {
  const rows: AssociationRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [ext, progId, desc, cmd] = parts;
    if (!ext || ext.trim() === '') continue;
    rows.push({
      extension: (ext ?? '').trim(),
      progId: (progId ?? '').trim(),
      description: (desc ?? '').trim(),
      command: (cmd ?? '').trim(),
    });
  }
  return rows;
}

async function runRegistryAssociations(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOrWsl('registry-associations');
  if (platformGuard) return platformGuard;

  const extFilter = parseArg(args, '--ext') ?? '';
  const extCondition = extFilter
    ? `| Where-Object { $_.PSChildName -eq '${extFilter.replace(/'/g, "''")}' }`
    : '';

  const script = `
try {
  Get-ChildItem -Path 'HKCR:\\' -ErrorAction SilentlyContinue ${extCondition} |
    Where-Object { $_.PSChildName -match '^\\..' } |
    Select-Object -First 500 |
    ForEach-Object {
      $ext = $_.PSChildName
      try {
        $progId = (Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue).'(default)'
        if ($progId) {
          $progPath = "HKCR:\\$progId"
          $desc = ''
          $cmd = ''
          try {
            $desc = (Get-ItemProperty -Path $progPath -ErrorAction SilentlyContinue).'(default)'
            $cmd = (Get-ItemProperty -Path "$progPath\\shell\\open\\command" -ErrorAction SilentlyContinue).'(default)'
          } catch {}
          "$ext\t$progId\t$([string]$desc)\t$([string]$cmd)"
        }
      } catch {}
    }
} catch {}
`.trim();

  try {
    const { stdout } = await execPs(script, 20000);
    const rows = parseAssociationsOutput(stdout);
    return buildSuccess(rows, 'registry-associations', getPlatformName());
  } catch (err) {
    return buildError(`registry-associations failed: ${String(err)}`, 'EXEC_FAILED', 'registry-associations');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'registry-associations': runRegistryAssociations,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
