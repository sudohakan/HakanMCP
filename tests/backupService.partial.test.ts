/**
 * Tests for backup atomic write (partial->rename) and orphan cleanup (plan.md §12 A)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackupService } from '../src/services/backupService.js';

describe('BackupService partial and orphan cleanup', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-partial-'));
  const srcDir = path.join(tmpRoot, 'src');
  const backupDir = path.join(tmpRoot, 'backups');

  beforeAll(() => {
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'file.txt'), 'demo');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates partial file then renames to zip (atomic)', async () => {
    const service = new BackupService({
      sourceDir: srcDir,
      backupDir,
      minIntervalMinutes: 0,
      maxBackups: 5,
      enabled: true,
    });

    let partialPathPassed = '';
    (
      service as unknown as { createZipBackup: (a: string, b: string) => Promise<void> }
    ).createZipBackup = async (_src: string, output: string) => {
      partialPathPassed = output;
      expect(output.includes('.partial')).toBe(true);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'zipcontent');
    };

    const result = await service.createBackup();
    expect(result.endsWith('.zip')).toBe(true);
    expect(fs.existsSync(result)).toBe(true);
    expect(!fs.existsSync(partialPathPassed)).toBe(true);
  });

  it('cleans orphan partial (stale), 0-byte zip, and extensionless files', async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const orphanPartial = path.join(backupDir, 'old.partial');
    const zeroByteZip = path.join(backupDir, 'empty.zip');
    const extensionless = path.join(backupDir, 'orphan_no_ext');
    fs.writeFileSync(orphanPartial, 'x');
    fs.writeFileSync(zeroByteZip, '');
    fs.writeFileSync(extensionless, 'x');
    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(orphanPartial, twoHoursAgo, twoHoursAgo);

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

    await service.createBackup();
    expect(!fs.existsSync(orphanPartial)).toBe(true);
    expect(!fs.existsSync(zeroByteZip)).toBe(true);
    expect(!fs.existsSync(extensionless)).toBe(true);
  });
});
