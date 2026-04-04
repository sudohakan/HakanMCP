import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { DriveInfo, ScanEntry } from '../../../types/disk.js';
import type { DiskPlatform } from './types.js';

const execFileAsync = promisify(execFile);

function escapePsString(s: string): string {
  return s.replace(/'/g, "''");
}

function runPs(command: string, maxBuffer?: number): Promise<{ stdout: string }> {
  return execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    maxBuffer: maxBuffer ?? 5 * 1024 * 1024,
  });
}

export class WindowsPlatform implements DiskPlatform {
  async getDrives(): Promise<DriveInfo[]> {
    const { stdout } = await runPs(
      'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free,Root,Description | ConvertTo-Json',
      10 * 1024 * 1024,
    );
    const raw = JSON.parse(stdout);
    const drives = Array.isArray(raw) ? raw : [raw];
    return drives.map((d: Record<string, unknown>) => ({
      name: String(d.Name),
      label: String(d.Description ?? ''),
      mountpoint: String(d.Root),
      filesystem: 'NTFS',
      totalBytes: (Number(d.Used) || 0) + (Number(d.Free) || 0),
      usedBytes: Number(d.Used) || 0,
      freeBytes: Number(d.Free) || 0,
      usedPercent: ((Number(d.Used) || 0) / ((Number(d.Used) || 0) + (Number(d.Free) || 1))) * 100,
      isRemovable: false,
    }));
  }

  async getDirectorySize(dirPath: string): Promise<number> {
    const escaped = escapePsString(dirPath.replace(/\//g, '\\'));
    const { stdout } = await runPs(
      `(Get-ChildItem -LiteralPath '${escaped}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`,
      10 * 1024 * 1024,
    );
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
        const stat = await fs.lstat(fullPath);
        if (stat.isSymbolicLink()) continue;
        if (stat.isFile()) {
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
        } else if (stat.isDirectory()) {
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
        // Skip inaccessible files
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
    try {
      await fs.rename(source, destination);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.cp(source, destination, { recursive: true });
        await fs.rm(source, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
  }

  async getRecycleBinSize(): Promise<number> {
    const { stdout } = await runPs(
      '(New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $_.Size } | Measure-Object -Sum | Select-Object -ExpandProperty Sum',
    );
    return Number(stdout.trim()) || 0;
  }

  async emptyRecycleBin(): Promise<void> {
    await runPs('Clear-RecycleBin -Force');
  }

  async sendToRecycleBin(filePath: string): Promise<void> {
    const escaped = escapePsString(filePath.replace(/\//g, '\\'));
    await runPs(
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
    );
  }

  async compress(sourcePath: string, format: string, destPath: string): Promise<string> {
    const ext = format === '7z' ? '7z' : 'zip';
    const outPath = destPath.endsWith(`.${ext}`) ? destPath : `${destPath}.${ext}`;
    if (format === '7z') {
      await execFileAsync('7z', ['a', outPath, sourcePath, '-mx=5']);
    } else {
      const escaped_src = escapePsString(sourcePath.replace(/\//g, '\\'));
      const escaped_dst = escapePsString(outPath.replace(/\//g, '\\'));
      await runPs(`Compress-Archive -LiteralPath '${escaped_src}' -DestinationPath '${escaped_dst}' -Force`);
    }
    return outPath;
  }

  async decompress(archivePath: string, destPath: string): Promise<void> {
    if (archivePath.endsWith('.7z')) {
      await execFileAsync('7z', ['x', archivePath, `-o${destPath}`, '-y']);
    } else {
      const escaped_src = escapePsString(archivePath);
      const escaped_dst = escapePsString(destPath);
      await runPs(`Expand-Archive -LiteralPath '${escaped_src}' -DestinationPath '${escaped_dst}' -Force`);
    }
  }

  async getFileHash(filePath: string, algorithm: string): Promise<string> {
    const ALLOWED_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'];
    const algo = ALLOWED_ALGORITHMS.includes(algorithm) ? algorithm : 'md5';
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algo);
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
