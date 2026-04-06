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

export function isSupported(): boolean {
  return process.platform === 'win32' || isWSL();
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
