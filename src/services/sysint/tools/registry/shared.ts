/**
 * Shared utilities for registry sub-modules.
 * Centralizes PowerShell execution, platform guards, and output re-exports.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export { buildSuccess, buildError } from '../../outputFormatter.js';
export { getPlatformName } from '../../platforms/index.js';
export type { SysIntResult, SysIntPlatform } from '../../outputFormatter.js';

import { buildError } from '../../outputFormatter.js';
import type { SysIntError } from '../../outputFormatter.js';

const execAsync = promisify(exec);

// ── Platform guard ────────────────────────────────────────────────────────────

/**
 * Returns PLATFORM_UNSUPPORTED error if running on Linux (non-WSL).
 * WSL is allowed — it can invoke PowerShell on the Windows side.
 */
export function assertWindowsOrWsl(toolId: string): SysIntError | null {
  // In WSL, process.platform is 'linux' but WSL_DISTRO_NAME is set
  const isWsl = process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];
  if (process.platform === 'linux' && !isWsl) {
    return buildError(
      `Tool '${toolId}' is Windows-only and not supported on Linux`,
      'PLATFORM_UNSUPPORTED',
      toolId,
    );
  }
  return null;
}

// ── PowerShell execution ──────────────────────────────────────────────────────

export interface PsResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a PowerShell script string.
 * Normalizes CRLF → LF in output.
 * On WSL, invokes PowerShell.exe via Windows path.
 */
export async function execPs(script: string, timeoutMs = 15000): Promise<PsResult> {
  const isWsl = process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];
  const psExe = isWsl ? 'powershell.exe' : 'powershell';

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const cmd = `${psExe} -NoProfile -NonInteractive -EncodedCommand ${encoded}`;

  const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });
  return {
    stdout: stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
    stderr: stderr.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
  };
}

// ── Registry key helpers ──────────────────────────────────────────────────────

export type RegistryHive = 'HKLM' | 'HKCU' | 'HKCR' | 'HKU' | 'HKCC';

export interface RegistryValue {
  name: string;
  type: string;
  data: string;
}

export interface RegistryKey {
  hive: string;
  key: string;
  values: RegistryValue[];
}

/**
 * Parse the output of `reg query` command.
 * Format:
 *   HKEY_LOCAL_MACHINE\...
 *       ValueName    REG_SZ    Data
 */
export function parseRegQueryOutput(output: string): RegistryKey[] {
  const keys: RegistryKey[] = [];
  let currentKey: RegistryKey | null = null;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Key header line: starts with HKEY_
    if (trimmed.startsWith('HKEY_')) {
      const parts = trimmed.split('\\');
      const hive = normalizeHiveName(parts[0] ?? '');
      const keyPath = parts.slice(1).join('\\');
      currentKey = { hive, key: keyPath, values: [] };
      keys.push(currentKey);
      continue;
    }

    // Value line: 4+ spaces before value name
    if (currentKey && line.startsWith('    ')) {
      const valueMatch = line.match(/^\s+([^\s].*?)\s+(REG_\w+)\s+(.*?)$/);
      if (valueMatch) {
        const [, name, type, data] = valueMatch;
        currentKey.values.push({
          name: (name ?? '').trim(),
          type: (type ?? '').trim(),
          data: (data ?? '').trim(),
        });
      }
    }
  }

  return keys;
}

function normalizeHiveName(full: string): string {
  const map: Record<string, string> = {
    HKEY_LOCAL_MACHINE: 'HKLM',
    HKEY_CURRENT_USER: 'HKCU',
    HKEY_CLASSES_ROOT: 'HKCR',
    HKEY_USERS: 'HKU',
    HKEY_CURRENT_CONFIG: 'HKCC',
  };
  return map[full] ?? full;
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

export function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}
