/**
 * Shared utilities for audio sub-modules.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export { buildSuccess, buildError } from '../../outputFormatter.js';
export { getPlatformName } from '../../platforms/index.js';
export type { SysIntResult, SysIntPlatform } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export function isWsl(): boolean {
  return process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];
}

export interface CmdResult {
  stdout: string;
  stderr: string;
}

export async function execCmd(cmd: string, timeoutMs = 15000): Promise<CmdResult> {
  const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });
  return {
    stdout: stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
    stderr: stderr.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
  };
}

export async function execPs(script: string, timeoutMs = 15000): Promise<CmdResult> {
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
