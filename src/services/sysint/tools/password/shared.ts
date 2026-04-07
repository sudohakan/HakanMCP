/**
 * Shared utilities for password sub-modules.
 * Centralizes security measures, temp file handling, audit logging, and platform guards.
 */
import { writeFileSync, unlinkSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

export { buildSuccess, buildError } from '../../outputFormatter.js';
export { getPlatformName } from '../../platforms/index.js';
export type { SysIntResult, SysIntPlatform } from '../../outputFormatter.js';

import { buildError } from '../../outputFormatter.js';
import type { SysIntError } from '../../outputFormatter.js';

// ── Platform guards ───────────────────────────────────────────────────────────

/** Returns PLATFORM_UNSUPPORTED error if not running on Windows or WSL. */
export function assertWindowsOnly(toolId: string): SysIntError | null {
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

// ── Consent mechanism ─────────────────────────────────────────────────────────

export interface ConsentWarning {
  warning: string;
  action: string;
  _sensitive: boolean;
}

/**
 * Check for --allow-credentials consent flag.
 * Returns a warning row array if consent is missing.
 */
export function checkCredentialConsent(args: string[], toolId: string): ConsentWarning[] | null {
  if (args.includes('--allow-credentials')) return null;
  return [
    {
      warning: `Tool '${toolId}' extracts sensitive credentials. Pass --allow-credentials to proceed.`,
      action: 'consent_required',
      _sensitive: false,
    },
  ];
}

// ── Audit logging ─────────────────────────────────────────────────────────────

const AUDIT_LOG_PATH = join(homedir(), '.sysint-audit.log');

/** Append a credential access event to the audit log. */
export function logCredentialAccess(toolId: string): void {
  try {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      tool: toolId,
      platform: process.platform,
      pid: process.pid,
    });
    appendFileSync(AUDIT_LOG_PATH, entry + '\n', { encoding: 'utf8' });
  } catch {
    // Audit log failure must not block the tool
  }
}

// ── Secure temp file ──────────────────────────────────────────────────────────

export interface SecureTempFile {
  path: string;
  cleanup: () => void;
}

/**
 * Write data to a temporary file with 0o600 permissions.
 * Returns the path and a cleanup function.
 * Never passes sensitive data through CLI arguments.
 */
export function writeTempSecure(content: string | Buffer): SecureTempFile {
  const name = `sysint-${randomBytes(8).toString('hex')}`;
  const path = join(tmpdir(), name);
  writeFileSync(path, content, { mode: 0o600 });
  // chmod explicitly in case umask overrides
  try {
    chmodSync(path, 0o600);
  } catch {
    // Non-POSIX filesystems (NTFS in WSL) may not support chmod
  }
  return {
    path,
    cleanup: () => {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // Ignore cleanup errors
      }
    },
  };
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

// ── PowerShell execution ──────────────────────────────────────────────────────

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function execPs(script: string, timeoutMs = 15000): Promise<{ stdout: string; stderr: string }> {
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
