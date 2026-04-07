/**
 * Cross-platform path helper utilities for SysInt.
 * Re-exports toWindowsPath from nirsoft; adds toWSLPath for reverse direction.
 */
import path from 'node:path';

// Re-export from nirsoft — do NOT re-implement
export { toWindowsPath } from '../nirsoft/platform.js';

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
  // Handle bare drive letter: C:\
  const bareMatch = windowsPath.match(/^([A-Za-z]):\\$/);
  if (bareMatch) {
    return `/mnt/${bareMatch[1].toLowerCase()}/`;
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
