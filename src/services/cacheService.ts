import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../utils/projectRoot.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

export class MultiLevelCache<T = unknown> {
  private memory = new Map<string, CacheEntry<T>>();
  constructor(
    private ttlMs: number = 5 * 60 * 1000,
    private diskDir: string = path.join(PROJECT_ROOT, '.cache'),
  ) {
    fs.mkdirSync(this.diskDir, { recursive: true });
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt =
      ttlMs === undefined ? (this.ttlMs > 0 ? Date.now() + this.ttlMs : null) : Date.now() + ttlMs;
    this.memory.set(key, { value, expiresAt });
    await this.writeDisk(key, { value, expiresAt });
  }

  async get(key: string): Promise<T | null> {
    const now = Date.now();
    const mem = this.memory.get(key);
    if (mem) {
      if (mem.expiresAt !== null && mem.expiresAt < now) {
        await this.delete(key);
        return null;
      }
      return mem.value;
    }
    const disk = await this.readDisk(key);
    if (!disk) return null;
    if (disk.expiresAt !== null && disk.expiresAt < now) {
      await this.delete(key);
      return null;
    }
    this.memory.set(key, disk);
    return disk.value;
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    const p = this.diskPath(key);
    try {
      await fs.promises.unlink(p);
    } catch { /* empty */
    }
  }

  async clear(): Promise<void> {
    this.memory.clear();
    try {
      const files = await fs.promises.readdir(this.diskDir);
      await Promise.all(
        files.map((f) =>
          fs.promises.unlink(path.join(this.diskDir, f)).catch(() => {
            /* ignore */
          }),
        ),
      );
    } catch { /* empty */
    }
  }

  stats(): { items: number } {
    return { items: this.memory.size };
  }

  private diskPath(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.diskDir, `${safe}.json`);
  }

  private async writeDisk(key: string, entry: CacheEntry<T>): Promise<void> {
    try {
      await fs.promises.writeFile(this.diskPath(key), JSON.stringify(entry), { mode: 0o600 });
    } catch { /* empty */
    }
  }

  private async readDisk(key: string): Promise<CacheEntry<T> | null> {
    try {
      const p = this.diskPath(key);
      const raw = await fs.promises.readFile(p, 'utf8');
      return JSON.parse(raw) as CacheEntry<T>;
    } catch {
      return null;
    }
  }
}
