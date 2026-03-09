/**
 * Automatic backup service for MCP server directory
 * Creates hourly ZIP backups with 48-hour retention
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exec, execFile, spawn } from 'node:child_process';
import { processRegistry } from '../utils/processRegistry.js';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import { config as appConfig } from '../config.js';
import { assertPathSafe, escapeForPowerShellSingleQuoted } from '../utils/common.js';
import { PROJECT_ROOT } from '../utils/projectRoot.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface BackupConfig {
  sourceDir: string; // Directory to backup
  backupDir: string; // Where to store backups
  maxBackups: number; // Max number of backups to keep (default: 48)
  intervalHours: number; // Backup interval in hours (default: 1)
  enabled: boolean; // Enable/disable backup
  includeNodeModules: boolean; // Include node_modules in backups
  compressionEnabled: boolean; // Enable compression for archives
  retentionHours?: number; // Optional retention in hours for stats
  minIntervalMinutes?: number; // Minimum interval between backups to prevent storms
  /** Additional glob patterns to exclude from backups (plan §11 F). Merged with defaults. */
  excludes?: string[];
}

const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  sourceDir: path.resolve(PROJECT_ROOT),
  backupDir: process.env.DOCKER_CONTAINER
    ? '/mcpserver-backups'
    : path.resolve(PROJECT_ROOT, '../mcpserver-backups'),
  maxBackups: 48,
  intervalHours: 1,
  enabled: true,
  includeNodeModules: false,
  compressionEnabled: true,
  minIntervalMinutes: 30,
};

export class BackupService {
  private config: BackupConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastBackupTime: number | null = null;
  private lockFilePath: string;

  constructor(config: Partial<BackupConfig> = {}) {
    this.config = { ...DEFAULT_BACKUP_CONFIG, ...config };
    this.lockFilePath = path.join(this.config.backupDir, 'backup.lock');
    // Ensure minIntervalMinutes is at least intervalHours (prevent sub-interval backups)
    this.config.minIntervalMinutes = Math.max(
      this.config.minIntervalMinutes ?? 30,
      this.config.intervalHours * 60,
    );
    logger.info('BackupService initialized', {
      sourceDir: this.config.sourceDir,
      backupDir: this.config.backupDir,
      maxBackups: this.config.maxBackups,
      intervalHours: this.config.intervalHours,
      includeNodeModules: this.config.includeNodeModules,
      compressionEnabled: this.config.compressionEnabled,
    });
  }

  /**
   * Starts the automatic backup service
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('BackupService already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('BackupService is disabled');
      return;
    }

    // Ensure backup directory exists
    this.ensureBackupDir();

    // Role-based jitter (0-120 seconds) to prevent main/second instance overlap
    const role = (process.env.INSTANCE_ROLE || 'main').toLowerCase();
    const jitterSeconds = role === 'main' ? 0 : Math.floor(Math.random() * 120);

    // Seed lastBackupTime from most recent backup on disk to prevent
    // unnecessary backup on every restart
    this.seedLastBackupTimeFromDisk();

    // Run initial backup with jitter (interval guard will skip if too recent)
    setTimeout(() => {
      this.createBackup().catch((error) => {
        logger.error('Initial backup failed', error);
      });
    }, jitterSeconds * 1000);

    // Schedule hourly backups
    const intervalMs = Math.max(
      (this.config.minIntervalMinutes || 30) * 60 * 1000,
      this.config.intervalHours * 60 * 60 * 1000,
    );

    this.intervalId = setInterval(() => {
      this.createBackup().catch((error) => {
        logger.error('Scheduled backup failed', error);
      });
      // Cleanup old logs on each backup cycle
      this.cleanupOldLogs().catch((error) => {
        logger.error('Log cleanup failed', error);
      });
    }, intervalMs);

    this.isRunning = true;
    logger.info('BackupService started', {
      intervalHours: this.config.intervalHours,
      jitterSeconds,
      nextBackup: new Date(Date.now() + intervalMs + jitterSeconds * 1000).toISOString(),
    });
  }

  /**
   * Reads the most recent backup file's timestamp from disk and sets lastBackupTime.
   * This prevents taking a new backup on every process restart when interval hasn't elapsed.
   */
  private seedLastBackupTimeFromDisk(): void {
    try {
      const backups = this.listBackups();
      if (backups.length > 0) {
        // listBackups returns sorted oldest→newest, last element is most recent
        const mostRecent = backups[backups.length - 1];
        this.lastBackupTime = mostRecent.created;
        logger.debug('Seeded lastBackupTime from disk', {
          lastBackup: new Date(mostRecent.created).toISOString(),
          backupsOnDisk: backups.length,
        });
      }
    } catch {
      // Ignore — will treat as no previous backup
    }
  }

  /**
   * Stops the automatic backup service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    logger.info('BackupService stopped');
  }

  /**
   * Creates a backup immediately.
   * @param options.skipIntervalCheck - When true (manual/user-initiated), bypass min-interval check.
   */
  async createBackup(options?: { skipIntervalCheck?: boolean }): Promise<string> {
    if (!this.config.enabled) {
      logger.info('Backup skipped: service is disabled (backup.enabled: false)');
      return '';
    }

    const role = (process.env.INSTANCE_ROLE || 'main').toLowerCase();
    const hostname = process.env.HOSTNAME || 'localhost';
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .split('T')
      .join('_')
      .substring(0, 19);

    // Atomic write pattern: temporary partial file -> final zip
    // Keep .zip extension on partial file for Windows Compress-Archive compatibility
    const backupFileName = `mcpserver_backup_${role}_${hostname}_${timestamp}.zip`;
    const partialFileName = `mcpserver_backup_${role}_${hostname}_${timestamp}.partial.zip`;
    const backupPath = path.join(this.config.backupDir, backupFileName);
    const partialPath = path.join(this.config.backupDir, partialFileName);

    // Min interval guard (skip for manual/user-initiated runs)
    if (!options?.skipIntervalCheck && this.lastBackupTime) {
      const minIntervalMs = (this.config.minIntervalMinutes ?? 30) * 60 * 1000;
      if (Date.now() - this.lastBackupTime < minIntervalMs) {
        logger.debug('Backup skipped: too frequent', {
          lastBackupAt: new Date(this.lastBackupTime).toISOString(),
          minIntervalMinutes: this.config.minIntervalMinutes,
        });
        await this.cleanupBackupDirOrphans();
        return '';
      }
    }

    // Clean stale lock before attempting acquire
    await this.cleanStaleLock();

    // Ensure backup directory exists before lock (lock file lives inside it)
    this.ensureBackupDir();

    // Atomic lock acquire — prevents race condition between concurrent calls
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      logger.debug('Backup skipped: another backup process is running (lock found)', {
        lockFile: this.lockFilePath,
      });
      await this.cleanupBackupDirOrphans();
      return '';
    }

    try {
      logger.info('Creating backup', { backupPath });

      // Create ZIP backup at partial path
      await this.createZipBackup(this.config.sourceDir, partialPath);

      // Atomic rename
      await fsp.rename(partialPath, backupPath);

      this.lastBackupTime = Date.now();

      // Get file size
      const stats = await fsp.stat(backupPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      logger.info('Backup created successfully', {
        backupPath,
        sizeMB: `${sizeMB} MB`,
      });

      // Cleanup old backups
      await this.cleanupOldBackups();

      // Cleanup orphan/partial/0-byte files in backup dir
      await this.cleanupBackupDirOrphans();

      return backupPath;
    } catch (error) {
      logger.error('Backup creation failed', error);
      // Cleanup partial file if failed
      if (fs.existsSync(partialPath)) {
        await fsp.unlink(partialPath).catch(() => {});
      }
      throw error;
    } finally {
      await this.releaseLock();
    }
  }

  private async cleanStaleLock(): Promise<void> {
    try {
      const stats = await fsp.stat(this.lockFilePath).catch(() => null);
      if (!stats) return;

      // Stale lock cleanup (15 minutes)
      const isStale = Date.now() - stats.mtimeMs > 15 * 60 * 1000;
      if (isStale) {
        logger.info('Stale backup lock found, cleaning up', { lockFile: this.lockFilePath });
        await fsp.unlink(this.lockFilePath).catch(() => {});
      }
    } catch {
      // Ignore
    }
  }

  private async acquireLock(): Promise<boolean> {
    const lockInfo = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      role: process.env.INSTANCE_ROLE || 'main',
    };
    try {
      // wx flag: create exclusively — fails if file already exists (atomic)
      await fsp.writeFile(this.lockFilePath, JSON.stringify(lockInfo), { flag: 'wx' });
      return true;
    } catch {
      // Lock already exists — another process won the race
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    await fsp.unlink(this.lockFilePath).catch(() => {});
  }

  /**
   * Creates a ZIP archive of the source directory
   */
  private buildZipExcludes(sourceDir: string): string[] {
    const excludes: string[] = ['.env', '*.key', '*.pem', 'logs/*', '.git/*'];

    if (!this.config.includeNodeModules) {
      excludes.push('*/node_modules/*');
    }

    // Config-provided excludes (plan §11 F)
    const configExcludes = this.config.excludes;
    if (configExcludes?.length) {
      excludes.push(...configExcludes);
    }

    const normalizedSource = path.resolve(sourceDir);
    const normalizedBackup = path.resolve(this.config.backupDir);
    if (normalizedBackup.startsWith(normalizedSource)) {
      const sourceName = path.basename(normalizedSource);
      const relBackup = path
        .relative(path.dirname(normalizedSource), normalizedBackup)
        .replace(/\\/g, '/');
      excludes.push(`${sourceName}/${relBackup}/*`);
    }

    return excludes;
  }

  private async createZipBackup(sourceDir: string, outputZip: string): Promise<void> {
    assertPathSafe(sourceDir, 'sourceDir');
    assertPathSafe(outputZip, 'outputZip');

    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();

    const normalizedSource = path.resolve(sourceDir);
    const normalizedBackup = path.resolve(this.config.backupDir);

    // Build exclusion matchers
    const excludePatterns: Array<(filePath: string, name: string) => boolean> = [];

    // node_modules
    if (!this.config.includeNodeModules) {
      excludePatterns.push((fp) => fp.includes(`${path.sep}node_modules${path.sep}`) || fp.endsWith(`${path.sep}node_modules`));
    }

    // Backup dir itself
    if (normalizedBackup.startsWith(normalizedSource)) {
      excludePatterns.push((fp) => fp.startsWith(normalizedBackup));
    }

    // .git directory
    excludePatterns.push((fp, name) => name === '.git' && fs.statSync(fp).isDirectory());

    // Secrets and logs
    excludePatterns.push((_fp, name) => name === '.env');
    excludePatterns.push((_fp, name) => name.endsWith('.key'));
    excludePatterns.push((_fp, name) => name.endsWith('.pem'));
    excludePatterns.push((fp) => fp.includes(`${path.sep}logs${path.sep}`));

    // Windows reserved device names
    const reservedRe = /^(NUL|CON|PRN|AUX|COM[1-9]|LPT[1-9])(\.|$)/i;
    excludePatterns.push((_fp, name) => reservedRe.test(name));

    // Config excludes
    for (const pat of this.config.excludes ?? []) {
      if (pat.includes('*')) {
        // Simple glob: convert * to regex
        const re = new RegExp(pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i');
        excludePatterns.push((fp) => re.test(fp));
      } else {
        excludePatterns.push((_fp, name) => name === pat);
      }
    }

    function shouldExclude(filePath: string, name: string): boolean {
      return excludePatterns.some((fn) => fn(filePath, name));
    }

    // Recursive walk and add files
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (shouldExclude(fullPath, entry.name)) continue;
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const relativePath = path.relative(normalizedSource, fullPath);
          try {
            zip.addLocalFile(fullPath, path.dirname(relativePath));
          } catch {
            // Skip files that can't be read (locked, permission denied)
            logger.debug('Skipped file during backup', { file: fullPath });
          }
        }
      }
    };

    walk(normalizedSource);
    zip.writeZip(outputZip);
  }

  /**
   * Cleans orphan, partial, and 0-byte files in backup directory (plan.md A).
   * Runs on each backup cycle to prevent disk clutter.
   */
  private async cleanupBackupDirOrphans(): Promise<void> {
    try {
      let files: string[];
      try {
        files = await fsp.readdir(this.config.backupDir);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
        throw err;
      }
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      let removed = 0;

      for (const file of files) {
        const filePath = path.join(this.config.backupDir, file);
        const stats = await fsp.stat(filePath).catch(() => null);
        if (!stats || !stats.isFile()) continue;

        let shouldRemove = false;
        if (file.endsWith('.partial') || file.includes('.partial.zip')) {
          shouldRemove = stats.mtimeMs < oneHourAgo;
        } else if (file.endsWith('.zip')) {
          shouldRemove = stats.size === 0;
        } else {
          shouldRemove = !file.includes('.'); // extensionless orphan
        }

        if (shouldRemove) {
          try {
            await fsp.unlink(filePath);
            removed++;
            logger.info('Cleaned backup dir orphan', {
              file,
              reason:
                file.endsWith('.partial') || file.includes('.partial.zip')
                  ? 'stale partial'
                  : file.endsWith('.zip')
                    ? '0-byte zip'
                    : 'extensionless',
            });
          } catch (e) {
            logger.error('Failed to remove orphan', e instanceof Error ? e : new Error(String(e)), {
              file,
            });
          }
        }
      }

      if (removed > 0) {
        logger.info('Backup dir orphan cleanup completed', { removed });
      }
    } catch (error) {
      logger.error('Backup dir orphan cleanup failed', error);
    }
  }

  /**
   * Removes old backups keeping only the most recent maxBackups.
   * The last backup of each month is always preserved (monthly retention).
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const backups = this.listBackups();

      if (backups.length <= this.config.maxBackups) {
        logger.debug('No cleanup needed', {
          currentBackups: backups.length,
          maxBackups: this.config.maxBackups,
        });
        return;
      }

      // Sort by creation time (oldest first)
      backups.sort((a, b) => a.created - b.created);

      // Find the last backup of each month (year-month key)
      const monthlyLast = new Map<string, string>();
      for (const b of backups) {
        const d = new Date(b.created);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyLast.set(key, b.path); // overwrites → last one in sorted order wins
      }
      const protectedPaths = new Set(monthlyLast.values());

      // Calculate how many to delete
      const toDelete = backups.length - this.config.maxBackups;
      const candidates = backups.slice(0, toDelete);
      const deletable = candidates.filter((b) => !protectedPaths.has(b.path));

      logger.info('Cleaning up old backups', {
        toDelete,
        deletable: deletable.length,
        monthlyProtected: candidates.length - deletable.length,
        currentBackups: backups.length,
        maxBackups: this.config.maxBackups,
      });

      // Delete old backups (skip monthly-protected ones)
      await Promise.all(
        deletable.map(async (backup) => {
          try {
            await fs.promises.unlink(backup.path);
            logger.info('Deleted old backup', {
              path: backup.path,
              age: `${((Date.now() - backup.created) / (1000 * 60 * 60)).toFixed(1)} hours`,
            });
          } catch (error) {
            logger.error('Failed to delete old backup', error, { path: backup.path });
          }
        }),
      );
    } catch (error) {
      logger.error('Cleanup failed', error);
    }
  }

  /**
   * Removes log files older than 3 days (plan §H: async I/O, no sync readdir/stat/unlink)
   */
  async cleanupOldLogs(): Promise<void> {
    try {
      const logsDir = path.resolve(this.config.sourceDir, 'logs');
      let files: string[];
      try {
        files = await fsp.readdir(logsDir);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
        throw err;
      }

      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(logsDir, file);
        const stats = await fsp.stat(filePath).catch(() => null);

        if (stats && stats.isFile() && stats.mtimeMs < threeDaysAgo) {
          try {
            await fsp.unlink(filePath);
            deletedCount++;
            logger.info('Deleted old log file', {
              file,
              age: `${((Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24)).toFixed(1)} days`,
            });
          } catch (error) {
            logger.error('Failed to delete old log', error, { file });
          }
        }
      }

      if (deletedCount > 0) {
        logger.info('Log cleanup completed', { deletedCount });
      }
    } catch (error) {
      logger.error('Log cleanup failed', error);
    }
  }

  /**
   * Lists all existing backups
   */
  async listBackupsAsync(): Promise<Array<{ path: string; created: number; sizeMB: string }>> {
    if (!fs.existsSync(this.config.backupDir)) {
      return [];
    }

    const files = await fsp.readdir(this.config.backupDir);
    const backupPromises = files
      .filter((file) => file.startsWith('mcpserver_backup_') && file.endsWith('.zip') && !file.includes('.partial'))
      .map(async (file) => {
        const filePath = path.join(this.config.backupDir, file);
        const stats = await fsp.stat(filePath);
        const created = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs;
        return {
          path: filePath,
          created,
          sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
        };
      });

    const backups = await Promise.all(backupPromises);
    return backups.sort((a, b) => b.created - a.created); // Newest first
  }

  /**
   * Lists all existing backups (sync for legacy support)
   */
  listBackups(): Array<{ path: string; created: number; sizeMB: string }> {
    if (!fs.existsSync(this.config.backupDir)) {
      return [];
    }

    const files = fs.readdirSync(this.config.backupDir);
    const backups = files
      .filter((file) => file.startsWith('mcpserver_backup_') && file.endsWith('.zip') && !file.includes('.partial'))
      .map((file) => {
        const filePath = path.join(this.config.backupDir, file);
        const stats = fs.statSync(filePath);
        const created = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs;
        return {
          path: filePath,
          created,
          sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
        };
      });

    // Also cleanup any orphan partial files
    files
      .filter((file) => file.endsWith('.partial') || file.includes('.partial.zip'))
      .forEach((file) => {
        const filePath = path.join(this.config.backupDir, file);
        const stats = fs.statSync(filePath);
        // If older than 1 hour, it's an orphan
        if (Date.now() - stats.mtimeMs > 60 * 60 * 1000) {
          fs.unlinkSync(filePath);
          logger.info('Cleaned up orphan partial backup file', { file });
        }
      });

    return backups.sort((a, b) => b.created - a.created); // Newest first
  }

  /**
   * Restores from a specific backup
   */
  async restoreBackup(backupPath: string, targetDir?: string): Promise<void> {
    const restoreDir = targetDir || this.config.sourceDir;

    logger.info('Restoring backup', { backupPath, restoreDir });

    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    const isWindows = process.platform === 'win32';

    if (isWindows) {
      await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${escapeForPowerShellSingleQuoted(backupPath)}' -DestinationPath '${escapeForPowerShellSingleQuoted(restoreDir)}' -Force`,
        ],
        { timeout: 5 * 60 * 1000 },
      );
    } else {
      await execFileAsync('unzip', ['-o', backupPath, '-d', restoreDir], {
        timeout: 5 * 60 * 1000,
      });
    }

    logger.info('Backup restored successfully', { backupPath, restoreDir });
  }

  /**
   * Gets backup statistics
   */
  getStats(): {
    enabled: boolean;
    isRunning: boolean;
    sourceDir: string;
    backupDir: string;
    includeNodeModules: boolean;
    compressionEnabled: boolean;
    totalBackups: number;
    oldestBackup: string | null;
    newestBackup: string | null;
    totalSizeMB: string;
    nextBackupIn: string | null;
    lastBackupAt: string | null;
    retentionHours: number;
    intervalHours: number;
  } {
    const backups = this.listBackups();
    const totalSize = backups.reduce((sum, b) => sum + parseFloat(b.sizeMB), 0);

    let nextBackupIn: string | null = null;
    if (this.isRunning && this.intervalId) {
      const intervalMs = this.config.intervalHours * 60 * 60 * 1000;
      const lastRun = this.lastBackupTime ?? Date.now();
      const nextBackupTime = lastRun + intervalMs;
      const hoursUntil = ((nextBackupTime - Date.now()) / (1000 * 60 * 60)).toFixed(1);
      nextBackupIn = `${hoursUntil} hours`;
    }

    return {
      enabled: this.config.enabled,
      isRunning: this.isRunning,
      sourceDir: this.config.sourceDir,
      backupDir: this.config.backupDir,
      includeNodeModules: this.config.includeNodeModules,
      compressionEnabled: this.config.compressionEnabled,
      totalBackups: backups.length,
      oldestBackup:
        backups.length > 0 ? new Date(backups[backups.length - 1].created).toISOString() : null,
      newestBackup: backups.length > 0 ? new Date(backups[0].created).toISOString() : null,
      totalSizeMB: totalSize.toFixed(2),
      nextBackupIn,
      lastBackupAt: this.lastBackupTime ? new Date(this.lastBackupTime).toISOString() : null,
      retentionHours: this.config.maxBackups * this.config.intervalHours,
      intervalHours: this.config.intervalHours,
    };
  }

  /**
   * Ensures backup directory exists
   */
  private ensureBackupDir(): void {
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
      logger.info('Created backup directory', { backupDir: this.config.backupDir });
    }
  }
}

// Singleton instance
function buildBackupConfigFromAppConfig(): Partial<BackupConfig> {
  const backupCfg = appConfig.backup;
  const intervalHours = backupCfg?.intervalHours ?? DEFAULT_BACKUP_CONFIG.intervalHours;

  // maxBackups priority: config.maxBackups > derived from retentionHours > default
  let maxBackups: number;
  if (backupCfg?.maxBackups) {
    maxBackups = backupCfg.maxBackups;
  } else if (backupCfg?.retentionHours) {
    maxBackups = Math.max(1, Math.ceil(backupCfg.retentionHours / intervalHours));
  } else {
    maxBackups = DEFAULT_BACKUP_CONFIG.maxBackups;
  }
  const retentionHours = backupCfg?.retentionHours ?? maxBackups * intervalHours;

  const resolvedBackupDir = backupCfg?.localPath
    ? path.isAbsolute(backupCfg.localPath)
      ? backupCfg.localPath
      : path.resolve(PROJECT_ROOT, backupCfg.localPath)
    : DEFAULT_BACKUP_CONFIG.backupDir;

  return {
    enabled: backupCfg?.enabled ?? DEFAULT_BACKUP_CONFIG.enabled,
    sourceDir: path.resolve(PROJECT_ROOT),
    backupDir: resolvedBackupDir,
    intervalHours,
    maxBackups,
    includeNodeModules: backupCfg?.includeNodeModules ?? DEFAULT_BACKUP_CONFIG.includeNodeModules,
    compressionEnabled: backupCfg?.compressionEnabled ?? DEFAULT_BACKUP_CONFIG.compressionEnabled,
    retentionHours,
    excludes: backupCfg?.excludes,
  };
}

export const backupService = new BackupService(buildBackupConfigFromAppConfig());
