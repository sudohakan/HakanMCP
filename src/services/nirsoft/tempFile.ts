import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

export interface TempFile {
  linuxPath: string;
  winPath: string;
}

export function createTempFile(): TempFile {
  const name = `nirsoft_${crypto.randomBytes(8).toString('hex')}.csv`;

  if (process.platform === 'win32') {
    const p = path.join(os.tmpdir(), name);
    return { linuxPath: p, winPath: p };
  }

  // WSL: Windows temp dizini kullan
  const winTemp = '/mnt/c/Windows/Temp';
  const linuxPath = path.join(winTemp, name);
  const winPath = `C:\\Windows\\Temp\\${name}`;
  return { linuxPath, winPath };
}
