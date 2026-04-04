import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { DriveInfo, ScanEntry } from '../../../types/disk.js';
import type { DiskPlatform } from './types.js';

const ALLOWED_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'];

export abstract class AbstractDiskPlatform implements DiskPlatform {
  abstract getDrives(): Promise<DriveInfo[]>;
  abstract getDirectorySize(dirPath: string): Promise<number>;
  abstract getRecycleBinSize(): Promise<number>;
  abstract emptyRecycleBin(): Promise<void>;
  abstract sendToRecycleBin(filePath: string): Promise<void>;
  abstract compress(sourcePath: string, format: string, destPath: string): Promise<string>;
  abstract decompress(archivePath: string, destPath: string): Promise<void>;

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
      const entry = await this.processEntry(fullPath, item.name, depth, minSize);
      if (entry) results.push(entry);
    }
  }

  private async processEntry(fullPath: string, name: string, depth: number, minSize: number): Promise<ScanEntry | null> {
    try {
      const stat = await fs.lstat(fullPath);
      if (stat.isSymbolicLink()) return null;
      if (stat.isFile()) {
        if (stat.size < minSize) return null;
        return { name, path: fullPath, type: 'file', size: stat.size, modified: stat.mtime.toISOString(), accessed: stat.atime.toISOString() };
      }
      if (stat.isDirectory()) {
        const children: ScanEntry[] = [];
        await this.walkDir(fullPath, depth - 1, minSize, children);
        const dirSize = children.reduce((sum, c) => sum + c.size, 0);
        if (dirSize < minSize) return null;
        return { name, path: fullPath, type: 'dir', size: dirSize, modified: stat.mtime.toISOString(), accessed: stat.atime.toISOString(), children: depth > 0 ? children : undefined };
      }
      return null;
    } catch {
      return null;
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

  async getFileHash(filePath: string, algorithm: string): Promise<string> {
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
