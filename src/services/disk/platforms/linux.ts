import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { DriveInfo, ScanEntry } from '../../../types/disk.js';
import type { DiskPlatform } from './types.js';

const execAsync = promisify(exec);

export class LinuxPlatform implements DiskPlatform {
  async getDrives(): Promise<DriveInfo[]> {
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
    const { stdout } = await execAsync(`du -sb "${dirPath}" 2>/dev/null | cut -f1`);
    return Number(stdout.trim()) || 0;
  }

  async getDirectoryEntries(dirPath: string, depth: number, minSize: number): Promise<ScanEntry[]> {
    const entries: ScanEntry[] = [];
    await this.walkDir(dirPath, depth, minSize, entries);
    return entries;
  }

  private async walkDir(dirPath: string, depth: number, minSize: number, results: ScanEntry[]): Promise<void> {
    if (depth < 0) return;
    const items = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      try {
        const stat = await fs.stat(fullPath);
        if (item.isFile()) {
          if (stat.size >= minSize) {
            results.push({
              name: item.name,
              path: fullPath,
              type: 'file',
              size: stat.size,
              modified: stat.mtime.toISOString(),
              accessed: stat.atime.toISOString(),
            });
          }
        } else if (item.isDirectory()) {
          const children: ScanEntry[] = [];
          await this.walkDir(fullPath, depth - 1, minSize, children);
          const dirSize = children.reduce((sum, c) => sum + c.size, 0);
          if (dirSize >= minSize) {
            results.push({
              name: item.name,
              path: fullPath,
              type: 'dir',
              size: dirSize,
              modified: stat.mtime.toISOString(),
              accessed: stat.atime.toISOString(),
              children: depth > 0 ? children : undefined,
            });
          }
        }
      } catch {
        // Skip inaccessible
      }
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }

  async deleteDirRecursive(dirPath: string): Promise<void> {
    await fs.rm(dirPath, { recursive: true, force: true });
  }

  async moveItem(source: string, destination: string): Promise<void> {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(source, destination);
  }

  async getRecycleBinSize(): Promise<number> {
    const trashPath = path.join(process.env.HOME || '/tmp', '.local/share/Trash/files');
    try {
      const { stdout } = await execAsync(`du -sb "${trashPath}" 2>/dev/null | cut -f1`);
      return Number(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  async emptyRecycleBin(): Promise<void> {
    const trashPath = path.join(process.env.HOME || '/tmp', '.local/share/Trash');
    await fs.rm(path.join(trashPath, 'files'), { recursive: true, force: true });
    await fs.rm(path.join(trashPath, 'info'), { recursive: true, force: true });
    await fs.mkdir(path.join(trashPath, 'files'), { recursive: true });
    await fs.mkdir(path.join(trashPath, 'info'), { recursive: true });
  }

  async sendToRecycleBin(filePath: string): Promise<void> {
    const trashFiles = path.join(process.env.HOME || '/tmp', '.local/share/Trash/files');
    const trashInfo = path.join(process.env.HOME || '/tmp', '.local/share/Trash/info');
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
      await execAsync(`7z a "${outPath}" "${sourcePath}" -mx=5`);
      return outPath;
    }
    if (format === 'tar.gz' || format === 'tgz') {
      const outPath = destPath.endsWith('.tar.gz') ? destPath : `${destPath}.tar.gz`;
      const dir = path.dirname(sourcePath);
      const base = path.basename(sourcePath);
      await execAsync(`tar -czf "${outPath}" -C "${dir}" "${base}"`);
      return outPath;
    }
    const outPath = destPath.endsWith('.zip') ? destPath : `${destPath}.zip`;
    await execAsync(`zip -r "${outPath}" "${sourcePath}"`);
    return outPath;
  }

  async decompress(archivePath: string, destPath: string): Promise<void> {
    if (archivePath.endsWith('.7z')) {
      await execAsync(`7z x "${archivePath}" -o"${destPath}" -y`);
    } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      await execAsync(`tar -xzf "${archivePath}" -C "${destPath}"`);
    } else {
      await execAsync(`unzip -o "${archivePath}" -d "${destPath}"`);
    }
  }

  async getFileHash(filePath: string, algorithm: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return crypto.createHash(algorithm).update(content).digest('hex');
  }
}
