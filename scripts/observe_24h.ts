/**
 * 24h observation helper.
 * Logs backup dir metrics periodically to logs/agent/observation-24h.jsonl.
 * Run: hakanmcp observe
 * Or: node --no-warnings --loader ts-node/esm scripts/observe_24h.ts
 *
 * Optional env:
 *   OBSERVE_INTERVAL_MIN=15  (default)
 *   OBSERVE_DURATION_HOUR=24 (default, 0 = indefinite)
 *
 * Read-only; does not trigger backup cleanup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

const INTERVAL_MS = (parseInt(process.env.OBSERVE_INTERVAL_MIN || '15', 10) || 15) * 60 * 1000;
const DURATION_MS =
  (parseInt(process.env.OBSERVE_DURATION_HOUR || '24', 10) || 0) * 60 * 60 * 1000;

function getBackupDir(): string {
  const cfg = (config as Record<string, unknown>).backup as
    | { localPath?: string }
    | undefined;
  const localPath = cfg?.localPath;
  if (!localPath) {
    return process.env.DOCKER_CONTAINER
      ? '/mcpserver-backups'
      : path.resolve(process.cwd(), '../mcpserver-backups');
  }
  return path.isAbsolute(localPath) ? localPath : path.resolve(process.cwd(), localPath);
}

interface SampleResult {
  timestamp: string;
  orphanCount: number;
  zipCount: number;
  last24h: number;
  totalSizeMB: string;
}

function sample(): SampleResult {
  const backupDir = getBackupDir();
  let orphanCount = 0;
  let zipCount = 0;
  let totalSizeBytes = 0;
  let last24h = 0;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir);
    for (const f of files) {
      const fullPath = path.join(backupDir, f);
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) continue;

      if (
        f.endsWith('.partial') ||
        (f.endsWith('.zip') && stats.size === 0) ||
        (!f.includes('.') && f !== 'backup.lock')
      ) {
        orphanCount++;
      } else if (f.startsWith('mcpserver_backup_') && f.endsWith('.zip') && stats.size > 0) {
        zipCount++;
        totalSizeBytes += stats.size;
        const created = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs;
        if (created >= oneDayAgo) last24h++;
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    orphanCount,
    zipCount,
    last24h,
    totalSizeMB: (totalSizeBytes / (1024 * 1024)).toFixed(2),
  };
}

function main(): void {
  const logDir = path.resolve(process.cwd(), 'logs', 'agent');
  const logPath = path.join(logDir, 'observation-24h.jsonl');
  fs.mkdirSync(logDir, { recursive: true });

  const startTime = Date.now();
  console.error(
    `[observe] Starting 24h observation. Interval: ${INTERVAL_MS / 60000} min. Log: ${logPath}`,
  );

  const tick = (): void => {
    const data = sample();
    fs.appendFileSync(logPath, JSON.stringify(data) + '\n', 'utf8');
    console.error(
      `[observe] ${data.timestamp} orphan=${data.orphanCount} zip=${data.zipCount} last24h=${data.last24h}`,
    );
    if (data.orphanCount > 0) {
      console.error(`[observe] WARNING: orphan/partial count > 0`);
    }
    if (DURATION_MS > 0 && Date.now() - startTime >= DURATION_MS) {
      console.error(`[observe] Duration reached. Stopping.`);
      process.exit(0);
    }
  };

  tick();
  const id = setInterval(tick, INTERVAL_MS);
  process.on('SIGINT', () => {
    clearInterval(id);
    console.error('[observe] Stopped.');
    process.exit(0);
  });
}

main();
