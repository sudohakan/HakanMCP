import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { DriveInfo } from '../../../types/disk.js';
import { AbstractDiskPlatform } from './base.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export class LinuxPlatform extends AbstractDiskPlatform {
  async getDrives(): Promise<DriveInfo[]> {
    // No user input — safe to use exec for piped command
    const { stdout } = await execAsync(
      'df -B1 --output=source,fstype,size,used,avail,pcent,target -x tmpfs -x devtmpfs -x squashfs 2>/dev/null || df -k',
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const lines = stdout.trim().split('\n').slice(1);
    return lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      const total = Number(parts[2]) || 0;
      const used = Number(parts[3]) || 0;
      const free = Number(parts[4]) || 0;
      return {
        name: parts[0],
        label: '',
        mountpoint: parts[6] || parts[parts.length - 1],
        filesystem: parts[1] || 'unknown',
        totalBytes: total,
        usedBytes: used,
        freeBytes: free,
        usedPercent: total > 0 ? (used / total) * 100 : 0,
        isRemovable: (parts[0] || '').startsWith('/dev/sd'),
      };
    });
  }

  async getDirectorySize(dirPath: string): Promise<number> {
    const { stdout } = await execFileAsync('du', ['-sb', '--', dirPath]);
    const match = stdout.match(/^(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  async getRecycleBinSize(): Promise<number> {
    const trashPath = path.join(os.homedir(), '.local/share/Trash/files');
    try {
      const { stdout } = await execFileAsync('du', ['-sb', '--', trashPath]);
      const match = stdout.match(/^(\d+)/);
      return match ? Number(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  async emptyRecycleBin(): Promise<void> {
    const trashPath = path.join(os.homedir(), '.local/share/Trash');
    await fs.rm(path.join(trashPath, 'files'), { recursive: true, force: true });
    await fs.rm(path.join(trashPath, 'info'), { recursive: true, force: true });
    await fs.mkdir(path.join(trashPath, 'files'), { recursive: true });
    await fs.mkdir(path.join(trashPath, 'info'), { recursive: true });
  }

  async sendToRecycleBin(filePath: string): Promise<void> {
    const trashFiles = path.join(os.homedir(), '.local/share/Trash/files');
    const trashInfo = path.join(os.homedir(), '.local/share/Trash/info');
    await fs.mkdir(trashFiles, { recursive: true });
    await fs.mkdir(trashInfo, { recursive: true });
    const basename = path.basename(filePath);
    await fs.rename(filePath, path.join(trashFiles, basename));
    const infoContent = `[Trash Info]\nPath=${filePath}\nDeletionDate=${new Date().toISOString()}\n`;
    await fs.writeFile(path.join(trashInfo, `${basename}.trashinfo`), infoContent);
  }

  async compress(sourcePath: string, format: string, destPath: string): Promise<string> {
    if (format === '7z') {
      const outPath = destPath.endsWith('.7z') ? destPath : `${destPath}.7z`;
      await execFileAsync('7z', ['a', outPath, sourcePath, '-mx=5']);
      return outPath;
    }
    if (format === 'tar.gz' || format === 'tgz') {
      const outPath = destPath.endsWith('.tar.gz') ? destPath : `${destPath}.tar.gz`;
      const dir = path.dirname(sourcePath);
      const base = path.basename(sourcePath);
      await execFileAsync('tar', ['-czf', outPath, '-C', dir, base]);
      return outPath;
    }
    const outPath = destPath.endsWith('.zip') ? destPath : `${destPath}.zip`;
    await execFileAsync('zip', ['-r', outPath, sourcePath]);
    return outPath;
  }

  async decompress(archivePath: string, destPath: string): Promise<void> {
    if (archivePath.endsWith('.7z')) {
      await execFileAsync('7z', ['x', archivePath, `-o${destPath}`, '-y']);
    } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      await execFileAsync('tar', ['-xzf', archivePath, '-C', destPath]);
    } else {
      await execFileAsync('unzip', ['-o', archivePath, '-d', destPath]);
    }
  }
}
