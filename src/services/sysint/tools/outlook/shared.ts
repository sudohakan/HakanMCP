/**
 * Shared utilities for outlook sub-modules.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export { buildSuccess, buildError } from '../../outputFormatter.js';
export { getPlatformName } from '../../platforms/index.js';
export type { SysIntResult, SysIntPlatform } from '../../outputFormatter.js';

import { buildError } from '../../outputFormatter.js';
import type { SysIntError } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export function assertWindowsOrWsl(toolId: string): SysIntError | null {
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

export function isWsl(): boolean {
  return process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];
}

export interface PsResult {
  stdout: string;
  stderr: string;
}

export async function execPs(script: string, timeoutMs = 30000): Promise<PsResult> {
  const psExe = isWsl() ? 'powershell.exe' : 'powershell';
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const cmd = `${psExe} -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
  const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });
  return {
    stdout: stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
    stderr: stderr.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
  };
}

export function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}
