/**
 * hakanmcp doctor — Extended system health check (plan.md §13)
 * Backup hijyeni, frekans, Ollama kill-switch, MCP build, Cursor CLI (plan §3d).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { config, validateConfig, validateEnvironmentConfig } from '../src/config.js';
import { backupService } from '../src/services/backupService.js';

function maskSensitiveErrors(errors: string[]): string[] {
  return errors.map((err) =>
    err.replace(
      /([A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*)=([^\s|]+)/gi,
      '$1=***',
    ),
  );
}

function fmt(label: string, ok: boolean, detail?: string): string {
  return `${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`;
}

function getBackupDir(): string {
  const cfg = config.backup;
  const localPath = cfg?.localPath;
  if (!localPath) {
    return process.env.DOCKER_CONTAINER
      ? '/mcpserver-backups'
      : path.resolve(process.cwd(), '../mcpserver-backups');
  }
  return path.isAbsolute(localPath) ? localPath : path.resolve(process.cwd(), localPath);
}

function checkBackupHygiene(): { ok: boolean; detail: string } {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    return { ok: true, detail: 'dir not created yet' };
  }
  const files = fs.readdirSync(backupDir);
  const orphans = files.filter((f) => {
    const fullPath = path.join(backupDir, f);
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) return false;
    if (f.endsWith('.partial')) return true;
    if (f.endsWith('.zip') && stats.size === 0) return true;
    if (!f.includes('.') && f !== 'backup.lock') return true;
    return false;
  });
  const orphanCount = orphans.length;
  return {
    ok: orphanCount === 0,
    detail: orphanCount === 0 ? '0 orphan/partial' : `${orphanCount} orphan/partial`,
  };
}

function checkBackupFrequency(): { ok: boolean; detail: string } {
  const stats = backupService.getStats();
  const backups = backupService.listBackups();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = backups.filter((b) => b.created >= oneDayAgo).length;
  const intervalHours = stats.intervalHours;
  if (!config.backup?.enabled || intervalHours <= 0) {
    return { ok: true, detail: 'backup disabled' };
  }
  const expectedMin = Math.floor(24 / intervalHours) - 2;
  const expectedMax = Math.ceil(24 / intervalHours) + 3;
  const ok = last24h >= expectedMin || backups.length === 0;
  return {
    ok,
    detail:
      backups.length === 0
        ? `no backups yet`
        : `last 24h: ${last24h} (expected ~${expectedMin}-${expectedMax})`,
  };
}

function checkOllamaKillSwitch(): { ok: boolean; detail: string } {
  const disabled =
    !(config.aiProviders?.localModels) || process.env.DISABLE_LOCAL_MODELS === '1';
  return {
    ok: true,
    detail: disabled ? 'Ollama disabled (kill-switch active)' : 'Ollama allowed',
  };
}

function checkMcpBuild(): { ok: boolean; detail: string } {
  const indexPath = path.resolve(process.cwd(), 'dist', 'src', 'index.js');
  const exists = fs.existsSync(indexPath);
  return {
    ok: exists,
    detail: exists ? 'dist/src/index.js ready' : 'run npm run build',
  };
}

/** Plan §3d: Is Cursor CLI installed? (for agent -p chat integration) */
function checkCursorCli(): { ok: boolean; detail: string } {
  try {
    execSync('agent --version', { stdio: 'pipe', timeout: 3000 });
    return { ok: true, detail: 'agent CLI ready (chat provider)' };
  } catch {
    try {
      execSync('agent --help', { stdio: 'pipe', timeout: 3000 });
      return { ok: true, detail: 'agent CLI ready (chat provider)' };
    } catch {
      return { ok: true, detail: 'agent not in PATH (optional for /provider cursor)' };
    }
  }
}

function main(): void {
  const configErrors = validateConfig(config, { strict: false });
  const envErrors = maskSensitiveErrors(validateEnvironmentConfig(config, { strict: false }));

  const peerPath = config.monitoring?.peerInstance;
  const peerExists = peerPath ? fs.existsSync(peerPath) : false;
  const peerDetail = !config.monitoring?.enabled
    ? 'disabled'
    : !peerPath
      ? 'not configured'
      : peerExists
        ? `ok (${peerPath})`
        : `missing (${peerPath})`;

  const hygiene = checkBackupHygiene();
  const freq = checkBackupFrequency();
  const ollama = checkOllamaKillSwitch();
  const mcp = checkMcpBuild();
  const cursorCli = checkCursorCli();

  const items = [
    fmt('config.yaml', configErrors.length === 0, configErrors.join(' | ') || undefined),
    fmt('.env / secrets', envErrors.length === 0, envErrors.join(' | ') || undefined),
    fmt('monitoring', config.monitoring?.enabled !== false, peerDetail),
    fmt(
      'scheduler',
      config.scheduler?.enabled !== false,
      config.scheduler?.enabled === false ? 'disabled' : 'enabled',
    ),
    fmt('backup hygiene', hygiene.ok, hygiene.detail),
    fmt('backup frequency (24h)', freq.ok, freq.detail),
    fmt('Ollama kill-switch', ollama.ok, ollama.detail),
    fmt('MCP build', mcp.ok, mcp.detail),
    fmt('Cursor CLI (agent)', cursorCli.ok, cursorCli.detail),
  ];

  console.log('=== hakanmcp doctor ===');
  items.forEach((line) => console.log(line));

  const failCount = items.filter((l) => l.startsWith('✗')).length;
  if (configErrors.length > 0 || envErrors.length > 0 || failCount > 0) {
    process.exitCode = 1;
  }
}

main();
