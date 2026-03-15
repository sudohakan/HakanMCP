/**
 * Plan F: Sensitive data leak in backups — .env, *.key, *.pem, logs/* must NOT be in backups.
 */
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackupService } from '../src/services/backupService.js';

function entriesContainSensitive(zipPath: string): {
  hasEnv: boolean;
  hasKey: boolean;
  hasPem: boolean;
  hasLogs: boolean;
  all: string[];
} {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const names = entries.map((e: { entryName: string }) => e.entryName.replace(/\\/g, '/'));
  return {
    hasEnv: names.some((n: string) => n.endsWith('.env') || n.includes('/.env')),
    hasKey: names.some((n: string) => n.endsWith('.key') || n.includes('/.key')),
    hasPem: names.some((n: string) => n.endsWith('.pem') || n.includes('/.pem')),
    hasLogs: names.some((n: string) => n.includes('/logs/')),
    all: names,
  };
}

describe('BackupService exclude sensitive files (plan F)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-exclude-'));
  const srcDir = path.join(tmpRoot, 'project');
  const backupDir = path.join(tmpRoot, 'backups');

  beforeAll(() => {
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(path.join(srcDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, '.env'), 'SECRET=xxx');
    fs.writeFileSync(path.join(srcDir, 'secret.key'), 'keydata');
    fs.writeFileSync(path.join(srcDir, 'cert.pem'), 'pemdata');
    fs.writeFileSync(path.join(srcDir, 'logs', 'app.log'), 'logdata');
    fs.writeFileSync(path.join(srcDir, 'config.yaml'), 'server: ok');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('excludes .env, *.key, *.pem, logs/* from backup content', async () => {
    const service = new BackupService({
      sourceDir: srcDir,
      backupDir,
      minIntervalMinutes: 0,
      maxBackups: 5,
      enabled: true,
    });

    const result = await service.createBackup();
    expect(result).toBeTruthy();
    expect(result.endsWith('.zip')).toBe(true);
    expect(fs.existsSync(result)).toBe(true);

    const check = entriesContainSensitive(result);
    expect(check.hasEnv).toBe(false);
    expect(check.hasKey).toBe(false);
    expect(check.hasPem).toBe(false);
    expect(check.hasLogs).toBe(false);

    expect(check.all.some((n: string) => n.includes('config.yaml'))).toBe(true);
  });
});
