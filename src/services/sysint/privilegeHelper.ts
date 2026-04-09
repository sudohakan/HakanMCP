import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { isWSL } from './pathHelper.js';
import { buildError } from './outputFormatter.js';
import type { SysIntTool } from './catalog/types.js';
import type { SysIntError, SysIntPlatform } from './outputFormatter.js';

const execAsync = promisify(exec);

export type PrivilegeLevel = 'admin' | 'user' | 'unknown';

let _privilegeLevel: PrivilegeLevel | null = null;

async function detectPrivilege(): Promise<PrivilegeLevel> {
  try {
    if (process.platform === 'win32') {
      return await detectWindowsAdmin();
    }
    // Linux or WSL — check Linux-side UID
    const uid = process.getuid?.();
    if (uid === 0) return 'admin';
    return 'user';
  } catch {
    return 'unknown';
  }
}

async function detectWindowsAdmin(): Promise<PrivilegeLevel> {
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"',
    );
    return stdout.trim().toLowerCase() === 'true' ? 'admin' : 'user';
  } catch {
    return 'unknown';
  }
}

export async function getPrivilegeLevel(): Promise<PrivilegeLevel> {
  if (_privilegeLevel !== null) return _privilegeLevel;
  _privilegeLevel = await detectPrivilege();
  return _privilegeLevel;
}

/** Reset cached privilege level for test isolation. */
export function _resetPrivilegeLevel(): void {
  _privilegeLevel = null;
}

/**
 * Check if the current process has sufficient privilege to run the tool.
 * Returns null if privilege is sufficient, or a PRIVILEGE_REQUIRED error if not.
 */
export async function requirePrivilege(
  tool: SysIntTool,
  toolId: string,
): Promise<SysIntError | null> {
  if (!tool.adminRequired) return null;
  const level = await getPrivilegeLevel();
  if (level === 'admin') return null;
  return buildError(
    `Tool '${toolId}' requires administrator/root privileges`,
    'PRIVILEGE_REQUIRED',
    toolId,
  );
}

/**
 * Check if the tool supports the current platform.
 * Returns null if supported, or a PLATFORM_UNSUPPORTED error if not.
 * Special case: WSL can use Windows-only tools (executes via PowerShell on the Windows side).
 */
export function requirePlatform(
  tool: SysIntTool,
  toolId: string,
  currentPlatform: SysIntPlatform,
): SysIntError | null {
  if (!tool.platforms || tool.platforms.length === 0) return null;
  if (tool.platforms.includes(currentPlatform)) return null;

  // WSL special case: can use Windows-only tools via PowerShell
  if (currentPlatform === 'wsl' && tool.platforms.includes('win32')) return null;

  return buildError(
    `Tool '${toolId}' is not supported on platform '${currentPlatform}'`,
    'PLATFORM_UNSUPPORTED',
    toolId,
  );
}
