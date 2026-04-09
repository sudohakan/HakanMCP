/**
 * Cross-platform path helper utilities for SysInt.
 */
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

let _isWSL: boolean | null = null;

export function isWSL(): boolean {
  if (_isWSL !== null) return _isWSL;
  try {
    if (existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) {
      _isWSL = true;
      return true;
    }
    _isWSL = readFileSync('/proc/version', 'utf8')
      .toLowerCase()
      .includes('microsoft');
    return _isWSL;
  } catch {
    _isWSL = false;
    return false;
  }
}

/** Reset cached WSL detection for test isolation. */
export function _resetWSL(): void {
  _isWSL = null;
}

export async function toWindowsPath(wslPath: string): Promise<string> {
  const match = wslPath.match(/^\/mnt\/([a-z])(?:\/(.*?))?$/);
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2] ? match[2].replace(/\//g, '\\') : '';
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }
  try {
    const { stdout } = await execAsync(`wslpath -w "${wslPath}"`);
    return stdout.trim();
  } catch {
    throw new Error(`WSL path donusturulemedi: ${wslPath}`);
  }
}

/**
 * Convert a Windows path to a WSL path.
 * C:\Users\Hakan → /mnt/c/Users/Hakan
 * Passes through non-Windows paths unchanged.
 */
export function toWSLPath(windowsPath: string): string {
  const match = windowsPath.match(/^([A-Za-z]):\\(.*)/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2] ? match[2].replace(/\\/g, '/') : '';
    return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}/`;
  }
  // Not a Windows path — return as-is
  return windowsPath;
}

/**
 * Normalize path separators for current OS without cross-platform conversion.
 */
export function normalizePath(p: string): string {
  if (process.platform === 'win32') {
    return p.replace(/\//g, path.sep);
  }
  return p.replace(/\\/g, '/');
}

/** Get user home directory, cross-platform. */
export function getHomedir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/';
}

/** Get temp directory, cross-platform. */
export function getTempdir(): string {
  return process.env.TEMP ?? process.env.TMP ?? '/tmp';
}
