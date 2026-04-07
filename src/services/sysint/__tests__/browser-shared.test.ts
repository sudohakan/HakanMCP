/**
 * Tests for copyDbToTemp in browser/shared.ts
 * Uses real temp files (no mocks) to verify the DB safety mechanism.
 */
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let copyDbToTemp: (srcPath: string) => Promise<{ path: string; cleanup: () => Promise<void> }>;

beforeAll(async () => {
  const mod = await import('../tools/browser/shared.js');
  copyDbToTemp = mod.copyDbToTemp;
});

/** Create a temp directory and a file within it, returning cleanup. */
function makeTempSrc(fileName: string, content = 'test-db-content'): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sysint-test-'));
  const filePath = join(dir, fileName);
  writeFileSync(filePath, content);
  return { dir, filePath };
}

describe('copyDbToTemp', () => {
  it('copies DB file to a temp directory', async () => {
    const { dir: srcDir, filePath: srcPath } = makeTempSrc('test.db');
    let tempDb;
    try {
      tempDb = await copyDbToTemp(srcPath);
      expect(existsSync(tempDb.path)).toBe(true);
      expect(tempDb.path).not.toBe(srcPath);
    } finally {
      await tempDb?.cleanup();
      await rm(srcDir, { recursive: true, force: true });
    }
  });

  it('copies WAL and SHM files when they exist', async () => {
    const { dir: srcDir, filePath: srcPath } = makeTempSrc('test.db');
    writeFileSync(srcPath + '-wal', 'wal-content');
    writeFileSync(srcPath + '-shm', 'shm-content');

    let tempDb;
    try {
      tempDb = await copyDbToTemp(srcPath);
      expect(existsSync(tempDb.path + '-wal')).toBe(true);
      expect(existsSync(tempDb.path + '-shm')).toBe(true);
    } finally {
      await tempDb?.cleanup();
      await rm(srcDir, { recursive: true, force: true });
    }
  });

  it('cleanup() removes the temp directory', async () => {
    const { dir: srcDir, filePath: srcPath } = makeTempSrc('test.db');
    let tempDir: string;
    try {
      const tempDb = await copyDbToTemp(srcPath);
      tempDir = join(tempDb.path, '..');
      expect(existsSync(tempDb.path)).toBe(true);
      await tempDb.cleanup();
      expect(existsSync(tempDb.path)).toBe(false);
    } finally {
      await rm(srcDir, { recursive: true, force: true });
    }
  });

  it('cleanup() is idempotent — second call does not throw', async () => {
    const { dir: srcDir, filePath: srcPath } = makeTempSrc('test.db');
    try {
      const tempDb = await copyDbToTemp(srcPath);
      await tempDb.cleanup();
      await expect(tempDb.cleanup()).resolves.toBeUndefined();
    } finally {
      await rm(srcDir, { recursive: true, force: true });
    }
  });

  it('works when WAL and SHM do not exist', async () => {
    const { dir: srcDir, filePath: srcPath } = makeTempSrc('only.db');
    // No -wal or -shm files written

    let tempDb;
    try {
      tempDb = await copyDbToTemp(srcPath);
      expect(existsSync(tempDb.path)).toBe(true);
      expect(existsSync(tempDb.path + '-wal')).toBe(false);
      expect(existsSync(tempDb.path + '-shm')).toBe(false);
    } finally {
      await tempDb?.cleanup();
      await rm(srcDir, { recursive: true, force: true });
    }
  });
});
