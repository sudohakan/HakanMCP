/**
 * Tests for backup jitter + lock: two concurrent instances do not conflict (plan.md §12 A)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackupService } from '../src/services/backupService.js';

describe('BackupService jitter and lock', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-jitter-'));
  const srcDir = path.join(tmpRoot, 'src');
  const backupDir = path.join(tmpRoot, 'backups');

  beforeAll(() => {
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'file.txt'), 'demo');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('skips backup when lock is held by another instance', async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const lockPath = path.join(backupDir, 'backup.lock');
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 99999,
        timestamp: new Date().toISOString(),
        role: 'main',
      }),
      'utf8',
    );

    const service = new BackupService({
      sourceDir: srcDir,
      backupDir,
      minIntervalMinutes: 0,
      maxBackups: 5,
      enabled: true,
    });

    const result = await service.createBackup();
    expect(result).toBe('');

    const zipFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith('.zip'));
    expect(zipFiles.length).toBe(0);
  });

  it('allows backup when lock is stale (>15 min)', async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const lockPath = path.join(backupDir, 'backup.lock');
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 99999,
        timestamp: new Date().toISOString(),
        role: 'main',
      }),
      'utf8',
    );
    const twentyMinutesAgo = (Date.now() - 20 * 60 * 1000) / 1000;
    fs.utimesSync(lockPath, twentyMinutesAgo, twentyMinutesAgo);

    const service = new BackupService({
      sourceDir: srcDir,
      backupDir,
      minIntervalMinutes: 0,
      maxBackups: 5,
      enabled: true,
    });

    (
      service as unknown as { createZipBackup: (a: string, b: string) => Promise<void> }
    ).createZipBackup = async (_src: string, output: string) => {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'content');
    };

    const result = await service.createBackup();
    expect(result.endsWith('.zip')).toBe(true);
    expect(fs.existsSync(result)).toBe(true);
    expect(!fs.existsSync(lockPath)).toBe(true);
  });

  it('two services share lock file; second skips while first runs', async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const releaseFirst = { release: () => {} };
    const firstStarted = { value: false };
    const secondSkipped = { value: false };

    const service1 = new BackupService({
      sourceDir: srcDir,
      backupDir,
      minIntervalMinutes: 0,
      maxBackups: 5,
      enabled: true,
    });

    (
      service1 as unknown as { createZipBackup: (a: string, b: string) => Promise<void> }
    ).createZipBackup = async (_src: string, output: string) => {
      firstStarted.value = true;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'x');
      await new Promise<void>((resolve) => {
        releaseFirst.release = resolve;
      });
    };

    const p1 = service1.createBackup();
    await new Promise((r) => setTimeout(r, 50));
    expect(firstStarted.value).toBe(true);

    const service2 = new BackupService({
      sourceDir: srcDir,
      backupDir,
      minIntervalMinutes: 0,
      maxBackups: 5,
      enabled: true,
    });

    (
      service2 as unknown as { createZipBackup: (a: string, b: string) => Promise<void> }
    ).createZipBackup = async () => {
      secondSkipped.value = true;
      throw new Error('Second should not run createZipBackup');
    };

    const result2 = await service2.createBackup();
    expect(result2).toBe('');
    expect(secondSkipped.value).toBe(false);

    releaseFirst.release();
    const result1 = await p1;
    expect(result1.endsWith('.zip')).toBe(true);
  });
});
