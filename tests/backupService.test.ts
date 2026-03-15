import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackupService } from '../src/services/backupService.js';

describe('BackupService', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-service-'));
  const srcDir = path.join(tmpRoot, 'src');
  const backupDir = path.join(tmpRoot, 'backups');

  beforeAll(() => {
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'file.txt'), 'demo');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates backups and enforces retention', async () => {
    const service = new BackupService({
      sourceDir: srcDir,
      backupDir,
      includeNodeModules: true,
      compressionEnabled: false,
      enabled: true,
      maxBackups: 1,
      intervalHours: 1,
      minIntervalMinutes: 0,
    });

    // Stub zip creation to avoid external tools
    (service as unknown as Record<string, unknown>).createZipBackup = async (
      _src: string,
      output: string,
    ) => {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'zipdata');
    };

    const first = await service.createBackup();
    expect(fs.existsSync(first)).toBe(true);

    const second = await service.createBackup();
    expect(fs.existsSync(second)).toBe(true);

    const backups = service.listBackups();
    expect(backups.length).toBe(1); // retention enforced
    const stats = service.getStats();
    expect(stats.totalBackups).toBe(1);
    expect(stats.backupDir).toBe(backupDir);
  });
});
