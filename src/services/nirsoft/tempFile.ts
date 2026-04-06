import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export interface TempFile {
  linuxPath: string;
  winPath: string;
}

function getWindowsTempDir(): { linuxPath: string; winPath: string } {
  try {
    const winTemp = execSync('cmd.exe /C echo %TEMP%', { encoding: 'utf8' }).trim();
    if (winTemp && !winTemp.includes('%TEMP%')) {
      // Convert Windows path back to WSL path
      const wslTemp = execSync(`wslpath "${winTemp}"`, { encoding: 'utf8' }).trim();
      return { linuxPath: wslTemp, winPath: winTemp };
    }
  } catch { /* fallback below */ }
  return { linuxPath: '/mnt/c/Windows/Temp', winPath: 'C:\\Windows\\Temp' };
}

let _wslTempDir: { linuxPath: string; winPath: string } | null = null;

export function createTempFile(): TempFile {
  const name = `nirsoft_${crypto.randomBytes(8).toString('hex')}.csv`;

  if (process.platform === 'win32') {
    const p = path.join(os.tmpdir(), name);
    return { linuxPath: p, winPath: p };
  }

  // WSL: use Windows %TEMP% (cached)
  if (!_wslTempDir) {
    _wslTempDir = getWindowsTempDir();
  }
  const linuxPath = path.join(_wslTempDir.linuxPath, name);
  const winPath = `${_wslTempDir.winPath}\\${name}`;
  return { linuxPath, winPath };
}
