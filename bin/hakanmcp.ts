#!/usr/bin/env node
/**
 * hakanmcp — Premium CLI for hakan-mcp.
 * Modern, animated, gradient-powered terminal UI.
 */

import path from 'node:path';
import fs from 'node:fs';
import { exec, execSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import gradient from 'gradient-string';
import chalkAnimation from 'chalk-animation';
import type { ChatMessage } from '../src/tools/aiProviders.js';
import { getEffectiveCharacter, getCharacterProfile } from '../src/utils/characterProfile.js';
import { runInit } from '../src/cli/initCommand.js';
import { runStart } from '../src/cli/startCommand.js';
import { runStop } from '../src/cli/stopCommand.js';
import { runMission } from '../src/cli/missionCommand.js';
import { runReport } from '../src/cli/reportCommand.js';
import { runWatch } from '../src/cli/watchCommand.js';
import { runScheduled } from '../src/cli/scheduledCommand.js';
import { runReactive } from '../src/cli/reactiveCommand.js';

process.env.HAKANMCP_CLI = '1';

// ─── Process-level error handlers (graceful shutdown on unexpected errors) ────
process.on('uncaughtException', (err: Error) => {
  console.error(chalk.red('Fatal error:'), err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error(chalk.red('Unhandled promise rejection:'), reason);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Theme ────────────────────────────────────────────────────────
const THEME = {
  gradient: gradient(['#6C5CE7', '#a29bfe']),
  gradientCelebration: gradient(['#00D68F', '#6C5CE7']),
  gradientAlert: gradient(['#FF6B6B', '#FDCB6E']),
  primary: '#6C5CE7',
  secondary: '#a29bfe',
  success: '#00D68F',
  error: '#FF6B6B',
  warning: '#FDCB6E',
  textPrimary: '#F1F2F6',
  textMuted: '#8395A7',
  textDim: '#576574',
  textSubheading: '#DFE6E9',
  border: 'magenta' as const,
};

/** Spinner with frames colored to match THEME.primary exactly */
const THEMED_SPINNER = {
  interval: 80,
  frames: ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'].map(f => chalk.hex(THEME.primary)(f)),
};

const LOGO = `
  ██   ██  █████  ██   ██  █████  ███    ██
  ██   ██ ██   ██ ██  ██  ██   ██ ████   ██
  ███████ ███████ █████   ███████ ██ ██  ██
  ██   ██ ██   ██ ██  ██  ██   ██ ██  ██ ██
  ██   ██ ██   ██ ██   ██ ██   ██ ██   ████`;

const LOGO_SUB = `                   ✦  M C P  ✦`;

// ─── Helpers ──────────────────────────────────────────────────────
function findProjectRoot(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '..');
}
const PROJECT_ROOT = findProjectRoot(__dirname);

// ─── Tool Manifest (build-time generated) ────────────────────────
interface ToolManifestEntry { name: string; description?: string }
interface ToolManifestModule { module: string; tools: ToolManifestEntry[]; error?: string }
interface ToolManifest {
  generatedAt: string;
  totalTools: number;
  totalModules: number;
  failedModules: number;
  modules: ToolManifestModule[];
}

function loadToolManifest(): ToolManifest | null {
  const manifestPath = path.join(PROJECT_ROOT, 'dist', 'tool-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ToolManifest;
  } catch {
    return null;
  }
}

function clearScreen(): void {
  if (process.stdout.isTTY && process.env.HAKANMCP_QUIET !== '1' && !isEmbedOutput()) {
    process.stdout.write('\x1bc');
  }
}

function getAppVersion(): string {
  try {
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version || '0.0.0';
    }
  } catch {
    /* ignore */
  }
  return '0.0.0';
}

interface StartupHealthResult {
  status: 'ready' | 'update' | 'issues' | 'update-issues' | 'check-failed';
  issues: string[];
  latestVersion?: string;
  localVersion: string;
}

async function fetchLatestGitHubVersion(timeoutMs = 3000): Promise<string | null> {
  const https = await import('node:https');
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/sudohakan/HakanMCP/releases/latest',
      headers: { 'User-Agent': 'HakanMCP-CLI' },
      timeout: timeoutMs,
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const tag = json.tag_name;
          resolve(tag ? tag.replace(/^v/, '') : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function checkStartupHealth(): Promise<StartupHealthResult> {
  const localVersion = getAppVersion();
  const issues: string[] = [];
  let latestVersion: string | undefined;
  let checkFailed = false;

  // 1. Version check (GitHub Releases API)
  try {
    const remote = await fetchLatestGitHubVersion();
    if (remote) {
      const semverMod = await import('semver');
      if (semverMod.default.gt(remote, localVersion)) {
        latestVersion = remote;
      }
    } else {
      checkFailed = true;
    }
  } catch {
    checkFailed = true;
  }

  // 2. Build check
  const distIndex = path.join(PROJECT_ROOT, 'dist', 'src', 'index.js');
  if (!fs.existsSync(distIndex)) {
    issues.push('Build missing (run npm run build)');
  } else {
    const distStat = fs.statSync(distIndex);
    try {
      const srcDir = path.join(PROJECT_ROOT, 'src');
      let srcNewer = false;
      const checkDir = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) checkDir(full);
          else if (entry.name.endsWith('.ts') && fs.statSync(full).mtimeMs > distStat.mtimeMs) {
            srcNewer = true;
          }
        }
      };
      checkDir(srcDir);
      if (srcNewer) issues.push('Build outdated (src newer than dist)');
    } catch { /* ignore */ }
  }

  // 3. Node.js version check
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split('.')[0], 10);
  if (major < 20) {
    issues.push(`Node.js ${nodeVer} (requires >= 20)`);
  }

  // 4. Config check
  const cfgPath = path.join(PROJECT_ROOT, 'config.yaml');
  if (fs.existsSync(cfgPath)) {
    try {
      const yamlMod = await import('js-yaml');
      yamlMod.default.load(fs.readFileSync(cfgPath, 'utf8'));
    } catch {
      issues.push('config.yaml parse error');
    }
  }

  const hasUpdate = !!latestVersion;
  const hasIssues = issues.length > 0;

  let status: StartupHealthResult['status'];
  if (hasUpdate && hasIssues) status = 'update-issues';
  else if (hasUpdate) status = 'update';
  else if (hasIssues) status = 'issues';
  else if (checkFailed) status = 'check-failed';
  else status = 'ready';

  return { status, issues, latestVersion, localVersion };
}

// ─── Animated Intro ───────────────────────────────────────────────
function playAnimatedIntro(): Promise<void> {
  return new Promise((resolve) => {
    const fullLogo = LOGO + '\n' + LOGO_SUB;
    const anim = chalkAnimation.neon(fullLogo, 1.5);
    setTimeout(() => {
      anim.stop();
      resolve();
    }, 900);
  });
}

// ─── Gradient Logo (static) ──────────────────────────────────────
function renderGradientLogo(): string {
  const logoLines = LOGO.split('\n');
  const gradientLogo = THEME.gradient.multiline(logoLines.join('\n'));
  const sub = THEME.gradient(LOGO_SUB);
  return gradientLogo + '\n' + sub;
}

// ─── Pill Menu (4 rows × 5 columns — same column = same color)
const PILL_COL_WIDTHS = [10, 10, 10, 10, 10]; // fixed width per column for icon alignment
const PILL_COL_COLORS = ['#6C5CE7', '#00D68F', '#FDCB6E', '#FF6B6B', '#a29bfe'];
function renderPillMenu(): string {
  const rows = [
    ['doctor',    'status',    'backup',    'journal',   'providers'],
    ['ralph',     'logs',      'config',    'tools',     'help'],
    ['init',      'start',     'stop',      'mission',   'report'],
    ['watch',     'scheduled', 'reactive',  'clear',     'exit'],
  ];
  const fmt = (label: string, colIdx: number) => {
    const color = chalk.hex(PILL_COL_COLORS[colIdx]);
    return `${color('◆')} ${chalk.hex('#F1F2F6')(label.padEnd(PILL_COL_WIDTHS[colIdx]))}`;
  };
  return rows.map((row) => '  ' + row.map((label, i) => fmt(label, i)).join('  ')).join('\n');
}

// ─── Status Bar ───────────────────────────────────────────────────
function renderStatusBar(health?: StartupHealthResult): string {
  const version = getAppVersion();

  if (!health) {
    const checking = chalk.hex(THEME.textMuted)('●') + ' ' + chalk.hex(THEME.textMuted)('Checking...');
    const ver = chalk.hex(THEME.textMuted)(`v${version}`);
    const pad = ' '.repeat(Math.max(2, 50 - 14 - version.length));
    return `  ${checking}${pad}${ver}`;
  }

  let label: string;
  let color: string;
  let verStr: string;

  switch (health.status) {
    case 'ready':
      label = 'Ready';
      color = THEME.success;
      verStr = `v${version}`;
      break;
    case 'update':
      label = 'Update available';
      color = THEME.warning;
      verStr = `v${version} → v${health.latestVersion}`;
      break;
    case 'issues':
      label = `${health.issues.length} issue(s) detected`;
      color = THEME.error;
      verStr = `v${version}`;
      break;
    case 'update-issues':
      label = `Update available · ${health.issues.length} issue(s)`;
      color = THEME.error;
      verStr = `v${version} → v${health.latestVersion}`;
      break;
    case 'check-failed':
      label = 'Ready (version check failed)';
      color = THEME.textMuted;
      verStr = `v${version}`;
      break;
  }

  const dot = chalk.hex(color)('●');
  const text = chalk.hex(color)(label);
  const ver = chalk.hex(THEME.textMuted)(verStr);
  const usedLen = label.length + 2 + verStr.length;
  const pad = ' '.repeat(Math.max(2, 55 - usedLen));
  let line = `  ${dot} ${text}${pad}${ver}`;

  // Hint line for actionable states
  if (health.status === 'update' || health.status === 'update-issues') {
    line += `\n  ${chalk.hex(THEME.textDim)('run /doctor fix to update')}`;
  } else if (health.status === 'issues') {
    line += `\n  ${chalk.hex(THEME.textDim)('run /doctor fix to repair')}`;
  }

  return line;
}

// ─── Divider ──────────────────────────────────────────────────────
function renderDivider(width = 60): string {
  return chalk.hex(THEME.textDim)('─'.repeat(width));
}

// Icon color map for text-based menus (matches pill menu)
const MENU_COLORS: Record<string, string> = {
  doctor: THEME.primary,
  ralph: THEME.primary,
  status: THEME.success,
  logs: THEME.success,
  backup: '#FDCB6E',
  config: '#FDCB6E',
  journal: '#FF6B6B',
  tools: '#FF6B6B',
  providers: '#a29bfe',
  help: '#a29bfe',
  // Mission Agent — colors match pill columns
  init: THEME.primary,
  start: THEME.success,
  stop: '#FDCB6E',
  mission: '#FF6B6B',
  report: '#a29bfe',
  watch: THEME.primary,
  scheduled: THEME.success,
  reactive: '#FDCB6E',
};

const isEmbedOutput = (): boolean => process.env.HAKANMCP_EMBED === '1';

const isSimpleOutput = (): boolean =>
  process.env.HAKANMCP_QUIET === '1' || process.env.HAKANMCP_SIMPLE === '1';

// ─── Simple text menu (no logo; for /providers, /doctor etc from console chat)
function renderTextMenuSimple(
  taglineTitle: string,
  content: string,
  hint?: string,
  cmdKey?: string,
): string {
  const divider = chalk.hex(THEME.textDim)('─'.repeat(58));
  const titleColor = cmdKey ? (MENU_COLORS[cmdKey] ?? THEME.primary) : THEME.primary;
  let block = `\n${divider}\n`;
  block += chalk.hex(titleColor)(`  ${taglineTitle}`) + '\n\n';
  block += `${content}\n`;
  if (hint) block += `\n  ${chalk.hex(THEME.textMuted).italic(hint)}\n`;
  block += `\n${divider}\n`;
  return block;
}

// ─── Text-based menu (no boxen; used for doctor, status, backup, etc.)
function renderTextMenu(
  taglineTitle: string,
  content: string,
  hint?: string,
  cmdKey?: string,
): string {
  if (isSimpleOutput() && !isEmbedOutput()) return renderTextMenuSimple(taglineTitle, content, hint, cmdKey);
  const divider = renderDivider();
  const titleColor = cmdKey ? (MENU_COLORS[cmdKey] ?? THEME.primary) : THEME.primary;

  let block: string;
  if (isEmbedOutput()) {
    // Chat mode: no banner/pills — just divider + content
    block = `\n${divider}\n`;
    if (content) {
      block += chalk.hex(titleColor)(`  ${taglineTitle}`) + '\n\n';
      block += `${content}\n`;
    }
    if (hint) block += '\n' + hint.split('\n').map((l) => `  ${chalk.hex(THEME.textMuted).italic(l)}`).join('\n') + '\n';
    block += `\n${divider}\n`;
  } else {
    // CLI mode: full banner
    clearScreen();
    const logo = renderGradientLogo();
    const pills = renderPillMenu();
    const statusBar = renderStatusBar();
    block = `\n${logo}\n\n${statusBar}\n${divider}\n\n${pills}\n`;
    if (content) {
      block += `\n${divider}\n`;
      block += chalk.hex(titleColor)(`  ${taglineTitle}`) + '\n\n';
      block += `${content}\n`;
    }
    if (hint) block += '\n' + hint.split('\n').map((l) => `  ${chalk.hex(THEME.textMuted).italic(l)}`).join('\n') + '\n';
    const defaultHint = 'Type a message or /help for commands  ·  Ctrl+C to exit';
    block += `\n${divider}\n  ${chalk.hex(THEME.textMuted)(defaultHint)}\n`;
  }
  return block;
}

// ─── Unified Screen (chat mode only; uses boxen for main screen)
function renderUnifiedScreen(taglineTitle: string, content?: string, customHint?: string, health?: StartupHealthResult): string {
  clearScreen();
  const logo = renderGradientLogo();
  const pills = renderPillMenu();
  const statusBar = renderStatusBar(health);
  const divider = renderDivider();

  let block = `\n${logo}\n\n${statusBar}\n${divider}\n\n${pills}\n`;

  if (content) {
    block += `\n${divider}\n`;
    block += `  ${THEME.gradient(taglineTitle)}\n\n`;
    block += `${content}\n`;
  }

  if (customHint) {
    block += `\n  ${chalk.hex(THEME.textMuted).italic(customHint)}\n`;
  }

  const defaultHint = 'Type a message or /help for commands  ·  Ctrl+C to exit';
  block += `\n${divider}\n  ${chalk.hex(THEME.textMuted)(defaultHint)}\n`;

  return boxen(block, {
    padding: { top: 0, bottom: 0, left: 2, right: 2 },
    margin: { top: 1, bottom: 1, left: 1, right: 1 },
    borderColor: THEME.border,
    borderStyle: 'round',
    backgroundColor: '#0a0a0a',
  });
}

// ─── List Box → Text menu for CLI commands (no boxen)
function renderListBox(title: string, content: string, hint?: string, cmdKey?: string): string {
  const cleanTitle = title.replace(/Hakan MCP\s*/gi, '').trim() || title;
  return renderTextMenu(cleanTitle, content, hint, cmdKey);
}

// ─── Capture stdout ──────────────────────────────────────────────
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ..._rest: unknown[]) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }
  // Strip ANSI codes for clean re-rendering inside boxen
  return chunks.join('');
}

// ─── Chat Header (animated) ──────────────────────────────────────
async function renderChatHeaderAnimated(): Promise<void> {
  clearScreen();
  await playAnimatedIntro();

  // Show initial screen with "Checking..." status
  clearScreen();
  console.log(renderUnifiedScreen('Chat'));

  // Run health checks, re-render with final status
  try {
    const health = await checkStartupHealth();
    clearScreen();
    console.log(renderUnifiedScreen('Chat', undefined, undefined, health));
  } catch {
    clearScreen();
    console.log(renderUnifiedScreen('Chat', undefined, undefined, {
      status: 'check-failed', issues: [], localVersion: getAppVersion()
    }));
  }
  console.log();
}

// ─── Dotenv ───────────────────────────────────────────────────────
async function loadDotenv(): Promise<void> {
  const dotenvPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(dotenvPath)) {
    try {
      const dotenv = await import('dotenv');
      dotenv.default.config({ path: dotenvPath, override: true, quiet: true });
    } catch {
      /* ignore */
    }
  }
}

function ensureProjectRoot(): void {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(
      boxen(chalk.red('Error: Cannot find hakan-mcp project root at ' + PROJECT_ROOT), {
        padding: 1,
        borderColor: 'red',
      }),
    );
    process.exit(1);
  }
  process.chdir(PROJECT_ROOT);
}

function requireBuild(scriptName: string): string {
  const scriptPath = path.join(PROJECT_ROOT, 'dist', 'scripts', scriptName);
  if (!fs.existsSync(scriptPath)) {
    console.error(
      renderUnifiedScreen(
        'Build Error',
        `  ${chalk.hex(THEME.error)(`✗ ${scriptName} not found. Run "npm run build" first.`)}`,
      ),
    );
    process.exit(1);
  }
  return scriptPath;
}

// ─── Commands ─────────────────────────────────────────────────────
async function runTools(): Promise<void> {
  const manifest = loadToolManifest();
  if (!manifest) {
    console.log(
      renderTextMenu(
        'Tools Error',
        `  ${chalk.hex(THEME.error)('✗')} ${chalk.red('tool-manifest.json not found.')}\n  Run "npm run build" to generate it.`,
        undefined,
        'tools',
      ),
    );
    process.exit(1);
  }

  const allTools = manifest.modules.flatMap((m) => m.tools);
  let body = `  ${chalk.hex(THEME.primary).bold(`${allTools.length} tools registered`)}\n\n`;

  // Group by prefix (part before first underscore)
  const groups = new Map<string, typeof allTools>();
  for (const t of allTools) {
    const prefix = t.name.includes('_') ? t.name.split('_')[0] : 'other';
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(t);
  }

  for (const [prefix, tools] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    body += `  ${chalk.hex(THEME.primary).bold(prefix)} ${chalk.hex(THEME.textMuted)(`(${tools.length})`)}\n`;
    for (const t of tools) {
      const desc = t.description ? chalk.hex(THEME.textMuted)(` — ${t.description.substring(0, 60)}`) : '';
      body += `    ${chalk.hex('#F1F2F6')(t.name)}${desc}\n`;
    }
    body += '\n';
  }

  if (manifest.failedModules > 0) {
    const failed = manifest.modules.filter((m) => m.error);
    body += `  ${chalk.hex(THEME.warning)('⚠')} ${chalk.hex(THEME.warning)(`${failed.length} module(s) failed at build time: ${failed.map((m) => m.module).join(', ')}`)}\n`;
  }

  console.log(renderTextMenu('Tools', body.trimEnd(), undefined, 'tools'));
}

// ─── Scheduled Tasks Dashboard & Management ──────────────────────────────────
async function runScheduledDashboard(): Promise<void> {
  const { schedulerManager } = await import('../src/tools/scheduler.js');
  const stats = schedulerManager.getStats();
  const tasks = schedulerManager.listTasks();
  const cwd = process.cwd();

  let body = '';

  // ── Workspace Schedule ──────────────────────────────────────────
  body += `  ${chalk.hex(THEME.primary).bold('Workspace Schedule')}\n`;
  const wsConfigPath = path.join(cwd, 'hakanmcp.config.yaml');
  if (fs.existsSync(wsConfigPath)) {
    try {
      const yaml = await import('js-yaml');
      const wsRaw = yaml.default.load(fs.readFileSync(wsConfigPath, 'utf8')) as Record<string, unknown> | null;
      const sched = (wsRaw as Record<string, unknown>)?.schedule as Record<string, unknown> | undefined;
      const enabled = sched?.enabled ?? false;
      const cronVal = sched?.cron ?? '—';
      const intervalVal = sched?.interval ?? '—';
      const statusIcon = enabled ? chalk.hex(THEME.success)('●') : chalk.hex(THEME.textDim)('○');
      const statusText = enabled ? chalk.hex(THEME.success)('enabled') : chalk.hex(THEME.textMuted)('disabled');
      body += `  ${statusIcon} ${chalk.hex('#F1F2F6')('Status:')} ${statusText}`;
      body += `  ${chalk.hex('#F1F2F6')('Cron:')} ${chalk.hex(THEME.textMuted)(String(cronVal))}`;
      body += `  ${chalk.hex('#F1F2F6')('Interval:')} ${chalk.hex(THEME.textMuted)(String(intervalVal))}\n`;
      body += `  ${chalk.hex(THEME.textDim)(`Workspace: ${cwd}`)}\n`;
    } catch {
      body += `  ${chalk.hex(THEME.warning)('⚠')} ${chalk.hex(THEME.error)('Config parse error')}\n`;
    }
  } else {
    body += `  ${chalk.hex(THEME.textDim)('○')} ${chalk.hex(THEME.textMuted)('Not configured — run')} ${chalk.hex('#F1F2F6')('hakanmcp init')} ${chalk.hex(THEME.textMuted)('to create workspace config')}\n`;
    body += `  ${chalk.hex(THEME.textDim)(`Workspace: ${cwd}`)}\n`;
  }

  // ── Scheduler Manager Tasks ─────────────────────────────────────
  body += `\n  ${chalk.hex(THEME.primary).bold('Scheduler Tasks')}\n`;
  body += `  ${chalk.hex('#F1F2F6')('Tasks:')} ${chalk.hex(stats.totalTasks > 0 ? THEME.success : THEME.textMuted)(`${stats.enabledTasks} active`)}`;
  if (stats.disabledTasks > 0) body += ` ${chalk.hex(THEME.textMuted)(`/ ${stats.disabledTasks} paused`)}`;
  body += `  ${chalk.hex('#F1F2F6')('Runs:')} ${chalk.hex(THEME.success)(String(stats.successfulExecutions))} ok`;
  if (stats.failedExecutions > 0) body += ` / ${chalk.hex(THEME.error)(String(stats.failedExecutions))} fail`;
  body += `  ${chalk.hex('#F1F2F6')('Total:')} ${chalk.hex(THEME.textMuted)(String(stats.totalExecutions))}\n`;

  if (tasks.length === 0) {
    body += `  ${chalk.hex(THEME.textMuted)('No scheduler tasks yet.')}\n`;
  } else {
    for (const t of tasks) {
      const icon = t.enabled ? chalk.hex(THEME.success)('●') : chalk.hex(THEME.textDim)('○');
      const name = chalk.hex('#F1F2F6')(t.name.padEnd(20));
      const sched = chalk.hex(THEME.textMuted)(t.schedule.padEnd(18));
      const runs = chalk.hex(THEME.textMuted)(`${t.runCount} runs`);
      const lastRun = t.lastRun ? chalk.hex(THEME.textMuted)(new Date(t.lastRun).toLocaleString()) : chalk.hex(THEME.textDim)('never');
      body += `  ${icon} ${name} ${sched} ${runs}  ${lastRun}\n`;
      body += `    ${chalk.hex(THEME.textDim)(`ID: ${t.id}`)}\n`;
    }
  }

  const hint = [
    'scheduled start                     Start workspace scheduled mode',
    'scheduled add <name> <cron> <task>  Add scheduler task',
    'scheduled remove <id>               Remove a scheduler task',
    'scheduled pause <id> / resume <id>  Pause or resume a scheduler task',
  ].join('\n');

  console.log(renderTextMenu('Scheduled', body, hint, 'scheduled'));
}

async function runScheduledAdd(name: string, cronExpr: string, agentTask: string): Promise<void> {
  try {
    const { schedulerManager } = await import('../src/tools/scheduler.js');
    const task = schedulerManager.createTask({ name, schedule: cronExpr, agentTask, enabled: true });
    let body = `  ${chalk.hex(THEME.success)('✓')} ${chalk.hex('#F1F2F6')('Task created')}\n`;
    body += `    ${chalk.hex(THEME.textMuted)(`Name: ${task.name}  Schedule: ${task.schedule}`)}\n`;
    body += `    ${chalk.hex(THEME.textDim)(`ID: ${task.id}`)}\n`;
    console.log(renderTextMenu('Scheduled Tasks', body, 'scheduled                           Back to dashboard', 'scheduled'));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    let body = `  ${chalk.hex(THEME.error)('✗')} ${chalk.hex('#F1F2F6')('Failed to create task')}\n`;
    body += `    ${chalk.hex(THEME.textMuted)(msg)}\n`;
    console.log(renderTextMenu('Scheduled Tasks', body, undefined, 'scheduled'));
  }
}

async function runScheduledRemove(id: string): Promise<void> {
  const { schedulerManager } = await import('../src/tools/scheduler.js');
  const ok = schedulerManager.deleteTask(id);
  let body: string;
  if (ok) {
    body = `  ${chalk.hex(THEME.success)('✓')} ${chalk.hex('#F1F2F6')('Task removed')}  ${chalk.hex(THEME.textDim)(id)}\n`;
  } else {
    body = `  ${chalk.hex(THEME.error)('✗')} ${chalk.hex('#F1F2F6')('Task not found')}  ${chalk.hex(THEME.textDim)(id)}\n`;
  }
  console.log(renderTextMenu('Scheduled Tasks', body, 'scheduled                           Back to dashboard', 'scheduled'));
}

async function runScheduledToggle(id: string, enable: boolean): Promise<void> {
  try {
    const { schedulerManager } = await import('../src/tools/scheduler.js');
    const task = schedulerManager.updateTask(id, { enabled: enable });
    const verb = enable ? 'resumed' : 'paused';
    const icon = enable ? chalk.hex(THEME.success)('✓') : chalk.hex(THEME.warning)('⏸');
    let body = `  ${icon} ${chalk.hex('#F1F2F6')(`Task ${verb}:`)} ${chalk.hex(THEME.textMuted)(task.name)}  ${chalk.hex(THEME.textDim)(id)}\n`;
    console.log(renderTextMenu('Scheduled Tasks', body, 'scheduled                           Back to dashboard', 'scheduled'));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    let body = `  ${chalk.hex(THEME.error)('✗')} ${chalk.hex('#F1F2F6')(msg)}\n`;
    console.log(renderTextMenu('Scheduled Tasks', body, undefined, 'scheduled'));
  }
}

async function runDoctor(fix = false): Promise<void> {
  interface DoctorCheck {
    label: string;
    status: 'ok' | 'warn' | 'fail';
    detail: string;
    repairAction?: { description: string; fn: () => Promise<void> | void };
  }

  const icons = {
    ok: chalk.hex(THEME.success)('✓'),
    warn: chalk.hex(THEME.warning)('⚠'),
    fail: chalk.hex(THEME.error)('✗'),
    repair: chalk.hex('#6C5CE7')('🔧'),
  };

  function formatCheck(c: DoctorCheck): string {
    return `  ${icons[c.status]} ${chalk.hex('#F1F2F6')(c.label.padEnd(20))} ${chalk.hex(THEME.textMuted)(c.detail)}`;
  }

  function getNewestMtime(dir: string, ext: string): number {
    let newest = 0;
    try {
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
          else if (entry.isFile() && entry.name.endsWith(ext)) {
            const mt = fs.statSync(full).mtimeMs;
            if (mt > newest) newest = mt;
          }
        }
      };
      walk(dir);
    } catch { /* ignore */ }
    return newest;
  }

  const checks: DoctorCheck[] = [];
  let body = '';

  // ── 1. package.json ──────────────────────────────────────────────
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const localVer = pkg.version || '0.0.0';
    let versionDetail = `v${localVer}`;
    try {
      const remote = await fetchLatestGitHubVersion();
      if (remote && remote !== localVer) {
        const semverMod = await import('semver');
        if (semverMod.default.gt(remote, localVer)) {
          versionDetail += ` (latest: v${remote} — update available)`;
          checks.push({ label: 'package.json', status: 'warn', detail: versionDetail });
        } else {
          checks.push({ label: 'package.json', status: 'ok', detail: versionDetail });
        }
      } else {
        checks.push({ label: 'package.json', status: 'ok', detail: versionDetail });
      }
    } catch {
      versionDetail += ' (version check failed)';
      checks.push({ label: 'package.json', status: 'ok', detail: versionDetail });
    }
  } else {
    checks.push({ label: 'package.json', status: 'fail', detail: 'Not found' });
  }

  // ── 2. config.yaml ──────────────────────────────────────────────
  const cfgPath = path.join(PROJECT_ROOT, 'config.yaml');
  if (fs.existsSync(cfgPath)) {
    try {
      const { validateConfig: valCfg, config: loadedCfg } = await import('../src/config.js');
      const errors: string[] = valCfg(loadedCfg, { strict: false, warnOnly: true });
      if (errors.length === 0) {
        checks.push({ label: 'config.yaml', status: 'ok', detail: 'Valid' });
      } else {
        checks.push({ label: 'config.yaml', status: 'warn', detail: `${errors.length} issue(s): ${errors[0]}` });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : 'Validation error';
      checks.push({ label: 'config.yaml', status: 'warn', detail: msg });
    }
  } else {
    checks.push({
      label: 'config.yaml',
      status: 'warn',
      detail: 'Missing',
      repairAction: {
        description: 'Created default config.yaml',
        fn: () => { fs.writeFileSync(cfgPath, 'serverName: hakan-mcp\n', 'utf8'); },
      },
    });
  }

  // ── 3. Build (dist/) ────────────────────────────────────────────
  const distIndex = path.join(PROJECT_ROOT, 'dist', 'src', 'index.js');
  if (!fs.existsSync(distIndex)) {
    checks.push({
      label: 'Build (dist/)',
      status: 'fail',
      detail: 'Not built',
      repairAction: {
        description: 'Building project...',
        fn: () => { execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 120_000 }); },
      },
    });
  } else {
    // Check all TypeScript source directories against dist
    const srcDirs = ['src', 'scripts', 'bin'].map((d) => path.join(PROJECT_ROOT, d));
    const newestSrc = Math.max(...srcDirs.map((d) => getNewestMtime(d, '.ts')));
    const distMtime = fs.statSync(distIndex).mtimeMs;
    if (newestSrc > distMtime) {
      const staleDirs = srcDirs
        .filter((d) => getNewestMtime(d, '.ts') > distMtime)
        .map((d) => path.basename(d));
      checks.push({
        label: 'Build (dist/)',
        status: 'fail',
        detail: `Stale (${staleDirs.join(', ')} newer than dist)`,
        repairAction: {
          description: 'Rebuilding project...',
          fn: () => { execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 120_000 }); },
        },
      });
    } else {
      checks.push({ label: 'Build (dist/)', status: 'ok', detail: 'Up to date' });
    }
  }

  // ── 4. .env ──────────────────────────────────────────────────────
  const envPath = path.join(PROJECT_ROOT, '.env');
  const envExamplePath = path.join(PROJECT_ROOT, '.env.example');
  if (fs.existsSync(envPath)) {
    try {
      const { validateEnvironmentConfig: valEnv, config: loadedCfg } = await import('../src/config.js');
      const envErrors: string[] = valEnv(loadedCfg, { strict: false, warnOnly: true });
      const keyCount = fs.readFileSync(envPath, 'utf8').split('\n')
        .filter((l: string) => l.trim() && !l.trim().startsWith('#') && l.includes('=')).length;
      if (envErrors.length === 0) {
        checks.push({ label: '.env', status: 'ok', detail: `Valid (${keyCount} keys)` });
      } else {
        checks.push({ label: '.env', status: 'warn', detail: `${envErrors.length} issue(s): ${envErrors[0]}` });
      }
    } catch {
      checks.push({ label: '.env', status: 'ok', detail: 'Found' });
    }
  } else if (fs.existsSync(envExamplePath)) {
    checks.push({
      label: '.env',
      status: 'warn',
      detail: 'Missing (.env.example available)',
      repairAction: {
        description: 'Copied .env.example → .env',
        fn: () => { fs.copyFileSync(envExamplePath, envPath); },
      },
    });
  } else {
    checks.push({ label: '.env', status: 'warn', detail: 'Missing (optional)' });
  }

  // ── 5. Node.js ──────────────────────────────────────────────────
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1), 10);
  checks.push({
    label: 'Node.js',
    status: major >= 20 ? 'ok' : 'fail',
    detail: major >= 20 ? nodeVer : `${nodeVer} (requires >= 20)`,
  });

  // ── 6. MCP Tools ────────────────────────────────────────────────
  let manifest = loadToolManifest();
  // Read health report if available
  const healthReportPath = path.join(PROJECT_ROOT, 'logs', 'tool-health.json');
  let healthReport: { checkedAt?: string; totalTools?: number; passed?: number; failed?: number; results?: Array<{ name: string; status: string; error?: string }> } | null = null;
  try {
    if (fs.existsSync(healthReportPath)) {
      healthReport = JSON.parse(fs.readFileSync(healthReportPath, 'utf8'));
    }
  } catch { /* ignore */ }

  if (manifest) {
    const failedModules = manifest.modules.filter((m) => m.error);
    if (healthReport && healthReport.totalTools) {
      // Use health report for detailed status
      const hp = healthReport.passed ?? 0;
      const hf = healthReport.failed ?? 0;
      const total = healthReport.totalTools;
      if (hf === 0 && failedModules.length === 0) {
        checks.push({ label: 'MCP Tools', status: 'ok', detail: `${total} registered, all passed` });
      } else {
        checks.push({
          label: 'MCP Tools',
          status: 'warn',
          detail: `${total} registered, ${hp} passed, ${hf} failed`,
        });
        // Show failed tools
        const failedTools = (healthReport.results ?? []).filter((r) => r.status === 'fail');
        for (const ft of failedTools.slice(0, 5)) {
          checks.push({ label: '  └ Tool', status: 'fail', detail: `${ft.name}: ${ft.error}` });
        }
        if (failedTools.length > 5) {
          checks.push({ label: '  └ ...', status: 'warn', detail: `+${failedTools.length - 5} more failures` });
        }
      }
      // Show failed modules from manifest with repair actions
      for (const fm of failedModules) {
        const pkgMatch = fm.error?.match(/Cannot find package '([^']+)'/);
        checks.push({
          label: '  └ Module',
          status: 'fail',
          detail: `${fm.module}: ${fm.error}`,
          repairAction: pkgMatch ? {
            description: `Installing ${pkgMatch[1]}...`,
            fn: () => { execSync(`npm install ${pkgMatch[1]}`, { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 120_000 }); },
          } : undefined,
        });
      }
    } else {
      // No health report — fallback to manifest-only
      if (failedModules.length === 0) {
        checks.push({ label: 'MCP Tools', status: 'ok', detail: `${manifest.totalTools} registered` });
      } else {
        checks.push({
          label: 'MCP Tools',
          status: manifest.totalTools > 0 ? 'warn' : 'fail',
          detail: `${manifest.totalTools} loaded, ${failedModules.length} module(s) failed`,
        });
        for (const fm of failedModules) {
          const pkgMatch = fm.error?.match(/Cannot find package '([^']+)'/);
          checks.push({
            label: '  └ Module',
            status: 'fail',
            detail: `${fm.module}: ${fm.error}`,
            repairAction: pkgMatch ? {
              description: `Installing ${pkgMatch[1]}...`,
              fn: () => { execSync(`npm install ${pkgMatch[1]}`, { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 120_000 }); },
            } : undefined,
          });
        }
      }
    }
  } else {
    const manifestScript = path.join(PROJECT_ROOT, 'dist', 'scripts', 'generate-tool-manifest.js');
    checks.push({
      label: 'MCP Tools',
      status: 'warn',
      detail: 'Manifest not found',
      repairAction: fs.existsSync(manifestScript)
        ? {
            description: 'Generating tool manifest...',
            fn: () => { execSync(`node "${manifestScript}"`, { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 30_000 }); },
          }
        : undefined,
    });
  }

  // ── 7. Logs directory ───────────────────────────────────────────
  const logsDir = path.join(PROJECT_ROOT, 'logs');
  if (fs.existsSync(logsDir)) {
    // Check writable
    const testFile = path.join(logsDir, `.doctor-write-test-${Date.now()}.tmp`);
    try {
      fs.writeFileSync(testFile, 'test', 'utf8');
      fs.unlinkSync(testFile);
      checks.push({ label: 'Logs directory', status: 'ok', detail: 'Writable' });
    } catch {
      checks.push({ label: 'Logs directory', status: 'fail', detail: 'Not writable' });
    }
  } else {
    checks.push({
      label: 'Logs directory',
      status: 'warn',
      detail: 'Missing',
      repairAction: {
        description: 'Created logs/',
        fn: () => { fs.mkdirSync(logsDir, { recursive: true }); },
      },
    });
  }

  // ── 8. Consciousness ─────────────────────────────────────────────
  const consciousnessDir = path.join(PROJECT_ROOT, 'logs', 'consciousness');
  if (fs.existsSync(consciousnessDir)) {
    const stateFile = path.join(consciousnessDir, 'cognition_state.json');
    const journalFile = path.join(consciousnessDir, 'journal.jsonl');
    const hasState = fs.existsSync(stateFile);
    const journalCount = fs.existsSync(journalFile)
      ? fs.readFileSync(journalFile, 'utf8').trim().split('\n').filter(Boolean).length
      : 0;
    const detail = hasState
      ? `State OK, ${journalCount} journal entries`
      : 'State file missing (will be created on first chat)';
    checks.push({ label: 'Consciousness', status: hasState ? 'ok' : 'warn', detail });
  } else {
    checks.push({
      label: 'Consciousness',
      status: 'warn',
      detail: 'Directory missing',
      repairAction: {
        description: 'Creating logs/consciousness/...',
        fn: () => { fs.mkdirSync(consciousnessDir, { recursive: true }); },
      },
    });
  }

  const repairables = checks.filter((c) => c.repairAction);
  let repairCount = 0;

  if (fix) {
    // ── Fix mode: repair then show final state ─────────────────────
    const issues = checks.filter((c) => c.status !== 'ok');
    if (issues.length === 0) {
      body += `  ${icons.ok} ${chalk.hex(THEME.success)('No issues found. System is healthy.')}\n`;
      console.log(renderTextMenu('Doctor Fix', body, 'doctor                              Run full health check', 'doctor'));
      return;
    }

    let needsRebuild = false;

    // 0) Auto-update if a newer version is available on GitHub
    const updateCheck = checks.find((c) => c.label === 'package.json' && c.status === 'warn');
    if (updateCheck) {
      body += `  ${icons.repair} ${chalk.hex('#6C5CE7')('Updating from GitHub...')}\n`;
      try {
        execSync('git pull origin main', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 30_000 });
        body += `  ${icons.repair} ${chalk.hex('#6C5CE7')('git pull done')}\n`;
        execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 120_000 });
        body += `  ${icons.repair} ${chalk.hex('#6C5CE7')('npm install done')}\n`;
        execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 120_000 });
        body += `  ${icons.repair} ${chalk.hex('#6C5CE7')('npm run build done')}\n`;
        repairCount += 3;
        const newPkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
        body += `  ${icons.ok} ${chalk.hex(THEME.success)(`Updated to v${newPkg.version}`)}\n\n`;
      } catch (updateErr: unknown) {
        const msg = updateErr instanceof Error ? updateErr.message.split('\n')[0] : 'Update failed';
        body += `  ${icons.repair} ${chalk.hex(THEME.error)(`Update failed: ${msg}`)}\n\n`;
      }
    }

    // 1) Run predefined repairActions
    for (const check of repairables) {
      const action = check.repairAction!;
      try {
        await action.fn();
        repairCount++;
        if (action.description.toLowerCase().includes('install')) needsRebuild = true;
        body += `  ${icons.repair} ${chalk.hex('#6C5CE7')(action.description.replace(/\.\.\.?$/, '') + ' done')}\n`;
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message.split('\n')[0] : 'Unknown error';
        body += `  ${icons.repair} ${chalk.hex(THEME.error)(`${action.description} — failed: ${errMsg}`)}\n`;
      }
    }

    // 2) AI-assisted repair for ALL remaining issues (including sub-items and failed predefined repairs)
    const stillBroken = checks.filter((c) => c.status !== 'ok');
    if (stillBroken.length > 0) {
      body += `\n  ${icons.repair} ${chalk.hex('#6C5CE7')('Consulting AI for remaining issues...')}\n`;
      try {
        const issueList = stillBroken.map((c) => `${c.label.trim()}: ${c.detail}`).join('\n');
        const prompt = `You are HakanMCP's self-repair system running on Windows (Node.js ${process.version}).
Project root: ${PROJECT_ROOT}

Issues detected:
${issueList}

${repairCount > 0 ? `${repairCount} predefined repair(s) were already attempted.` : ''}

Respond ONLY with a JSON array of shell commands to fix these issues. Example: ["npm install foo","npm run build"]
Rules:
- For version mismatch issues, use: npm pkg set version=<target_version>
- For native module compilation failures (node-gyp, sqlite3 etc), suggest pure-JS alternatives (e.g. better-sqlite3 instead of sqlite3)
- Use npm commands, not yarn/pnpm
- Maximum 5 commands
- If no fix is possible, respond: []`;

        const { routeProviderWithFallback } = await import('../src/tools/aiProviders.js');
        const { text: aiResult } = await routeProviderWithFallback(
          [{ role: 'user', content: prompt }],
          undefined,
          ['gemini', 'claude', 'codex'],
          true,
        );

        const SAFE_COMMAND_PREFIXES = [
          'npm install',
          'npm run build',
          'npm run lint',
          'npm test',
          'npm ci',
          'npm pkg set',
          'npm update',
          'npx tsc',
          'git pull',
          'git fetch',
          'git checkout',
        ];
        function isSafeCommand(cmd: string): boolean {
          const trimmed = cmd.trim();
          return SAFE_COMMAND_PREFIXES.some((prefix) => trimmed === prefix || trimmed.startsWith(prefix + ' '));
        }

        const jsonMatch = aiResult?.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const commands: string[] = JSON.parse(jsonMatch[0]);
          for (const cmd of commands.slice(0, 5)) {
            if (!isSafeCommand(cmd)) {
              body += `  ${icons.repair} ${chalk.hex(THEME.warning)(`Skipped unsafe: ${cmd}`)}\n`;
              continue;
            }
            try {
              execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 120_000 });
              repairCount++;
              if (cmd.includes('install') || cmd.includes('build')) needsRebuild = true;
              body += `  ${icons.repair} ${chalk.hex('#6C5CE7')(`AI: ${cmd}`)}\n`;
            } catch (cmdErr: unknown) {
              const msg = cmdErr instanceof Error ? cmdErr.message.split('\n')[0] : 'failed';
              body += `  ${icons.repair} ${chalk.hex(THEME.error)(`AI: ${cmd} — ${msg}`)}\n`;
            }
          }
        }
      } catch (aiErr: unknown) {
        const msg = aiErr instanceof Error ? aiErr.message.split('\n')[0] : 'AI unavailable';
        body += `  ${chalk.hex(THEME.warning)(`  AI repair skipped: ${msg}`)}\n`;
      }
    }

    // 3) Rebuild if packages changed
    if (needsRebuild) {
      try {
        execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 120_000 });
        repairCount++;
        body += `  ${icons.repair} ${chalk.hex('#6C5CE7')('Rebuild & manifest regeneration done')}\n`;
      } catch (rbErr: unknown) {
        const msg = rbErr instanceof Error ? rbErr.message.split('\n')[0] : 'Build failed';
        body += `  ${icons.repair} ${chalk.hex(THEME.error)(`Rebuild failed: ${msg}`)}\n`;
      }
    }

    // 4) Re-run checks to show ACTUAL final state
    body += `\n  ${chalk.hex(THEME.primary).bold('Verification')}\n`;
    // Reload manifest
    manifest = loadToolManifest();
    const postChecks: DoctorCheck[] = [];
    for (const orig of checks.filter((c) => !c.label.startsWith('  '))) {
      const rc = await reRunCheck(orig.label);
      postChecks.push(rc ?? orig);
    }
    const postPassed = postChecks.filter((c) => c.status === 'ok').length;
    const postTotal = postChecks.length;
    for (const c of postChecks) {
      body += formatCheck(c) + '\n';
    }

    const summaryText = repairCount > 0
      ? `${repairCount} repair(s) applied. ${postPassed}/${postTotal} checks passed.`
      : `No repairs could be applied. ${postPassed}/${postTotal} checks passed.`;
    const summaryColor = postPassed === postTotal ? THEME.success : THEME.warning;
    body += `\n  ${chalk.hex(summaryColor)(summaryText)}`;

    console.log(renderTextMenu('Doctor Fix', body, 'doctor                              Run full health check', 'doctor'));
  } else {
    // ── Normal mode: show all checks ─────────────────────────────
    for (const c of checks) {
      body += formatCheck(c) + '\n';
    }

    const hasUpdate = checks.some((c) => c.label === 'package.json' && c.status === 'warn');
    if (hasUpdate) {
      body += `\n  ${chalk.hex(THEME.warning)('A newer version is available. Run \'hakanmcp doctor fix\' or \'/doctor fix\' to update.')}`;
    }
    if (repairables.length > 0) {
      body += `\n  ${chalk.hex(THEME.primary)(`${repairables.length} issue(s) can be auto-repaired. Run 'hakanmcp doctor fix' or '/doctor fix' to fix.`)}`;
    }

    const passed = checks.filter((c) => c.status === 'ok').length;
    const total = checks.filter((c) => !c.label.startsWith('  ')).length;
    const summaryText = passed === total ? 'All checks passed.' : `${passed}/${total} checks passed.`;
    const summaryColor = passed === total ? THEME.success : THEME.warning;
    body += `\n  ${chalk.hex(summaryColor)(summaryText)}`;

    console.log(renderTextMenu('Doctor', body, 'doctor fix                          Auto-repair detected issues', 'doctor'));
  }

  // ── Re-run individual check helper ─────────────────────────────
  async function reRunCheck(label: string): Promise<DoctorCheck | null> {
    switch (label) {
      case 'config.yaml': {
        if (!fs.existsSync(cfgPath)) return { label, status: 'fail', detail: 'Still missing' };
        try {
          const { validateConfig: valCfg, config: cfg2 } = await import('../src/config.js');
          const errs: string[] = valCfg(cfg2, { strict: false, warnOnly: true });
          return { label, status: errs.length === 0 ? 'ok' : 'warn', detail: errs.length === 0 ? 'Valid' : `${errs.length} issue(s)` };
        } catch {
          return { label, status: 'ok', detail: 'Created' };
        }
      }
      case 'Build (dist/)': {
        if (!fs.existsSync(distIndex)) return { label, status: 'fail', detail: 'Still not built' };
        const reDirs = ['src', 'scripts', 'bin'].map((d) => path.join(PROJECT_ROOT, d));
        const srcN = Math.max(...reDirs.map((d) => getNewestMtime(d, '.ts')));
        const distM = fs.statSync(distIndex).mtimeMs;
        return { label, status: srcN <= distM ? 'ok' : 'fail', detail: srcN <= distM ? 'Up to date' : 'Still stale' };
      }
      case '.env': {
        if (!fs.existsSync(envPath)) return { label, status: 'warn', detail: 'Still missing' };
        const keyCount = fs.readFileSync(envPath, 'utf8').split('\n')
          .filter((l: string) => l.trim() && !l.trim().startsWith('#') && l.includes('=')).length;
        return { label, status: 'ok', detail: `Found (${keyCount} keys)` };
      }
      case 'MCP Tools': {
        manifest = loadToolManifest();
        if (!manifest) return { label, status: 'warn', detail: 'Still missing' };
        return { label, status: 'ok', detail: `${manifest.totalTools} registered` };
      }
      case 'Logs directory': {
        if (!fs.existsSync(logsDir)) return { label, status: 'fail', detail: 'Still missing' };
        const tf = path.join(logsDir, `.doctor-write-test-${Date.now()}.tmp`);
        try { fs.writeFileSync(tf, 'test', 'utf8'); fs.unlinkSync(tf); return { label, status: 'ok', detail: 'Writable' }; }
        catch { return { label, status: 'fail', detail: 'Not writable' }; }
      }
      case 'Consciousness': {
        if (!fs.existsSync(consciousnessDir)) return { label, status: 'warn', detail: 'Still missing' };
        return { label, status: 'ok', detail: 'Directory created' };
      }
      default:
        return null;
    }
  }
}

async function runStatus(): Promise<void> {
  const version = getAppVersion();
  const os = await import('node:os');
  const uptimeSec = os.default.uptime();
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const uptime = days > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  // Backup stats
  let backupLine = chalk.hex(THEME.textMuted)('N/A');
  try {
    const { backupService } = await import('../src/services/backupService.js');
    const stats = backupService.getStats();
    backupLine = stats.enabled
      ? `${chalk.hex(THEME.success)('enabled')} (every ${stats.intervalHours}h, ${stats.totalBackups} backups)`
      : chalk.hex(THEME.textMuted)('disabled');
  } catch { /* ignore */ }

  // Config
  let serverName = 'hakan-mcp';
  let aiProviderLine = '';
  let githubEnabled = false;
  let monitoringEnabled = false;
  let schedulerEnabled = false;
  let consciousnessEnabled = false;
  let watchEnabled = false;
  let reactiveEnabled = false;
  let selfImprovementEnabled = false;
  try {
    const { config: cfg } = await import('../src/config.js');
    serverName = cfg.serverName || serverName;
    const agentic = cfg.aiProviders?.agenticEnabled ?? false;
    const local = cfg.aiProviders?.localModels ?? false;
    aiProviderLine = (agentic ? 'agentic' : 'standard') + (local ? ' + ollama' : '');
    githubEnabled = cfg.github?.enabled ?? false;
    monitoringEnabled = cfg.monitoring?.enabled ?? false;
    schedulerEnabled = cfg.scheduler?.enabled ?? false;
    consciousnessEnabled = cfg.consciousness?.enabled ?? false;
    watchEnabled = cfg.watch?.enabled ?? false;
    reactiveEnabled = cfg.reactive?.enabled ?? false;
    selfImprovementEnabled = cfg.selfImprovement?.enabled ?? false;
  } catch { /* ignore */ }

  const toggle = (on: boolean) => on ? chalk.hex(THEME.success)('enabled') : chalk.hex(THEME.textMuted)('disabled');

  let body = '';
  body += `  ${chalk.hex(THEME.primary)('Server')}           ${chalk.hex('#F1F2F6')(serverName)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Version')}          ${chalk.hex('#F1F2F6')(version)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Node')}             ${chalk.hex('#F1F2F6')(process.version)}\n`;
  body += `  ${chalk.hex(THEME.primary)('PID')}              ${chalk.hex('#F1F2F6')(String(process.pid))}\n`;
  body += `  ${chalk.hex(THEME.primary)('Uptime')}           ${chalk.hex('#F1F2F6')(uptime)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Project')}          ${chalk.hex(THEME.textMuted)(PROJECT_ROOT)}\n`;
  body += `\n`;
  body += `  ${chalk.hex(THEME.primary)('AI Providers')}     ${chalk.hex('#F1F2F6')(aiProviderLine)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Backup')}           ${backupLine}\n`;
  body += `  ${chalk.hex(THEME.primary)('GitHub')}           ${toggle(githubEnabled)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Monitoring')}       ${toggle(monitoringEnabled)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Scheduler')}        ${toggle(schedulerEnabled)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Consciousness')}    ${toggle(consciousnessEnabled)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Watch')}            ${toggle(watchEnabled)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Reactive')}         ${toggle(reactiveEnabled)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Self-Improve')}     ${toggle(selfImprovementEnabled)}\n`;

  console.log(renderTextMenu('Status', body.trimEnd(), undefined, 'status'));
}

async function runBackupInfo(): Promise<void> {
  try {
    const { backupService } = await import('../src/services/backupService.js');
    const stats = backupService.getStats();
    const backups = backupService.listBackups();

    let body = '';
    body += `  ${chalk.hex(THEME.primary)('Status')}        ${chalk.hex('#F1F2F6')(stats.enabled ? 'enabled' : 'disabled')}\n`;
    body += `  ${chalk.hex(THEME.primary)('Interval')}      ${chalk.hex('#F1F2F6')(`every ${stats.intervalHours}h`)}\n`;
    body += `  ${chalk.hex(THEME.primary)('Directory')}     ${chalk.hex('#F1F2F6')(stats.backupDir)}\n`;
    body += `  ${chalk.hex(THEME.primary)('Total')}         ${chalk.hex('#F1F2F6')(`${stats.totalBackups} backups`)}\n`;

    const now24 = Date.now();
    const last24h = backups.filter((b) => now24 - b.created < 24 * 60 * 60 * 1000);
    body += `  ${chalk.hex(THEME.primary)('Last 24h')}      ${chalk.hex('#F1F2F6')(`${last24h.length} backups`)}\n`;

    if (backups.length > 0) {
      const newest = backups[0];
      const newestAge = ((Date.now() - newest.created) / (1000 * 60 * 60)).toFixed(1);
      body += `  ${chalk.hex(THEME.primary)('Last backup')}   ${chalk.hex('#F1F2F6')(`${path.basename(newest.path)} (${newest.sizeMB} MB, ${newestAge}h ago)`)}\n`;
    } else {
      body += `  ${chalk.hex(THEME.primary)('Last backup')}   ${chalk.hex(THEME.textMuted)('none')}\n`;
    }

    if (backups.length > 0) {
      const recent = backups.slice(0, 10);
      body += `\n  ${chalk.hex(THEME.textMuted)('Recent backups:')}\n`;
      for (const b of recent) {
        const age = ((Date.now() - b.created) / (1000 * 60 * 60)).toFixed(1);
        body += `    ${chalk.hex(THEME.primary)('›')} ${path.basename(b.path).padEnd(52)} ${chalk.hex(THEME.textMuted)(`${b.sizeMB} MB`.padStart(8))}  ${chalk.hex(THEME.textMuted)(`${age}h ago`)}\n`;
      }
    }

    const hint = [
      'backup run  Create a backup now',
    ].join('\n');
    console.log(renderListBox('Backup', body.trimEnd(), hint, 'backup'));
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(
      renderTextMenu(
        'Backup Error',
        `  ${chalk.hex(THEME.error)('✗')} ${chalk.red(errMsg)}`,
        undefined,
        'backup',
      ),
    );
    process.exit(1);
  }
}

async function runBackupRun(): Promise<void> {
  // Render header (banner in CLI, divider in embed)
  const divider = renderDivider();
  const titleColor = MENU_COLORS['backup'] ?? THEME.primary;

  if (isEmbedOutput()) {
    process.stdout.write(`\n${divider}\n`);
    process.stdout.write(chalk.hex(titleColor)('  Backup') + '\n\n');
  } else {
    clearScreen();
    const logo = renderGradientLogo();
    const pills = renderPillMenu();
    const statusBar = renderStatusBar();
    process.stdout.write(`\n${logo}\n\n${statusBar}\n${divider}\n\n${pills}\n`);
    process.stdout.write(`\n${divider}\n`);
    process.stdout.write(chalk.hex(titleColor)('  Backup') + '\n\n');
  }

  // Spinner inside the design frame
  const spinner = ora({
    text: chalk.hex(THEME.primary)('Creating backup...'),
    spinner: THEMED_SPINNER,
    indent: 2,
  }).start();

  try {
    const { backupService } = await import('../src/services/backupService.js');

    const result = await backupService.createBackup({ skipIntervalCheck: true });
    spinner.stop();

    if (result) {
      let body = `  ${chalk.hex(THEME.success)('✓')} ${chalk.hex('#F1F2F6')('Backup created:')} ${chalk.hex(THEME.primary)(result)}\n\n`;
      const backups = backupService.listBackups();
      const recent = backups.slice(0, 10);
      body += `  ${chalk.hex(THEME.textMuted)(`Last ${recent.length} backup(s):`)}\n`;
      recent.forEach((b: Record<string, unknown>) => {
        const age = ((Date.now() - (b.created as number)) / (1000 * 60 * 60)).toFixed(1);
        body += `    ${chalk.hex(THEME.primary)('›')} ${path.basename(b.path as string)} ${chalk.hex(THEME.textMuted)(`(${b.sizeMB} MB, ${age}h ago)`)}\n`;
      });
      process.stdout.write(body);
    } else {
      process.stdout.write(`  ${chalk.hex(THEME.warning)('⚠')} Backup skipped unexpectedly\n`);
    }
  } catch (err: unknown) {
    spinner.stop();
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`  ${chalk.hex(THEME.error)('✗')} ${chalk.red(errMsg)}\n`);
  }

  // Close the design frame
  if (isEmbedOutput()) {
    process.stdout.write(`\n${divider}\n`);
  } else {
    const defaultHint = 'Type a message or /help for commands  ·  Ctrl+C to exit';
    process.stdout.write(`\n${divider}\n  ${chalk.hex(THEME.textMuted)(defaultHint)}\n`);
  }
}

async function runConfigSet(pathArg: string, valueArg: string): Promise<void> {
  const spinner = ora({
    text: chalk.hex(THEME.primary)('Updating config...'),
    spinner: THEMED_SPINNER,
  }).start();
  try {
    const { updateConfig } = await import('../src/config.js');
    const parts = pathArg.split('.');
    let update: Record<string, unknown> = {};
    let current: Record<string, unknown> = update;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const next: Record<string, unknown> = {};
      current[key] = next;
      current = next;
    }

    let value: unknown = valueArg;
    if (valueArg === 'true') value = true;
    else if (valueArg === 'false') value = false;
    else if (/^\d+$/.test(valueArg)) value = parseInt(valueArg, 10);

    current[parts[parts.length - 1]] = value;
    updateConfig(update as Record<string, unknown>);
    spinner.stop();
    console.log(
      renderTextMenu(
        'Config',
        `  ${chalk.hex(THEME.success)('✓')} Config updated: ${chalk.hex(THEME.primary)(pathArg)} = ${chalk.hex('#F1F2F6')(valueArg)}`,
        undefined,
        'config',
      ),
    );
  } catch (err: unknown) {
    spinner.stop();
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(
      renderTextMenu(
        'Config Error',
        `  ${chalk.hex(THEME.error)('✗')} ${chalk.red(errMsg)}`,
        undefined,
        'config',
      ),
    );
    process.exit(1);
  }
}

function runConfigYamlHelp(): void {
  const icon = (s: string) => chalk.hex(THEME.primary)('  ✦ ');
  const p = (s: string) => chalk.hex('#F1F2F6')(s.padEnd(40));
  const d = (s: string) => chalk.hex(THEME.textMuted)(s);
  const cat = (s: string) => chalk.hex(THEME.primary).bold(`  ${s}`);

  const sections = [
    { title: 'Root', paths: [
      ['serverName', 'string', 'MCP server name'],
      ['gitbookUrl', 'url', 'GitBook base URL'],
      ['postmanDir', 'string', 'Postman collection dir'],
      ['cacheTtl', '0-86400', 'Cache TTL (seconds)'],
      ['logLevel', 'debug|info|warn|error|none', 'Log verbosity'],
      ['ollamaUrl', 'url', 'Ollama API endpoint'],
      ['ollamaModel', 'string', 'Default Ollama model'],
      ['ollamaTimeout', 'number', 'Ollama timeout (ms)'],
      ['ollamaUpgradeTolerance', '0-1', 'Model upgrade tolerance'],
      ['retryCount', 'number', 'Retry attempts'],
    ]},
    { title: 'github.*', paths: [
      ['github.enabled', 'true|false', 'GitHub integration'],
      ['github.owner', 'string', 'Repo owner'],
      ['github.repo', 'string', 'Repo name'],
      ['github.branch', 'string', 'Default branch'],
      ['github.private', 'true|false', 'Repo visibility'],
    ]},
    { title: 'monitoring.*', paths: [
      ['monitoring.enabled', 'true|false', 'Health monitoring'],
      ['monitoring.checkInterval', 'number', 'Check interval (ms)'],
    ]},
    { title: 'backup.*', paths: [
      ['backup.enabled', 'true|false', 'Local backup'],
      ['backup.localPath', 'string', 'Backup directory'],
      ['backup.maxBackups', '1-10000', 'Max backup files'],
      ['backup.retentionHours', 'number', 'Retention (hours)'],
      ['backup.compressionEnabled', 'true|false', 'Compress archives'],
      ['backup.intervalHours', 'number', 'Auto-backup interval (h)'],
    ]},
    { title: 'aiProviders.*', paths: [
      ['aiProviders.localModels', 'true|false', 'Enable Ollama'],
      ['aiProviders.agenticEnabled', 'true|false', 'Agentic mode'],
      ['aiProviders.agenticMaxIterations', '1-50', 'Max agentic iterations'],
    ]},
    { title: 'scheduler.*', paths: [
      ['scheduler.enabled', 'true|false', 'Task scheduler'],
    ]},
    { title: 'consciousness.*', paths: [
      ['consciousness.enabled', 'true|false', 'Journal & emotion system'],
      ['consciousness.maxJournalEntries', 'number', 'Max journal entries'],
    ]},
    { title: 'selfImprovement.*', paths: [
      ['selfImprovement.enabled', 'true|false', 'Auto-improvement'],
    ]},
    { title: 'Workspace (hakanmcp.config.yaml)', paths: [
      ['watch.enabled', 'true|false', 'File watch mode'],
      ['watch.debounceMs', 'number', 'Watch debounce (ms)'],
      ['schedule.enabled', 'true|false', 'Scheduled mode'],
      ['schedule.cron', 'string', 'Cron expression'],
      ['assistant.enabled', 'true|false', 'Assistant context'],
      ['reactive.enabled', 'true|false', 'Reactive mode'],
      ['workspaces[].name', 'string', 'Workspace identifier'],
      ['workspaces[].path', 'string', 'Target directory'],
      ['workspaces[].primary', 'string', 'Primary mission file'],
      ['workspaces[].secondary', 'string', 'Secondary mission file (optional)'],
    ]},
  ];

  const lines: string[] = [];
  for (const section of sections) {
    lines.push('');
    lines.push(cat(section.title));
    for (const [pathStr, type, desc] of section.paths) {
      lines.push(`${icon('✦')}${p(pathStr)}${chalk.cyan(type.padEnd(16))}${d(desc)}`);
    }
  }

  const hint = [
    'config yaml <path> <value>              Set a config.yaml value',
    'config yaml serverName my-mcp           Example: rename server',
    'config yaml backup.enabled true         Example: enable backup',
  ].join('\n');
  console.log(renderTextMenu('Config YAML Paths', lines.join('\n'), hint, 'config'));
}

async function runLogsOverview(): Promise<void> {
  const logDir = path.join(PROJECT_ROOT, 'logs');
  if (!fs.existsSync(logDir)) {
    console.log(
      renderTextMenu('Logs', `  ${chalk.hex(THEME.warning)('⚠')} No log files yet.`, undefined, 'logs'),
    );
    return;
  }

  const isLogFile = (f: string) => f.endsWith('.log') || f.endsWith('.jsonl') || f.endsWith('.json');
  const lines: string[] = [];
  const areas: string[] = [];

  // Scan subdirectories
  const entries = fs.readdirSync(logDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const dir of dirs) {
    const dirPath = path.join(logDir, dir.name);
    const files = fs.readdirSync(dirPath).filter((f) => {
      try { return fs.statSync(path.join(dirPath, f)).isFile() && isLogFile(f); } catch { return false; }
    });
    if (files.length === 0) continue;
    areas.push(dir.name);
    const sorted = files.sort().reverse();
    const latest = sorted[0];
    const stat = fs.statSync(path.join(dirPath, latest));
    const sizeKB = (stat.size / 1024).toFixed(1);
    const modified = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
    const fileCount = files.length > 1 ? chalk.hex(THEME.textMuted)(` (${files.length} files)`) : '';
    lines.push(
      `  ${chalk.hex(THEME.primary)('◆')} ${chalk.hex('#F1F2F6')(dir.name.padEnd(18))}${latest.padEnd(38)}${(sizeKB + ' KB').padStart(10)}  ${modified}${fileCount}`,
    );
  }

  // Scan root-level log files
  const rootFiles = entries.filter((e) => e.isFile() && isLogFile(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  for (const f of rootFiles) {
    const stat = fs.statSync(path.join(logDir, f.name));
    const sizeKB = (stat.size / 1024).toFixed(1);
    const modified = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
    lines.push(
      `  ${chalk.hex(THEME.textMuted)('·')} ${chalk.hex(THEME.textMuted)('(root)'.padEnd(18))}${f.name.padEnd(38)}${(sizeKB + ' KB').padStart(10)}  ${modified}`,
    );
  }

  if (lines.length === 0) {
    console.log(
      renderTextMenu('Logs', `  ${chalk.hex(THEME.warning)('⚠')} No log files yet.`, undefined, 'logs'),
    );
    return;
  }

  const allNames = [...areas, ...rootFiles.map((f) => f.name.replace(/\.(log|jsonl|json)$/, ''))];
  const hint = [
    'logs <area>        List files in area',
    'logs <area> <file> Show specific file',
    'logs tail <area>   Tail latest file',
    `Areas: ${allNames.join(', ')}`,
  ].join('\n');
  console.log(renderListBox('Logs', lines.join('\n'), hint, 'logs'));
}

const isLogFile = (f: string) => f.endsWith('.log') || f.endsWith('.jsonl') || f.endsWith('.json');

/** Resolve a name to either a subdirectory or a root-level log file. Returns { type, path, label }. */
function logsResolve(name: string): { type: 'dir' | 'file'; resolved: string; label: string } | null {
  const logDir = path.join(PROJECT_ROOT, 'logs');
  if (!fs.existsSync(logDir)) { logsNotFound(name); return null; }

  // 1. Exact subdirectory match
  const dirPath = path.join(logDir, name);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    return { type: 'dir', resolved: dirPath, label: name };
  }

  // 2. Root-level file — exact match
  const asFile = path.join(logDir, name);
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile() && isLogFile(name)) {
    return { type: 'file', resolved: asFile, label: name };
  }

  // 3. Root-level file — try adding extensions
  for (const ext of ['.json', '.jsonl', '.log']) {
    const withExt = path.join(logDir, name + ext);
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return { type: 'file', resolved: withExt, label: name + ext };
    }
  }

  // 4. Partial match across root files
  const rootFiles = fs.readdirSync(logDir).filter((f) => {
    try { return fs.statSync(path.join(logDir, f)).isFile() && isLogFile(f) && f.includes(name); } catch { return false; }
  });
  if (rootFiles.length === 1) {
    return { type: 'file', resolved: path.join(logDir, rootFiles[0]), label: rootFiles[0] };
  }

  logsNotFound(name);
  return null;
}

function logsNotFound(name: string): void {
  const logDir = path.join(PROJECT_ROOT, 'logs');
  const available: string[] = [];
  if (fs.existsSync(logDir)) {
    for (const e of fs.readdirSync(logDir, { withFileTypes: true })) {
      if (e.isDirectory()) available.push(e.name);
      else if (isLogFile(e.name)) available.push(e.name.replace(/\.(log|jsonl|json)$/, ''));
    }
  }
  const hint = available.length > 0 ? `\n  Available: ${available.join(', ')}` : '';
  console.log(
    renderTextMenu('Logs', `  ${chalk.hex(THEME.error)('✗')} Not found: ${name}${hint}`, undefined, 'logs'),
  );
}

/** /logs <name> — if name is a dir, list files; if root file, show it */
async function runLogsNavigate(name: string): Promise<void> {
  const target = logsResolve(name);
  if (!target) return;
  if (target.type === 'file') return showLogFile(target.resolved, target.label);
  return listAreaFiles(target.resolved, target.label);
}

/** /logs <area> <file> — show specific file inside area dir */
async function runLogsShowFile(area: string, file: string): Promise<void> {
  const target = logsResolve(area);
  if (!target) return;
  if (target.type === 'file') {
    // area was actually a root file, ignore second arg
    return showLogFile(target.resolved, target.label);
  }
  // Resolve file inside the directory
  const resolved = resolveFileInDir(target.resolved, file);
  if (!resolved) {
    const dirFiles = fs.readdirSync(target.resolved).filter((f) => {
      try { return fs.statSync(path.join(target.resolved, f)).isFile() && isLogFile(f); } catch { return false; }
    });
    const hint = dirFiles.length > 0 ? `\n  Files: ${dirFiles.join(', ')}` : '';
    console.log(
      renderTextMenu(`Logs · ${area}`, `  ${chalk.hex(THEME.error)('✗')} File not found: ${file}${hint}`, undefined, 'logs'),
    );
    return;
  }
  return showLogFile(resolved.path, `${area}/${resolved.name}`);
}

/** /logs tail <area> — tail latest file in area dir */
async function runLogsTail(area: string): Promise<void> {
  const target = logsResolve(area);
  if (!target) return;
  if (target.type === 'file') return showLogFile(target.resolved, target.label);

  const files = fs.readdirSync(target.resolved).filter((f) => {
    try { return fs.statSync(path.join(target.resolved, f)).isFile() && isLogFile(f); } catch { return false; }
  });
  if (files.length === 0) {
    console.log(
      renderTextMenu(`Logs · ${area}`, `  ${chalk.hex(THEME.warning)('⚠')} No log files in ${area}/`, undefined, 'logs'),
    );
    return;
  }
  const latest = files.sort().reverse()[0];
  return showLogFile(path.join(target.resolved, latest), `${area}/${latest}`);
}

function resolveFileInDir(dirPath: string, file: string): { path: string; name: string } | null {
  // Exact match
  const exact = path.join(dirPath, file);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) return { path: exact, name: file };
  // Try adding extensions
  for (const ext of ['.json', '.jsonl', '.log']) {
    const withExt = path.join(dirPath, file + ext);
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return { path: withExt, name: file + ext };
  }
  // Partial match
  const candidates = fs.readdirSync(dirPath).filter((f) => f.includes(file) && isLogFile(f));
  if (candidates.length === 1) return { path: path.join(dirPath, candidates[0]), name: candidates[0] };
  return null;
}

function listAreaFiles(dirPath: string, area: string): void {
  const files = fs.readdirSync(dirPath).filter((f) => {
    try { return fs.statSync(path.join(dirPath, f)).isFile() && isLogFile(f); } catch { return false; }
  });
  if (files.length === 0) {
    console.log(
      renderTextMenu(`Logs · ${area}`, `  ${chalk.hex(THEME.warning)('⚠')} No log files in ${area}/`, undefined, 'logs'),
    );
    return;
  }
  const lines = files.sort().reverse().map((f) => {
    const stat = fs.statSync(path.join(dirPath, f));
    const sizeKB = (stat.size / 1024).toFixed(1);
    const modified = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
    return `  ${chalk.hex(THEME.primary)('◆')} ${f.padEnd(42)}${(sizeKB + ' KB').padStart(10)}  ${modified}`;
  });
  const footer = `/logs ${area} <file>  ·  /logs tail ${area}`;
  console.log(renderTextMenu(`Logs · ${area}`, lines.join('\n'), footer, 'logs'));
}

function showLogFile(filePath: string, label: string): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const allLines = content.trim().split('\n');
  const lines = allLines.slice(-50);
  const truncated = allLines.length > 50 ? `  ${chalk.hex(THEME.textMuted)(`... ${allLines.length - 50} earlier lines omitted`)}\n` : '';
  const formatted = truncated + lines.map((l) => `  ${chalk.hex(THEME.textMuted)(l)}`).join('\n');
  console.log(
    renderTextMenu(`Logs · ${label}`, formatted, `${allLines.length} lines · last 50 shown`, 'logs'),
  );
}

function runHelp(): void {
  const cmd = (s: string) => chalk.hex('#F1F2F6')(`    ${s.padEnd(40)}`);
  const desc = (s: string) => chalk.hex(THEME.textMuted)(s);
  const cat = (s: string) => chalk.hex(THEME.primary).bold(`  ${s}`);

  const sections = [
    { title: 'System & Diagnostics', items: [
      ['doctor [fix]', 'Health check / auto-repair'],
      ['health', 'Alias for doctor'],
      ['status', 'Status dashboard (version, uptime, backup)'],
      ['tools', 'List all registered MCP tools'],
    ]},
    { title: 'AI Providers', items: [
      ['providers [status]', 'Provider status, limits & cooldowns'],
      ['providers set <type> <args>', 'Configure daily/weekly limits'],
      ['providers reset [target] [provider]', 'Reset cooldowns & usage counters'],
      ['providers update [provider]', 'Update CLI tools & Ollama models'],
    ]},
    { title: 'Configuration', items: [
      ['config', 'Interactive settings UI'],
      ['config info [category]', 'Detailed info about a config category'],
      ['config chat set <cat> <key> <val>', 'Update a chat setting'],
      ['config chat useOllama <on|off>', 'Toggle Ollama usage'],
      ['config chat useApiKeys <on|off>', 'Toggle API key usage'],
      ['config yaml help', 'Show all config.yaml paths & types'],
      ['config yaml set <path> <value>', 'Update config.yaml value'],
    ]},
    { title: 'Journal & Consciousness', items: [
      ['journal [n]', 'Show last N journal entries (default: 5)'],
      ['journal reset', 'Clear journal & reset emotions'],
      ['ralph', 'Ralph Loop dashboard'],
      ['ralph start [-n] [-t] [--dry-run]', 'Start a reflection loop'],
      ['ralph stop <id>', 'Stop a running loop'],
      ['ralph log <id>', 'Show loop output'],
    ]},
    { title: 'Backup & Logs', items: [
      ['backup', 'Backup status & info'],
      ['backup run', 'Create a backup now'],
      ['logs', 'Log overview'],
      ['logs tail <name>', 'Tail a log file in real-time'],
      ['logs show <area> <file>', 'View a specific log file'],
      ['logs open <name> [file]', 'Open log directory or file'],
    ]},
    { title: 'Mission Agent', items: [
      ['init [--force]', 'Interactive workspace & mission setup'],
      ['init --remove <name>', 'Remove a workspace'],
      ['start [--workspace <name>]', 'Start mission agent'],
      ['start --all [--parallel]', 'Run all workspaces'],
      ['stop', 'Stop running agent / watcher / scheduler'],
      ['mission', 'Workspace dashboard & mission status'],
      ['mission --workspace <name>', 'Detailed status for a workspace'],
      ['mission --all', 'Detailed status for all workspaces'],
      ['report [-n N]', 'Show recent reports'],
      ['watch', 'Start file watcher mode'],
      ['reactive', 'Start reactive mode (watch + scheduled)'],
    ]},
    { title: 'Scheduler', items: [
      ['scheduled start', 'Start scheduled mode (cron/interval)'],
      ['scheduled list', 'List all scheduled tasks'],
      ['scheduled add <name> <cron> <task>', 'Add a new scheduled task'],
      ['scheduled remove <id>', 'Remove a scheduled task'],
      ['scheduled pause <id>', 'Pause a scheduled task'],
      ['scheduled resume <id>', 'Resume a paused task'],
    ]},
    { title: 'Chat Commands (in /console)', items: [
      ['/help', 'Show this help'],
      ['/clear', 'Clear chat history'],
      ['/exit, /quit', 'Exit console'],
      ['/doctor [fix]', 'Health check / auto-repair'],
      ['/status', 'Status dashboard'],
      ['/tools', 'List MCP tools'],
      ['/providers [sub]', 'Provider management'],
      ['/config [sub]', 'Configuration'],
      ['/logs [sub]', 'Log browser'],
      ['/journal [n]', 'Journal entries'],
      ['/journal reset', 'Clear journal & reset emotions'],
      ['/backup [run]', 'Backup management'],
      ['/ralph [sub]', 'Ralph loop'],
      ['/init [--force]', 'Interactive workspace & mission setup'],
      ['/init --remove <name>', 'Remove a workspace'],
      ['/start [--workspace <name>]', 'Start mission agent'],
      ['/stop', 'Stop running agent'],
      ['/mission', 'Workspace dashboard & mission status'],
      ['/report [-n N]', 'Recent reports'],
      ['/watch', 'File watcher mode'],
      ['/scheduled [sub]', 'Scheduler management'],
      ['/reactive', 'Reactive mode'],
      ['/assistant', 'Mission-aware assistant info'],
    ]},
  ];

  const lines: string[] = [];
  sections.forEach((section, idx) => {
    if (idx > 0) lines.push('');
    lines.push(cat(section.title));
    for (const [name, description] of section.items) {
      lines.push(`${cmd(name)}${desc(description)}`);
    }
  });


  const hint = 'Usage: hakanmcp [command] | hakanmcp (starts interactive chat)';
  console.log(renderTextMenu('Help', lines.join('\n'), hint, 'help'));
}

async function runJournal(countStr: string): Promise<void> {
  const count = parseInt(countStr || '5', 10) || 5;
  const journalPath = path.join(PROJECT_ROOT, 'logs', 'consciousness', 'journal.jsonl');

  if (!fs.existsSync(journalPath)) {
    console.log(
      renderTextMenu(
        'Journal',
        `  ${chalk.hex(THEME.warning)('⚠')} No journal entries yet.`,
        undefined,
        'journal',
      ),
    );
    return;
  }

  const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean);
  const entries = lines
    .slice(-count)
    .map((line) => {
      try {
        return JSON.parse(line) as {
          timestamp?: string;
          thought?: string;
          result?: string;
          type?: string;
          provider?: string;
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{
    timestamp?: string;
    thought?: string;
    result?: string;
    type?: string;
    provider?: string;
  }>;

  let body = '';
  entries.reverse().forEach((e, i) => {
    const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : '?';
    const typeLabel = e.type ? chalk.hex(THEME.textMuted)(` (${e.type})`) : '';
    const provLabel = (e as any).provider ? chalk.hex(THEME.textMuted)(` via ${(e as any).provider}`) : '';
    const langLabel = (e as any).language ? chalk.hex(THEME.textMuted)(` [${(e as any).language}]`) : '';

    body += `  ${chalk.hex(THEME.primary)(`${i + 1}.`)} ${chalk.hex(THEME.textMuted)(`[${ts}]`)}${typeLabel}${provLabel}${langLabel}\n`;

    switch (e.type) {
      case 'session_summary': {
        const ss = e as any;
        body += `     ${chalk.hex('#F1F2F6')(ss.summary || '')}\n`;
        if (ss.decisions?.length > 0) {
          body += `     ${chalk.hex(THEME.primary)('Decisions:')} ${ss.decisions.join('; ')}\n`;
        }
        if (ss.filesChanged?.length > 0) {
          body += `     ${chalk.hex(THEME.primary)('Files:')} ${ss.filesChanged.length} changed\n`;
        }
        if (ss.nextSteps?.length > 0) {
          body += `     ${chalk.hex(THEME.primary)('Next:')} ${ss.nextSteps.join('; ')}\n`;
        }
        if (ss.metrics) {
          body += `     ${chalk.hex(THEME.textMuted)(`${ss.metrics.messagesExchanged} msg, ${ss.metrics.errorsEncountered} err`)}\n`;
        }
        break;
      }
      case 'session_start': {
        const ss = e as any;
        body += `     ${chalk.hex('#F1F2F6')(ss.summary || '')}\n`;
        if (ss.previousState?.lastSessionDate && ss.previousState.lastSessionDate !== 'none') {
          body += `     ${chalk.hex(THEME.textMuted)(`Previous: ${new Date(ss.previousState.lastSessionDate).toLocaleString()}`)}\n`;
        }
        break;
      }
      case 'error': {
        const ee = e as any;
        body += `     ${chalk.hex('#FF6B6B')(ee.summary || '')}\n`;
        if (ee.resolution) {
          body += `     ${chalk.hex('#00D68F')('Fix:')} ${ee.resolution}\n`;
        }
        break;
      }
      case 'milestone': {
        const me = e as any;
        body += `     ${chalk.hex('#FFD700')('★')} ${chalk.hex('#F1F2F6')(me.summary || '')}\n`;
        if (me.milestone) {
          body += `     ${chalk.hex(THEME.primary)(me.milestone)}\n`;
        }
        break;
      }
      case 'checkpoint': {
        const ce = e as any;
        body += `     ${chalk.hex('#6C5CE7')('◆')} ${chalk.hex('#F1F2F6')(ce.summary || '')}\n`;
        if (ce.filesChanged?.length > 0) {
          body += `     ${chalk.hex(THEME.textMuted)(`${ce.filesChanged.length} files, ${ce.messagesSoFar || '?'} messages`)}\n`;
        }
        break;
      }
      default: {
        // Backward compat: old entries with `thought` field
        const thought = ((e as any).thought || (e as any).result || '').replace(/[\n\r]+/g, ' ').replace(/[#*_`~>]/g, '').trim();
        body += `     ${chalk.hex('#F1F2F6')(thought)}\n`;
      }
    }
    body += '\n';
  });
  // Prepend mood/emotion + character summary
  const cogPath = path.join(PROJECT_ROOT, 'logs', 'consciousness', 'cognition_state.json');
  if (fs.existsSync(cogPath)) {
    try {
      const cog = JSON.parse(fs.readFileSync(cogPath, 'utf8'));
      const em = cog.emotions;
      if (em) {
        // Character traits (short labels from Big Five)
        const profile = em ? getEffectiveCharacter(PROJECT_ROOT, em) : getCharacterProfile(PROJECT_ROOT);
        const traitLabels: string[] = [];
        traitLabels.push(profile.openness >= 0.75 ? 'Inventive' : profile.openness >= 0.55 ? 'Curious' : profile.openness >= 0.35 ? 'Balanced' : profile.openness >= 0.2 ? 'Practical' : 'Narrow');
        traitLabels.push(profile.agreeableness >= 0.75 ? 'Warm' : profile.agreeableness >= 0.55 ? 'Friendly' : profile.agreeableness >= 0.35 ? 'Moderate' : profile.agreeableness >= 0.2 ? 'Direct' : 'Blunt');
        traitLabels.push(profile.conscientiousness >= 0.75 ? 'Meticulous' : profile.conscientiousness >= 0.55 ? 'Organized' : profile.conscientiousness >= 0.35 ? 'Steady' : profile.conscientiousness >= 0.2 ? 'Loose' : 'Impulsive');
        traitLabels.push(profile.extraversion >= 0.75 ? 'Enthusiastic' : profile.extraversion >= 0.55 ? 'Expressive' : profile.extraversion >= 0.35 ? 'Moderate' : profile.extraversion >= 0.2 ? 'Reserved' : 'Terse');
        traitLabels.push(profile.emotionalStability >= 0.75 ? 'Unshakable' : profile.emotionalStability >= 0.55 ? 'Steady' : profile.emotionalStability >= 0.35 ? 'Balanced' : profile.emotionalStability >= 0.2 ? 'Reactive' : 'Volatile');
        traitLabels.push(profile.humor >= 0.75 ? 'Witty' : profile.humor >= 0.55 ? 'Humorous' : profile.humor >= 0.35 ? 'Neutral' : profile.humor >= 0.2 ? 'Serious' : 'Dry');
        traitLabels.push(profile.patience >= 0.75 ? 'Patient' : profile.patience >= 0.55 ? 'Calm' : profile.patience >= 0.35 ? 'Steady' : profile.patience >= 0.2 ? 'Hasty' : 'Impatient');
        traitLabels.push(profile.assertiveness >= 0.75 ? 'Assertive' : profile.assertiveness >= 0.55 ? 'Confident' : profile.assertiveness >= 0.35 ? 'Moderate' : profile.assertiveness >= 0.2 ? 'Deferential' : 'Passive');
        traitLabels.push(profile.formality >= 0.75 ? 'Formal' : profile.formality >= 0.55 ? 'Professional' : profile.formality >= 0.35 ? 'Casual' : profile.formality >= 0.2 ? 'Relaxed' : 'Chatty');

        // Mood description with emoji
        const moodDesc = em.mood > 0.6 ? 'positive' : em.mood > 0.2 ? 'calm' : em.mood > -0.2 ? 'neutral' : em.mood > -0.6 ? 'low' : 'frustrated';
        const moodIcon = em.mood > 0.6 ? chalk.hex('#00D68F')('▲') : em.mood > -0.2 ? chalk.hex('#6C5CE7')('●') : chalk.hex('#FF6B6B')('▼');
        const energyDesc = em.energy > 0.7 ? 'energetic' : em.energy > 0.4 ? 'alert' : 'tired';
        const curiosityDesc = em.curiosity > 0.7 ? 'very curious' : em.curiosity > 0.4 ? 'interested' : 'reflective';

        // Progress bar helper
        const bar = (val: number) => {
          const filled = Math.round(val * 10);
          return '█'.repeat(filled) + '░'.repeat(10 - filled);
        };

        // Mood bar uses normalized 0-1 scale (mood is -1 to 1, so shift)
        const moodNorm = (em.mood + 1) / 2;
        const moodColor = em.mood > 0.3 ? '#00D68F' : em.mood > -0.3 ? '#6C5CE7' : '#FF6B6B';

        // Formatted bar with label, color, and percentage
        const fmtBar = (label: string, val: number, color: string, width = 8) => {
          const filled = Math.round(val * width);
          const barStr = '█'.repeat(filled) + '░'.repeat(width - filled);
          const pct = `${Math.round(val * 100)}%`.padStart(4);
          return `${chalk.hex(THEME.primary)(label.padEnd(13))} ${chalk.hex(color)(barStr)} ${chalk.hex(THEME.textMuted)(pct)}`;
        };

        // Two-column layout
        const col1 = [
          fmtBar('Mood', moodNorm, moodColor),
          fmtBar('Energy', em.energy, '#6C5CE7'),
          fmtBar('Curiosity', em.curiosity, '#FDCB6E'),
        ];
        const col2 = [
          fmtBar('Satisfaction', em.satisfaction, '#00D68F'),
          fmtBar('Frustration', em.frustration, '#FF6B6B'),
          fmtBar('Focus', em.focus ?? 0.5, '#74B9FF'),
        ];

        const COL_GAP = '    ';
        let moodBody = '';
        moodBody += `  ${chalk.hex(THEME.primary)('Character')}  ${chalk.hex('#F1F2F6')(traitLabels.join(' · '))}\n`;
        moodBody += `  ${chalk.hex(THEME.primary)('State')}      ${moodIcon} ${chalk.hex('#F1F2F6')(moodDesc)}`;
        moodBody += `  ${chalk.hex(THEME.textMuted)('·')}  ${chalk.hex('#F1F2F6')(energyDesc)}`;
        moodBody += `  ${chalk.hex(THEME.textMuted)('·')}  ${chalk.hex('#F1F2F6')(curiosityDesc)}\n\n`;

        for (let i = 0; i < col1.length; i++) {
          moodBody += `  ${col1[i]}${COL_GAP}${col2[i]}\n`;
        }

        const totalInt = cog.interactionCount || 0;
        const consOk = cog.consecutiveSuccesses || 0;
        const consErr = cog.consecutiveErrors || 0;
        moodBody += `\n  ${chalk.hex(THEME.textMuted)(`${totalInt} interactions`)}`;
        moodBody += `${COL_GAP}${chalk.hex(THEME.success)(`${consOk} consecutive ok`)}`;
        if (consErr > 0) moodBody += `${COL_GAP}${chalk.hex(THEME.error)(`${consErr} consecutive err`)}`;
        moodBody += '\n\n';
        body = moodBody + body;
      }
    } catch { /* ignore */ }
  }

  const hint = [
    'journal [count]  Show last N entries (default: 5)',
    'journal reset    Clear journal & reset emotions',
    `Showing last ${entries.length} entries`,
  ].join('\n');
  console.log(renderListBox('Journal', body, hint, 'journal'));
}


async function runJournalReset(): Promise<void> {
  const consciousnessDir = path.join(PROJECT_ROOT, 'logs', 'consciousness');
  const journalPath = path.join(consciousnessDir, 'journal.jsonl');
  const cogPath = path.join(consciousnessDir, 'cognition_state.json');

  // Clear journal and backup
  try {
    fs.writeFileSync(journalPath, '');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  try {
    fs.unlinkSync(journalPath + '.bak');
  } catch { /* ignore if not exists */ }

  // Reset cognition state (full wipe)
  const freshState = {
    emotions: { mood: 0.5, energy: 0.5, curiosity: 0.5, satisfaction: 0.5, frustration: 0.1, focus: 0.5 },
    recentTopics: [] as string[],
    interactionCount: 0,
    consecutiveSuccesses: 0,
    consecutiveErrors: 0,
    lastUpdated: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(cogPath, JSON.stringify(freshState, null, 2) + '\n');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const body = `  ${chalk.hex(THEME.success)('✓')} Journal, session history and emotions fully reset.`;
  console.log(renderTextMenu('Journal Reset', body, undefined, 'journal'));
}

async function runProviderStatus(): Promise<void> {
  const {
    getApiCooldownStatus,
    getCliCooldownStatus,
    getApiUsageStatus,
    getCliUsageStatus,
    setCooldownsBasePath,
    getOllamaStatus,
    getProviderAvailability,
    getCliVersions,
  } = await import('../src/services/aiProviderCooldown.js');
  setCooldownsBasePath(PROJECT_ROOT);

  // Fast data (file-based, instant)
  const apiStatus = getApiCooldownStatus();
  const cliCooldown = getCliCooldownStatus();
  const apiUsage = getApiUsageStatus();
  const cliUsage = getCliUsageStatus();

  // Slow data — run all in parallel with spinner
  const spinner = ora({ text: chalk.hex(THEME.primary)('Probing providers...'), spinner: THEMED_SPINNER, isSilent: isEmbedOutput() }).start();
  let ollamaResult: Awaited<ReturnType<typeof getOllamaStatus>> | null = null;
  let versionsResult: Awaited<ReturnType<typeof getCliVersions>> | null = null;
  try {
    const { runWarmupAsync } = await import('../src/services/aiProviderWarmup.js');
    const [, ollama, versions] = await Promise.all([
      runWarmupAsync(PROJECT_ROOT).catch(() => {}),
      getOllamaStatus().catch(() => null),
      getCliVersions().catch(() => null),
    ]);
    ollamaResult = ollama;
    versionsResult = versions;
  } catch { /* non-fatal */ }
  spinner.stop();

  const STALE_THRESHOLD_MS = 15 * 60 * 1000;

  function renderStatus(s: { status: string; reason?: string; until?: number; remainingMs?: number; provider?: string; source?: 'api' | 'cli' }): string {
    switch (s.status) {
      case 'unchecked':
        return chalk.hex(THEME.textMuted)('○ unchecked') + '  ' + chalk.hex(THEME.textMuted)('not yet verified');
      case 'available':
        return chalk.hex(THEME.success)('● available') + (s.reason ? '  ' + chalk.hex(THEME.textMuted)(s.reason) : '');
      case 'unavailable': {
        let recheckSuffix = '';
        if (s.provider && s.source) {
          const key = `${s.provider}_${s.source}` as Parameters<typeof getProviderAvailability>[0];
          const avail = getProviderAvailability(key);
          if (avail.checkedAt > 0) {
            const recheckAt = avail.checkedAt + STALE_THRESHOLD_MS;
            const remainingMs = recheckAt - Date.now();
            if (remainingMs > 0) {
              const remainingMin = Math.ceil(remainingMs / 60_000);
              recheckSuffix = chalk.hex(THEME.textMuted)(` (recheck in ${remainingMin} min)`);
            } else {
              recheckSuffix = chalk.hex(THEME.textMuted)(' (recheck pending)');
            }
          }
        }
        // Truncate long reason to first line, max 50 chars
        let shortReason = (s.reason ?? '').split('\n')[0].trim();
        if (shortReason.length > 50) shortReason = shortReason.slice(0, 47) + '...';
        return chalk.hex(THEME.error)('● unavailable') + (shortReason ? '  ' + chalk.hex(THEME.textMuted)(shortReason) : '') + recheckSuffix;
      }
      case 'cooldown':
        return chalk.hex(THEME.warning)('● cooldown') + '  ' + (s.until
          ? chalk.hex(THEME.textMuted)(`${new Date(s.until).toLocaleString()} (~${Math.ceil((s.remainingMs ?? 0) / 60_000)} min)`)
          : chalk.hex(THEME.textMuted)('?'));
      default:
        return chalk.hex(THEME.textMuted)('?');
    }
  }

  let body = `  ${chalk.bold.hex('#F1F2F6')('API (429 rate limit)')}\n\n`;
  apiStatus.forEach((s) => {
    body += `  ${chalk.hex(THEME.primary)(s.label.padEnd(20))} ${renderStatus(s)}\n`;
  });

  body += `\n  ${chalk.bold.hex('#F1F2F6')('CLI (parsed limit from stderr)')}\n\n`;
  cliCooldown.forEach((s) => {
    body += `  ${chalk.hex(THEME.primary)(s.label.padEnd(20))} ${renderStatus(s)}\n`;
  });

  body += `\n  ${chalk.bold.hex('#F1F2F6')('API Usage (daily/weekly)')}\n\n`;
  apiUsage.forEach((s) => {
    const status = s.limited
      ? chalk.hex(THEME.warning)('● limit')
      : chalk.hex(THEME.success)('● ok');
    body += `  ${chalk.hex(THEME.primary)(s.label.padEnd(20))} ${String(s.dailyUsed + '/' + s.dailyLimit).padEnd(10)} ${String(s.weeklyUsed + '/' + s.weeklyLimit).padEnd(10)} ${status}\n`;
  });

  body += `\n  ${chalk.bold.hex('#F1F2F6')('CLI Usage (daily/weekly)')}\n\n`;
  cliUsage.forEach((s) => {
    const status = s.limited
      ? chalk.hex(THEME.warning)('● limit')
      : chalk.hex(THEME.success)('● ok');
    body += `  ${chalk.hex(THEME.primary)(s.label.padEnd(20))} ${String(s.dailyUsed + '/' + s.dailyLimit).padEnd(10)} ${String(s.weeklyUsed + '/' + s.weeklyLimit).padEnd(10)} ${status}\n`;
  });

  // Ollama (local fallback) status
  body += `\n  ${chalk.bold.hex('#F1F2F6')('Ollama (local fallback)')}\n\n`;
  try {
    const ollama = ollamaResult ?? await getOllamaStatus();
    const statusIcon = ollama.disabled
      ? chalk.hex(THEME.warning)('● disabled')
      : ollama.online
        ? chalk.hex(THEME.success)('● online')
        : chalk.hex(THEME.error)('● offline');
    const statusDetail = ollama.disabled
      ? (process.env.DISABLE_LOCAL_MODELS === '1' ? 'env: DISABLE_LOCAL_MODELS' : 'config: localModels=false')
      : ollama.url;
    body += `  ${chalk.hex(THEME.primary)('Status'.padEnd(20))} ${statusIcon}  ${chalk.hex(THEME.textMuted)(statusDetail)}\n`;
    body += `  ${chalk.hex(THEME.primary)('Default Model'.padEnd(20))} ${chalk.hex(THEME.textMuted)(ollama.defaultModel)}\n`;

    if (ollama.online) {
      body += `  ${chalk.hex(THEME.primary)('Active Model'.padEnd(20))} ${ollama.runningModel ? chalk.hex(THEME.success)(ollama.runningModel) : chalk.hex(THEME.textMuted)('idle (none loaded)')}\n`;
    }

    if (ollama.models.length > 0) {
      const MODEL_COL = 26;
      const truncName = (name: string) => name.length > 24 ? name.slice(0, 21) + '...' : name;
      body += `\n  ${chalk.bold.hex('#F1F2F6')('Model'.padEnd(MODEL_COL))}${chalk.bold.hex('#F1F2F6')('Size'.padEnd(12))}${chalk.bold.hex('#F1F2F6')('Updated'.padEnd(14))}${chalk.bold.hex('#F1F2F6')('Status')}\n`;
      for (const m of ollama.models) {
        const d = new Date(m.modifiedAt);
        const dateStr = Number.isNaN(d.getTime()) ? '?' : d.toLocaleDateString();
        const freshness = m.stale
          ? chalk.hex(THEME.warning)('stale (30+ days)')
          : chalk.hex(THEME.success)('up to date');
        body += `  ${chalk.hex(THEME.primary)(truncName(m.name).padEnd(MODEL_COL))}${chalk.hex(THEME.textMuted)(m.size.padEnd(12))}${chalk.hex(THEME.textMuted)(dateStr.padEnd(14))}${freshness}\n`;
      }
    } else if (!ollama.online) {
      body += `  ${chalk.hex(THEME.primary)('Models'.padEnd(20))} ${chalk.hex(THEME.textMuted)('cannot check (offline)')}\n`;
    } else {
      body += `  ${chalk.hex(THEME.primary)('Models'.padEnd(20))} ${chalk.hex(THEME.textMuted)('none installed')}\n`;
    }
  } catch {
    body += `  ${chalk.hex(THEME.primary)('Status'.padEnd(20))} ${chalk.hex(THEME.error)('● error')}  ${chalk.hex(THEME.textMuted)('status check failed')}\n`;
  }

  // CLI Provider Versions
  body += `\n  ${chalk.bold.hex('#F1F2F6')('Provider Versions')}\n\n`;
  try {
    const versions = versionsResult ?? await getCliVersions();
    for (const v of versions) {
      const name = chalk.hex(THEME.primary)(v.provider.padEnd(20));
      if (!v.installed) {
        body += `  ${name} ${chalk.hex(THEME.textMuted)('not installed')}\n`;
      } else if (v.upToDate === true) {
        body += `  ${name} ${chalk.hex(THEME.success)('v' + v.installed)}  ${chalk.hex(THEME.textMuted)('(latest)')}\n`;
      } else if (v.upToDate === false) {
        body += `  ${name} ${chalk.hex(THEME.warning)('v' + v.installed)}  ${chalk.hex(THEME.textMuted)('→ v' + v.latest + ' available')}\n`;
      } else {
        body += `  ${name} ${chalk.hex(THEME.textMuted)('v' + v.installed)}\n`;
      }
    }
  } catch {
    body += `  ${chalk.hex(THEME.textMuted)('version check failed')}\n`;
  }

  const hint = [
    'providers set <api|cli> [provider] <daily|weekly> <n>  Set usage limit',
    'providers set ollama <status|default> <value>          Configure Ollama',
    'providers reset [target] [provider]                    Reset cooldowns/usage',
    'providers update [provider|ollama]                     Update CLIs & models',
    'API: codex, claude, gemini  ·  CLI: codex, claude, gemini, cursor',
  ].join('\n');
  console.log(renderListBox('Providers', body, hint, 'providers'));
}

async function runProviderReset(target?: string, provider?: string): Promise<void> {
  const {
    resetCooldowns,
    resetApiCooldowns,
    resetCliCooldowns,
    resetApiUsage,
    resetCliUsageFor,
    setCooldownsBasePath,
  } = await import('../src/services/aiProviderCooldown.js');
  setCooldownsBasePath(PROJECT_ROOT);

  const validTargets = ['api', 'cli', 'apiusage', 'cliusage'];
  const apiProviders = ['codex', 'claude', 'gemini'];
  const cliProviders = ['codex', 'claude', 'gemini', 'cursor'];

  if (!target) {
    resetCooldowns();
    console.log(
      renderTextMenu(
        'Providers Reset',
        `  ${chalk.hex(THEME.success)('✓')} All AI provider cooldowns, usage, and status have been reset.`,
        undefined,
        'providers',
      ),
    );
    return;
  }

  if (!validTargets.includes(target)) {
    console.log(
      renderTextMenu(
        'Providers Error',
        `  ${chalk.hex(THEME.error)('✗')} Invalid target "${target}". Valid: ${validTargets.join(', ')}`,
        undefined,
        'providers',
      ),
    );
    return;
  }

  if (provider) {
    const validProviders = target.startsWith('cli') ? cliProviders : apiProviders;
    if (!validProviders.includes(provider)) {
      console.log(
        renderTextMenu(
          'Providers Error',
          `  ${chalk.hex(THEME.error)('✗')} Invalid provider "${provider}" for ${target}. Valid: ${validProviders.join(', ')}`,
          undefined,
          'providers',
        ),
      );
      return;
    }
  }

  switch (target) {
    case 'api':
      resetApiCooldowns(provider as any);
      break;
    case 'cli':
      resetCliCooldowns(provider as any);
      break;
    case 'apiusage':
      resetApiUsage(provider as any);
      break;
    case 'cliusage':
      resetCliUsageFor(provider as any);
      break;
  }

  const scope = provider ? `${target} (${provider})` : target;
  console.log(
    renderTextMenu(
      'Providers Reset',
      `  ${chalk.hex(THEME.success)('✓')} Reset: ${scope}`,
      undefined,
      'providers',
    ),
  );
}

async function runOllamaSet(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.log(
      renderTextMenu(
        'Providers Error',
        `  ${chalk.hex(THEME.error)('✗')} Usage: providers set ollama <status|default> <value>\n  Examples: providers set ollama status enabled  ·  providers set ollama default qwen3`,
        undefined,
        'providers',
      ),
    );
    process.exit(1);
  }

  const [subcommand, ...rest] = args;
  const value = rest.join(' ');

  if (subcommand === 'status') {
    if (value === 'enabled' || value === 'disabled') {
      const { updateConfig } = await import('../src/config.js');
      updateConfig({ aiProviders: { localModels: value === 'enabled' } });
      console.log(
        renderTextMenu(
          'Providers',
          `  ${chalk.hex(THEME.success)('✓')} Ollama ${value === 'enabled' ? 'enabled' : 'disabled'}`,
          undefined,
          'providers',
        ),
      );
    } else {
      console.log(
        renderTextMenu(
          'Providers Error',
          `  ${chalk.hex(THEME.error)('✗')} Invalid value "${value}". Use "enabled" or "disabled".`,
          undefined,
          'providers',
        ),
      );
      process.exit(1);
    }
  } else if (subcommand === 'default') {
    if (!value) {
      console.log(
        renderTextMenu(
          'Providers Error',
          `  ${chalk.hex(THEME.error)('✗')} Usage: providers set ollama default <model>`,
          undefined,
          'providers',
        ),
      );
      process.exit(1);
    }
    const { getOllamaStatus } = await import('../src/services/aiProviderCooldown.js');
    const ollama = await getOllamaStatus();
    if (!ollama.online) {
      console.log(
        renderTextMenu(
          'Providers Error',
          `  ${chalk.hex(THEME.error)('✗')} Ollama is offline. Cannot list models.`,
          undefined,
          'providers',
        ),
      );
      process.exit(1);
    }
    const match = ollama.models.find((m: { name: string }) => m.name.startsWith(value) || m.name.includes(value));
    if (!match) {
      const available = ollama.models.map((m: { name: string }) => m.name).join(', ');
      console.log(
        renderTextMenu(
          'Providers Error',
          `  ${chalk.hex(THEME.error)('✗')} No model matching "${value}".\n  Available: ${available}`,
          undefined,
          'providers',
        ),
      );
      process.exit(1);
    }
    const { updateConfig } = await import('../src/config.js');
    updateConfig({ ollamaModel: match.name });
    console.log(
      renderTextMenu(
        'Providers',
        `  ${chalk.hex(THEME.success)('✓')} Default model set to ${chalk.hex(THEME.primary)(match.name)}`,
        undefined,
        'providers',
      ),
    );
  } else {
    console.log(
      renderTextMenu(
        'Providers Error',
        `  ${chalk.hex(THEME.error)('✗')} Unknown subcommand "${subcommand}". Use "status" or "default".`,
        undefined,
        'providers',
      ),
    );
    process.exit(1);
  }
}

async function runProviderSet(type: string, args: string[]): Promise<void> {
  const validTypes = ['api', 'cli', 'ollama'];
  if (type === 'ollama') {
    return runOllamaSet(args);
  }
  if (!validTypes.includes(type)) {
    console.log(
      renderTextMenu(
        'Provider Error',
        `  ${chalk.hex(THEME.error)('✗')} Invalid type "${type}". Use "api", "cli", or "ollama".`,
        undefined,
        'providers',
      ),
    );
    process.exit(1);
  }

  let provider: string | undefined;
  let period: string;
  let valueStr: string;

  if (args.length === 2) {
    [period, valueStr] = args;
  } else if (args.length === 3) {
    [provider, period, valueStr] = args;
  } else {
    console.log(
      renderTextMenu(
        'Provider Error',
        `  ${chalk.hex(THEME.error)('✗')} Usage:\n  providers set <api|cli> [provider] <daily|weekly> <value>\n  providers set ollama <status|default> <value>\n  Examples: providers set api daily 50  ·  providers set ollama status enabled`,
        undefined,
        'providers',
      ),
    );
    process.exit(1);
  }

  if (!['daily', 'weekly'].includes(period)) {
    console.log(
      renderTextMenu(
        'Providers Error',
        `  ${chalk.hex(THEME.error)('✗')} Invalid period "${period}". Use "daily" or "weekly".`,
        undefined,
        'providers',
      ),
    );
    process.exit(1);
  }

  const value = parseInt(valueStr, 10);
  if (isNaN(value) || value < 0) {
    console.log(
      renderTextMenu(
        'Providers Error',
        `  ${chalk.hex(THEME.error)('✗')} Invalid value "${valueStr}". Must be a non-negative integer.`,
        undefined,
        'providers',
      ),
    );
    process.exit(1);
  }

  const apiProviders = ['codex', 'claude', 'gemini'];
  const cliProviders = ['codex', 'claude', 'gemini', 'cursor'];
  if (provider) {
    const validProviders = type === 'api' ? apiProviders : cliProviders;
    if (!validProviders.includes(provider)) {
      console.log(
        renderTextMenu(
          'Providers Error',
          `  ${chalk.hex(THEME.error)('✗')} Invalid provider "${provider}" for ${type}. Valid: ${validProviders.join(', ')}`,
          undefined,
          'providers',
        ),
      );
      process.exit(1);
    }
  }

  const configKey = period === 'daily' ? 'dailyLimit' : 'weeklyLimit';
  const configPath = provider ? `${type}.${provider}.${configKey}` : `${type}.${configKey}`;

  try {
    const { updateConfig } = await import('../src/config.js');
    const parts = configPath.split('.');
    let update: Record<string, unknown> = {};
    let current: Record<string, unknown> = update;
    for (let i = 0; i < parts.length - 1; i++) {
      const next: Record<string, unknown> = {};
      current[parts[i]] = next;
      current = next;
    }
    current[parts[parts.length - 1]] = value;
    updateConfig(update as Record<string, unknown>);

    const label = provider ? `${type}.${provider} ${period}` : `${type} ${period}`;
    console.log(
      renderTextMenu(
        'Providers',
        `  ${chalk.hex(THEME.success)('✓')} ${chalk.hex(THEME.primary)(label)} limit set to ${chalk.hex('#F1F2F6')(String(value))}`,
        undefined,
        'providers',
      ),
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(
      renderTextMenu(
        'Providers Error',
        `  ${chalk.hex(THEME.error)('✗')} ${chalk.red(errMsg)}`,
        undefined,
        'providers',
      ),
    );
    process.exit(1);
  }
}

async function runProviderUpdate(provider?: string): Promise<void> {
  const validProviders = ['codex', 'claude', 'gemini', 'ollama'];
  if (provider && !validProviders.includes(provider)) {
    console.log(
      renderTextMenu(
        'Providers Error',
        `  ${chalk.hex(THEME.error)('✗')} Unknown provider: ${provider}\n  Valid: ${validProviders.join(', ')}`,
        undefined,
        'providers',
      ),
    );
    process.exit(1);
  }

  const {
    getCliVersions,
    updateAllOllamaModels,
    getOllamaStatus,
  } = await import('../src/services/aiProviderCooldown.js');

  const targets = provider ? [provider] : validProviders;

  // Update CLI tools via npm
  const npmTargets = targets.filter((t) => ['codex', 'claude', 'gemini'].includes(t));
  if (npmTargets.length > 0) {
    const versions = await getCliVersions();
    for (const t of npmTargets) {
      const v = versions.find((x) => x.provider === t);
      if (!v || !v.installed) {
        console.log(`  ${chalk.hex(THEME.textMuted)(t.padEnd(12))} ${chalk.hex(THEME.textMuted)('not installed — skipping')}`);
        continue;
      }
      if (v.upToDate === true) {
        console.log(`  ${chalk.hex(THEME.success)('✓')} ${chalk.hex(THEME.primary)(t.padEnd(12))} v${v.installed} ${chalk.hex(THEME.textMuted)('(already latest)')}`);
        continue;
      }
      // Update via npm
      const spinner = ora({
        text: chalk.hex(THEME.primary)(`Updating ${t} ${v.installed} → ${v.latest ?? '?'}...`),
        spinner: THEMED_SPINNER,
        isSilent: isEmbedOutput(),
      }).start();
      try {
        await new Promise<void>((resolve, reject) => {
          exec(v.updateCommand, { timeout: 120_000 }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        spinner.succeed(
          `${chalk.hex(THEME.success)('✓')} ${chalk.hex(THEME.primary)(t.padEnd(12))} v${v.installed} → v${v.latest ?? 'latest'} ${chalk.hex(THEME.textMuted)('(updated)')}`
        );
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? String(err);
        spinner.fail(
          `${chalk.hex(THEME.error)('✗')} ${chalk.hex(THEME.primary)(t.padEnd(12))} update failed: ${msg.slice(0, 80)}`
        );
      }
    }
  }

  // Update Ollama (self + models)
  if (targets.includes('ollama')) {
    let interrupted = false;
    let childProc: any = null;
    const onSigint = () => { interrupted = true; childProc?.kill(); };
    process.on('SIGINT', onSigint);

    try {
      // Step 1: Check if Ollama update available
      const ollamaSpinner = ora({ text: chalk.hex(THEME.primary)('Checking Ollama version...'), spinner: THEMED_SPINNER, isSilent: isEmbedOutput() }).start();
      try {
        // Check current vs available
        const { stdout: checkOut } = await new Promise<{ stdout: string }>((res, rej) => {
          childProc = exec('winget upgrade --id Ollama.Ollama --accept-source-agreements', { timeout: 30_000 }, (err, stdout) => {
            childProc = null;
            // winget exits non-zero when no upgrade available
            res({ stdout: (stdout || '') + ((err as any)?.message || '') });
          });
        });

        if (interrupted) throw new Error('interrupted');

        if (/No applicable upgrade|No installed package/i.test(checkOut)) {
          // Get current version
          let ver = '';
          try {
            const { stdout } = await new Promise<{ stdout: string }>((res, rej) => {
              exec('ollama --version', { timeout: 5000 }, (err, stdout) => err ? rej(err) : res({ stdout }));
            });
            const m = stdout.match(/(\d+\.\d+\.\d+)/);
            ver = m ? m[1] : '';
          } catch {}
          ollamaSpinner.succeed(chalk.hex(THEME.success)(`Ollama ${ver ? 'v' + ver + ' ' : ''}(already latest)`));
        } else {
          // Upgrade available — run silent install
          ollamaSpinner.text = chalk.hex(THEME.primary)('Updating Ollama...');
          await new Promise<void>((resolve, reject) => {
            childProc = exec('winget upgrade Ollama.Ollama --accept-source-agreements --accept-package-agreements --silent', { timeout: 600_000 }, (err) => {
              childProc = null;
              if (err) reject(err); else resolve();
            });
          });

          if (interrupted) throw new Error('interrupted');

          let newVer = '';
          try {
            const { stdout } = await new Promise<{ stdout: string }>((res, rej) => {
              exec('ollama --version', { timeout: 5000 }, (err, stdout) => err ? rej(err) : res({ stdout }));
            });
            const m = stdout.match(/(\d+\.\d+\.\d+)/);
            newVer = m ? m[1] : '';
          } catch {}
          ollamaSpinner.succeed(chalk.hex(THEME.success)(`Ollama updated to ${newVer ? 'v' + newVer : 'latest'}`));
        }
      } catch (err: unknown) {
        if (interrupted) throw err;
        const msg = (err as Error)?.message ?? String(err);
        ollamaSpinner.warn(chalk.hex(THEME.warning)(`Ollama self-update skipped: ${msg.slice(0, 60)}`));
      }

      if (interrupted) throw new Error('interrupted');

      // Step 2: Update installed models
      try {
        const ollama = await getOllamaStatus();
        if (!ollama.online) {
          console.log(`  ${chalk.hex(THEME.error)('✗')} ${chalk.hex(THEME.primary)('ollama')}  ${chalk.hex(THEME.textMuted)('offline — cannot update models')}`);
        } else if (ollama.models.length === 0) {
          console.log(`  ${chalk.hex(THEME.textMuted)('ollama')}  ${chalk.hex(THEME.textMuted)('no models installed')}`);
        } else {
          console.log(`\n  ${chalk.hex(THEME.primary)('Updating Ollama models')} (${ollama.models.length} model(s))...\n`);
          let currentLine = '';
          const { updated, failed, upgrades } = await updateAllOllamaModels(
            (overall, model, modelPercent, status) => {
              const bar = renderProgressBar(overall, 30);
              const line = model
                ? `  ${bar} ${chalk.hex(THEME.primary)(overall + '%')}  ${chalk.hex('#F1F2F6')(model)} ${chalk.hex(THEME.textMuted)(`${modelPercent}% — ${status.slice(0, 40)}`)}`
                : `  ${bar} ${chalk.hex(THEME.success)(overall + '%')}  ${chalk.hex(THEME.textMuted)(status)}`;
              if (process.stdout.clearLine) {
                process.stdout.clearLine(0);
                process.stdout.cursorTo(0);
              } else if (currentLine) {
                process.stdout.write('\r');
              }
              process.stdout.write(line);
              currentLine = line;
            },
          );
          if (currentLine) process.stdout.write('\n');
          console.log('');
          if (updated.length > 0) {
            console.log(`  ${chalk.hex(THEME.success)('✓')} Updated: ${updated.join(', ')}`);
          }
          if (failed.length > 0) {
            console.log(`  ${chalk.hex(THEME.error)('✗')} Failed: ${failed.join(', ')}`);
          }
          if (upgrades.length > 0) {
            console.log(`\n  ${chalk.hex(THEME.primary)('Version upgrades pulled:')}`);
            for (const u of upgrades) {
              console.log(`  ${chalk.hex(THEME.textMuted)(u.current)} → ${chalk.hex(THEME.success)(u.upgrade)}`);
            }
            // Update default model if it was upgraded
            const { config: cfg } = await import('../src/config.js');
            const { updateConfig } = await import('../src/config.js');
            for (const u of upgrades) {
              if (cfg.ollamaModel === u.current || cfg.ollamaModel?.startsWith(u.current.split(':')[0] + ':')) {
                updateConfig({ ollamaModel: u.upgrade });
                console.log(`  ${chalk.hex(THEME.primary)('Default model updated:')} ${u.current} → ${u.upgrade}`);
              }
            }
          }
        }
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? String(err);
        console.log(`  ${chalk.hex(THEME.error)('✗')} Ollama update error: ${msg}`);
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
      if (interrupted) {
        console.log(chalk.hex(THEME.warning)('\n  ⚠ Update interrupted by user'));
      }
    }
  }
}

function renderProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return chalk.hex(THEME.success)('█'.repeat(filled)) + chalk.hex(THEME.textMuted)('░'.repeat(empty));
}

function isCursorCliAvailable(): boolean {
  try {
    execSync('agent --version', { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    try {
      execSync('agent --help', { stdio: 'pipe', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

async function runSettings(): Promise<void> {
  const { config } = await import('../src/config.js');
  const { getChatSettings } = await import('../src/utils/chatSettings.js');
  const chat = getChatSettings();

  type Row = [string, string | boolean | number, string];
  const sections: Array<{ title: string; rows: Row[] }> = [
    {
      title: 'General',
      rows: [
        ['serverName', config.serverName ?? '—', 'MCP server instance name'],
        ['logLevel', config.logLevel ?? 'info', 'Log verbosity (debug/info/warn/error)'],
        ['cacheTtl', config.cacheTtl ?? 300, 'Cache time-to-live in seconds'],
        ['retryCount', config.retryCount ?? 3, 'Failed request retry attempts'],
        ['mongoDbUrl', config.mongoDbUrl ? '✓' : '—', 'MongoDB connection string'],
        ['gitbookUrl', config.gitbookUrl ? '✓' : '—', 'GitBook documentation base URL'],
      ],
    },
    {
      title: 'Ollama',
      rows: [
        ['ollamaUrl', config.ollamaUrl ?? '—', 'Ollama API endpoint'],
        ['ollamaModel', config.ollamaModel ?? '—', 'Default model for local inference'],
        ['ollamaTimeout', config.ollamaTimeout ?? 30000, 'Request timeout in ms'],
        ['ollamaUpgradeTolerance', config.ollamaUpgradeTolerance ?? 5, 'Model upgrade tolerance threshold'],
      ],
    },
    {
      title: 'AI Providers',
      rows: [
        ['localModels', config.aiProviders?.localModels ?? false, 'Enable Ollama (tools + chat fallback)'],
        ['agenticEnabled', config.aiProviders?.agenticEnabled ?? false, 'Enable multi-step agentic mode'],
        ['agenticMaxIterations', config.aiProviders?.agenticMaxIterations ?? 15, 'Max agentic loop iterations'],
        [
          'codexKey',
          config.aiProviders?.codexKeyEncrypted
            ? '(encrypted)'
            : process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY
              ? '✓'
              : '—',
          'OpenAI / Codex API key status',
        ],
        [
          'claudeKey',
          config.aiProviders?.claudeKeyEncrypted
            ? '(encrypted)'
            : process.env.CLAUDE_CODE_API_KEY || process.env.ANTHROPIC_API_KEY
              ? '✓'
              : '—',
          'Anthropic / Claude API key status',
        ],
        [
          'geminiKey',
          config.aiProviders?.geminiKeyEncrypted
            ? '(encrypted)'
            : process.env.GEMINI_API_KEY
              ? '✓'
              : '—',
          'Google Gemini API key status',
        ],
        ['cursorCli (agent)', isCursorCliAvailable() ? '✓' : '—', 'Cursor CLI availability'],
      ],
    },
    {
      title: 'Chat (CLI)',
      rows: [
        ['useApiKeys', chat.useApiKeys !== false, 'Use API keys when CLI fails'],
      ],
    },
    {
      title: 'GitHub',
      rows: (() => {
        // Auto-detect owner/repo from git remote, fallback to config
        let detectedOwner = config.github?.owner ?? '—';
        let detectedRepo = config.github?.repo ?? '—';
        try {
          const remoteUrl = execSync('git remote get-url origin', { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
          const m = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
          if (m) { detectedOwner = m[1]; detectedRepo = m[2]; }
        } catch { /* git not available or no remote */ }
        return [
          ['enabled', config.github?.enabled ?? false, 'GitHub integration on/off'],
          ['owner', detectedOwner, 'Repository owner (auto-detected from git remote)'],
          ['repo', detectedRepo, 'Repository name (auto-detected from git remote)'],
          ['branch', config.github?.branch ?? '—', 'Default branch'],
          ['private', config.github?.private ?? true, 'Repository visibility'],
        ];
      })(),
    },
    {
      title: 'Monitoring',
      rows: [
        ['enabled', config.monitoring?.enabled ?? false, 'Health monitoring on/off'],
        ['checkInterval', config.monitoring?.checkInterval ?? 300000, 'Check interval in ms'],
      ],
    },
    {
      title: 'Backup',
      rows: [
        ['enabled', config.backup?.enabled ?? true, 'Local backup on/off'],
        ['localPath', config.backup?.localPath ?? '—', 'Backup storage directory'],
        ['maxBackups', config.backup?.maxBackups ?? 10, 'Max backup files to keep'],
        ['retentionHours', config.backup?.retentionHours ?? 168, 'Delete backups older than (hours)'],
        ['compressionEnabled', config.backup?.compressionEnabled ?? true, 'Compress backup archives'],
        ['intervalHours', config.backup?.intervalHours ?? 6, 'Auto-backup interval in hours'],
      ],
    },
    {
      title: 'Scheduler',
      rows: [
        ['enabled', config.scheduler?.enabled ?? false, 'Task scheduler on/off'],
        ['maxConcurrentTasks', config.scheduler?.maxConcurrentTasks ?? 3, 'Parallel task limit'],
        ['taskHistoryRetentionDays', config.scheduler?.taskHistoryRetentionDays ?? 30, 'Keep task history (days)'],
      ],
    },
    {
      title: 'Consciousness',
      rows: [
        ['enabled', config.consciousness?.enabled ?? false, 'Journal & emotion system on/off'],
        ['maxJournalEntries', config.consciousness?.maxJournalEntries ?? 500, 'Max journal entries to keep'],
        ['reflection.maxLength', (config.consciousness as any)?.reflection?.maxLength ?? 200, 'Max reflection text length'],
        ['reflection.maxEntriesInPrompt', (config.consciousness as any)?.reflection?.maxEntriesInPrompt ?? 3, 'Journal entries in AI prompt'],
        ['reflection.style', (config.consciousness as any)?.reflection?.style ?? 'auto', 'Style: auto/emotional/mixed/minimal'],
      ],
    },
    {
      title: 'Self-improvement',
      rows: [
        ['enabled', config.selfImprovement?.enabled ?? false, 'Auto-improvement on/off'],
        ['autoCommit', config.selfImprovement?.autoCommit ?? false, 'Auto-commit improvements'],
        ['requireApproval', config.selfImprovement?.requireApproval ?? true, 'Require human approval'],
        ['maxChangesPerDay', config.selfImprovement?.maxChangesPerDay ?? 10, 'Daily change limit'],
      ],
    },
    {
      title: 'Watch',
      rows: [
        ['enabled', config.watch?.enabled ?? false, 'File watch mode on/off'],
        ['debounceMs', config.watch?.debounceMs ?? 1000, 'Watch debounce delay (ms)'],
      ],
    },
    {
      title: 'Schedule',
      rows: [
        ['enabled', config.scheduler?.enabled ?? false, 'Scheduled mode on/off'],
      ],
    },
    {
      title: 'Assistant',
      rows: [
        ['enabled', (config as any).assistant?.enabled ?? true, 'Assistant context on/off'],
        ['includeTargets', (config as any).assistant?.includeTargets ?? true, 'Include target files in context'],
        ['maxTargetSize', (config as any).assistant?.maxTargetSize ?? 8192, 'Max target file size (bytes)'],
      ],
    },
    {
      title: 'Reactive',
      rows: [
        ['enabled', config.reactive?.enabled ?? false, 'Reactive mode on/off'],
      ],
    },
  ];

  let body = '';
  for (const section of sections) {
    body += `\n  ${chalk.hex(THEME.primary).bold(section.title)}\n`;
    for (const [k, v, desc] of section.rows) {
      const val =
        typeof v === 'boolean'
          ? v
            ? chalk.hex(THEME.success)('true')
            : chalk.hex(THEME.textMuted)('false')
          : typeof v === 'number'
            ? chalk.cyan(String(v))
            : v === '✓'
              ? chalk.hex(THEME.success)('✓')
              : v === '—'
                ? chalk.hex(THEME.textMuted)('—')
                : v === '(encrypted)'
                  ? chalk.hex(THEME.warning)('(encrypted)')
                  : chalk.hex('#F1F2F6')(String(v));
      const valStr = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
      // key is padded to 28, then space, then value — description starts at fixed column
      const VAL_COL = 30; // value column width (pad value to this)
      const pad = Math.max(2, VAL_COL - valStr.length);
      body += `    ${chalk.hex(THEME.textMuted)('›')} ${chalk.hex('#F1F2F6')(k.padEnd(28))} ${val}${' '.repeat(pad)}${chalk.hex(THEME.textMuted)(desc)}\n`;
    }
  }
  const hint = [
    'config set <category> <key> <value>     Toggle/set a setting',
    'config info <category>                  Detailed info about a category',
    'config chat useOllama <on|off>          Ollama in chat',
    'config chat useApiKeys <on|off>         API keys in chat',
    'config yaml                             Show all yaml paths & types',
    'config yaml set <path> <value>          Edit config.yaml directly',
    'Categories: general | ollama | ai | chat | github | monitoring | backup',
    '            scheduler | consciousness | self | watch | schedule',
    '            assistant | reactive',
  ].join('\n');
  console.log(renderListBox('Config', body, hint, 'config'));
}

async function runSettingsChatUseOllama(value: string): Promise<void> {
  const { setChatSettings } = await import('../src/utils/chatSettings.js');
  const on = value?.toLowerCase() === 'on' || value?.toLowerCase() === 'true' || value === '1';
  const next = setChatSettings({ useOllamaInChat: on });
  console.log(
    renderTextMenu(
      'Config',
      `  ${chalk.hex(THEME.success)('✓')} Chat Ollama: ${next.useOllamaInChat ? chalk.hex(THEME.success)('on') : chalk.hex(THEME.textMuted)('off')}`,
      undefined,
      'config',
    ),
  );
}

async function runSettingsChatUseApiKeys(value: string): Promise<void> {
  const { setChatSettings } = await import('../src/utils/chatSettings.js');
  const on = value?.toLowerCase() === 'on' || value?.toLowerCase() === 'true' || value === '1';
  const next = setChatSettings({ useApiKeys: on });
  console.log(
    renderTextMenu(
      'Config',
      `  ${chalk.hex(THEME.success)('✓')} Chat API keys: ${next.useApiKeys !== false ? chalk.hex(THEME.success)('on') : chalk.hex(THEME.textMuted)('off')}`,
      undefined,
      'config',
    ),
  );
}

const SETTINGS_CONFIG_MAP: Record<string, Record<string, string>> = {
  general: { logLevel: 'logLevel', cacheTtl: 'cacheTtl', retryCount: 'retryCount' },
  ollama: { model: 'ollamaModel', timeout: 'ollamaTimeout', upgradeTolerance: 'ollamaUpgradeTolerance' },
  ai: {
    localModels: 'aiProviders.localModels',
    agenticEnabled: 'aiProviders.agenticEnabled',
    agenticMaxIterations: 'aiProviders.agenticMaxIterations',
  },
  github: { enabled: 'github.enabled', private: 'github.private' },
  monitoring: { enabled: 'monitoring.enabled', checkInterval: 'monitoring.checkInterval' },
  backup: { enabled: 'backup.enabled', maxBackups: 'backup.maxBackups', retentionHours: 'backup.retentionHours', compressionEnabled: 'backup.compressionEnabled', intervalHours: 'backup.intervalHours' },
  scheduler: { enabled: 'scheduler.enabled' },
  consciousness: { enabled: 'consciousness.enabled', maxJournalEntries: 'consciousness.maxJournalEntries' },
  self: { enabled: 'selfImprovement.enabled' },
  watch: { enabled: 'watch.enabled', debounceMs: 'watch.debounceMs' },
  schedule: { enabled: 'schedule.enabled', cron: 'schedule.cron', interval: 'schedule.interval' },
  assistant: { enabled: 'assistant.enabled', includeTargets: 'assistant.includeTargets', maxTargetSize: 'assistant.maxTargetSize' },
  reactive: { enabled: 'reactive.enabled' },
};

async function runSettingsSet(category: string, key: string, value: string): Promise<void> {
  if (category === 'chat') {
    if (key === 'useOllama') return runSettingsChatUseOllama(value);
    if (key === 'useApiKeys') return runSettingsChatUseApiKeys(value);
    console.log(
      renderTextMenu(
        'Config Error',
        `  ${chalk.hex(THEME.error)('✗')} Unknown chat key: ${key}. Use useOllama or useApiKeys.`,
        undefined,
        'config',
      ),
    );
    process.exitCode = 1;
    return;
  }

  const configPath = SETTINGS_CONFIG_MAP[category]?.[key];
  if (!configPath) {
    console.log(
      renderTextMenu(
        'Config Error',
        `  ${chalk.hex(THEME.error)('✗')} Unknown: ${category} ${key}. Use 'hakanmcp config' to list.`,
        undefined,
        'config',
      ),
    );
    process.exitCode = 1;
    return;
  }

  const lower = value?.toLowerCase();
  const isBooleanValue = ['on', 'off', 'true', 'false', '1', '0'].includes(lower);
  let valStr: string;
  if (isBooleanValue) {
    valStr = (lower === 'on' || lower === 'true' || lower === '1') ? 'true' : 'false';
  } else {
    valStr = value;
  }

  await runConfigSet(configPath, valStr);
}

const CONFIG_INFO: Record<string, { title: string; description: string }> = {
  general: {
    title: 'General',
    description: [
      'Core server settings that affect the entire HakanMCP instance.',
      '',
      'serverName    Unique identifier for this MCP server instance. Used in logs,',
      '              backup filenames, and multi-server scenarios to distinguish',
      '              this instance from others.',
      '',
      'logLevel      Controls log verbosity. Options: debug | info | warn | error.',
      '              "debug" logs every tool call, AI request, and internal state.',
      '              "info" logs major operations and results.',
      '              "warn" and "error" only log problems.',
      '',
      'cacheTtl      How long (seconds) cached results are valid before re-fetching.',
      '              Applies to tool responses, config lookups, and provider status.',
      '              Lower values = fresher data, higher values = fewer API calls.',
      '',
      'retryCount    Number of retry attempts when an operation fails (network errors,',
      '              timeouts, transient API failures). Each retry uses exponential',
      '              backoff. Set to 0 to disable retries.',
    ].join('\n'),
  },
  ollama: {
    title: 'Ollama',
    description: [
      'Local LLM inference via Ollama. Used as a fallback provider or primary',
      'when no API keys are configured.',
      '',
      'ollamaUrl             Ollama API endpoint. Default: http://localhost:11434.',
      '                      Change if running Ollama on a remote machine or',
      '                      different port.',
      '',
      'ollamaModel           Default model for local inference (e.g., llama3,',
      '                      qwen3, mistral). Must be pulled first: ollama pull <model>.',
      '',
      'ollamaTimeout         Request timeout in milliseconds. Increase for slower',
      '                      hardware or larger models. Default: 36000000 (10 hours).',
      '',
      'ollamaUpgradeTolerance  Controls automatic model upgrades. When a newer model',
      '                      version is available, upgrades if the quality difference',
      '                      exceeds this threshold (0-1). Set to 0 for always upgrade.',
    ].join('\n'),
  },
  ai: {
    title: 'AI Providers',
    description: [
      'Controls how HakanMCP routes AI requests across multiple providers.',
      '',
      'localModels           Enable/disable Ollama as a provider. When true, local',
      '                      models are included in the fallback chain.',
      '',
      'agenticEnabled        Enable multi-step agentic mode. When true, the AI can',
      '                      chain multiple tool calls in a single conversation turn',
      '                      (analyze → act → validate loop).',
      '',
      'agenticMaxIterations  Maximum tool-call iterations per agentic turn.',
      '                      Prevents runaway loops. Default: 15.',
      '',
      'codexKeyEncrypted     Encrypted OpenAI API key (decrypted at runtime with',
      'claudeKeyEncrypted    AI_KEY_PASSWORD env var). Use "config set ai',
      'geminiKeyEncrypted    <provider>KeyEncrypted <value>" to store.',
      '',
      'encryptionPasswordEnv  Name of the env var holding the decryption password.',
      '                      Default: AI_KEY_PASSWORD.',
    ].join('\n'),
  },
  chat: {
    title: 'Chat (CLI)',
    description: [
      'Settings specific to the interactive chat session (hakanmcp chat).',
      '',
      'useApiKeys            When true, API keys (Codex/Claude/Gemini) are used',
      '                      as fallback when CLI providers fail. If you only want',
      '                      CLI-based access, set to off.',
      '                      Toggle: config chat useApiKeys on|off',
      '',
      'NOTE: Ollama usage in chat is now controlled by aiProviders.localModels.',
      'When localModels=true, Ollama is available as a fallback in both MCP',
      'tools and interactive chat.',
    ].join('\n'),
  },
  github: {
    title: 'GitHub',
    description: [
      'GitHub integration for repository management and sync.',
      '',
      'enabled               Master switch for GitHub integration. When false, no',
      '                      GitHub operations occur regardless of other settings.',
      '',
      'owner / repo          Target GitHub repository. Auto-detected from git remote',
      '                      origin URL. Set manually only to override auto-detection.',
      '',
      'branch                Default branch for sync. Default: main.',
      '',
      'private               Repository visibility. When true, creates/maintains',
      '                      a private repository.',
    ].join('\n'),
  },
  monitoring: {
    title: 'Monitoring',
    description: [
      'Health monitoring system that watches server state via Guardian loop.',
      '',
      'enabled               Master switch for health monitoring. When enabled,',
      '                      the server periodically checks its own health status.',
      '',
      'checkInterval         Milliseconds between health checks. Default: 300000 (5 min).',
      '                      Lower values catch issues faster but use more resources.',
      '',
      'peerInstance          Path to peer MCP instance for Guardian sync.',
      '                      Usually "/peer" in Docker. Env override: MONITORING_PEER_INSTANCE.',
      '',
      'healthCheckEndpoints  Array of health check endpoint definitions.',
      '                      Each entry has type, path, and description fields.',
    ].join('\n'),
  },
  backup: {
    title: 'Backup',
    description: [
      'Automatic local backup system for project data and configuration.',
      '',
      'enabled               Master switch. When true, backups run automatically',
      '                      at the configured interval.',
      '',
      'localPath             Directory where backup archives are stored.',
      '                      Relative to project root. Default: ./backups.',
      '',
      'maxBackups            Maximum number of backup files to keep. Oldest backups',
      '                      are deleted when this limit is reached.',
      '',
      'retentionHours        Delete backups older than this many hours, regardless',
      '                      of maxBackups limit.',
      '',
      'compressionEnabled    Compress backup archives with gzip. Reduces storage',
      '                      at the cost of slightly slower backup/restore.',
      '',
      'intervalHours         Hours between automatic backup runs.',
    ].join('\n'),
  },
  scheduler: {
    title: 'Scheduler',
    description: [
      'Task scheduler for running deferred and periodic operations.',
      '',
      'enabled               Master switch. When true, the scheduler accepts and',
      '                      executes scheduled tasks via MCP tools.',
      '',
      'maxConcurrentTasks    Maximum number of tasks that can run in parallel.',
      '                      Higher values use more resources. Default: 3.',
      '',
      'taskHistoryRetentionDays  Number of days to keep completed task history.',
      '                      Older records are automatically pruned. Default: 30.',
      '',
      'persistencePath       File path for scheduler state persistence.',
      '                      Default: ./scheduler-state.json.',
    ].join('\n'),
  },
  consciousness: {
    title: 'Consciousness',
    description: [
      'AI journaling and emotional state system. Tracks emotions, generates',
      'structured journal entries, and dynamically shifts character traits.',
      '',
      'enabled               Master switch. When true, the consciousness system',
      '                      is active: emotions are tracked, journal entries',
      '                      are generated, and character traits dynamically',
      '                      shift based on emotional state.',
      '                      When false, chat runs without emotional context.',
      '',
      'maxJournalEntries     Maximum journal entries to keep in journal.jsonl.',
      '                      Oldest entries are pruned when limit is reached.',
      '',
      'reflection.maxLength  Maximum character length for generated reflections.',
      '                      Default: 200.',
      '',
      'reflection.maxEntriesInPrompt  Number of recent journal entries included',
      '                      as context for new reflections. Default: 3.',
      '',
      'reflection.style      Journal generation style: auto | emotional | mixed | minimal.',
      '                      "auto" adapts based on current emotional state.',
      '                      "minimal" produces brief factual entries.',
      '',
      'Journal entries are event-driven: session start/end, errors, milestones,',
      'and every 25 messages (checkpoint). Character traits shift dynamically',
      'based on emotions (frustration, curiosity, energy, focus).',
    ].join('\n'),
  },
  self: {
    title: 'Self-improvement',
    description: [
      'AI-driven code improvement system. Propose → approve → apply workflow',
      'with safety constraints.',
      '',
      'enabled               Master switch. When true, self-improvement MCP',
      '                      tools are available for AI assistants.',
      '',
      'autoCommit            Auto-commit changes after successful apply.',
      '                      Default: false (manual commit required).',
      '',
      'requireApproval       Require explicit approval before applying.',
      '                      Default: true (recommended for safety).',
      '',
      'maxChangesPerDay      Maximum changes allowed per day. Default: 10.',
      '                      Prevents runaway self-modification.',
      '',
      'allowedOperations     Whitelist: optimize, refactor, fix, test, docs.',
      '',
      'restrictedPaths       Paths that can never be modified.',
      '                      Default: node_modules, .git, dist, .env.',
    ].join('\n'),
  },
  watch: {
    title: 'Watch',
    description: [
      'File watch mode — monitors filesystem changes and triggers AI actions.',
      '',
      'When enabled, HakanMCP watches specified paths for file changes and',
      'automatically runs configured actions (e.g., lint, test, analyze) when',
      'files are modified, created, or deleted.',
      '',
      'enabled               Master switch for watch mode.',
      '',
      'paths                 Glob patterns for files/directories to watch.',
      '                      Example: ["src/**/*.ts", "tests/**/*.ts"]',
      '',
      'debounceMs            Milliseconds to wait after a change before triggering.',
      '                      Prevents rapid-fire actions during batch saves.',
      '                      Default: 1000.',
      '',
      'NOTE: Watch mode is configured per-workspace via hakanmcp.config.yaml,',
      'not the global config.yaml. Use "hakanmcp watch" to start watch mode.',
    ].join('\n'),
  },
  schedule: {
    title: 'Schedule',
    description: [
      'Scheduled mode — runs AI actions on a time-based schedule.',
      '',
      'When enabled, HakanMCP executes configured actions at specified intervals',
      'or cron schedules. Useful for periodic health checks, code analysis,',
      'or automated maintenance tasks.',
      '',
      'enabled               Master switch for scheduled mode.',
      '',
      'cron                  Cron expression for scheduling. Uses standard cron',
      '                      syntax (e.g., "0 */6 * * *" for every 6 hours).',
      '',
      'interval              Human-readable interval (e.g., "every 30m", "every 2h").',
      '                      Alternative to cron for simpler scheduling.',
      '',
      'NOTE: Configured per-workspace via hakanmcp.config.yaml.',
      'Use "hakanmcp scheduled" to start scheduled mode.',
    ].join('\n'),
  },
  assistant: {
    title: 'Assistant',
    description: [
      'Assistant context injection — controls what project context is included',
      'when AI assistants interact with the MCP server.',
      '',
      'enabled               Master switch. When true, the MCP server includes',
      '                      relevant project files as context in tool responses.',
      '                      When false, tools return raw results without context.',
      '',
      'includeTargets        When true, includes target file contents in tool',
      '                      context (e.g., the file being analyzed or modified).',
      '',
      'maxTargetSize         Maximum file size (bytes) for included targets.',
      '                      Files larger than this are excluded from context.',
      '                      Default: 8192 (8 KB).',
      '',
      'NOTE: Configured per-workspace via hakanmcp.config.yaml.',
    ].join('\n'),
  },
  reactive: {
    title: 'Reactive',
    description: [
      'Reactive mode — combines watch + scheduled modes into a unified',
      'event-driven system.',
      '',
      'When enabled, HakanMCP reacts to both filesystem events (watch) and',
      'time-based triggers (schedule) in a single process. This is the',
      'recommended mode for production use instead of running watch and',
      'scheduled separately.',
      '',
      'enabled               Master switch for reactive mode.',
      '',
      'modes                 Array of reactive mode configurations, each',
      '                      specifying triggers (file changes, timers) and',
      '                      actions to execute.',
      '',
      'NOTE: Configured per-workspace via hakanmcp.config.yaml.',
      'Use "hakanmcp reactive" to start reactive mode.',
    ].join('\n'),
  },
  system: {
    title: 'System',
    description: [
      'System-level security and execution constraints.',
      '',
      'allowedPaths          Path allowlist for fs_* and sys_runCommand tools.',
      '                      When set, all file/command paths must resolve under',
      '                      one of these directories. Empty array = allow all.',
      '',
      'commandTimeout        Default timeout in seconds for command execution.',
      '                      Range: 5–3600. Default: 120.',
    ].join('\n'),
  },
};

function runConfigInfo(category?: string): void {
  if (!category) {
    const cats = Object.keys(CONFIG_INFO).map((k) => `  ${chalk.hex('#F1F2F6')(k.padEnd(18))} ${chalk.hex(THEME.textMuted)(CONFIG_INFO[k].title)}`).join('\n');
    const body = `\n  Available categories:\n\n${cats}\n`;
    const hint = 'config info <category>     Show detailed info for a category';
    console.log(renderListBox('Config Info', body, hint, 'config'));
    return;
  }
  const key = category.toLowerCase();
  const info = CONFIG_INFO[key];
  if (!info) {
    const closest = Object.keys(CONFIG_INFO).find((k) => k.startsWith(key));
    console.log(
      renderTextMenu(
        'Config Info',
        `  ${chalk.hex(THEME.error)('✗')} Unknown category: ${category}${closest ? `. Did you mean ${chalk.bold.white(closest)}?` : ''}`,
        'config info     List all categories',
        'config',
      ),
    );
    process.exitCode = 1;
    return;
  }
  const lines = info.description.split('\n').map((l) => `  ${chalk.hex('#F1F2F6')(l)}`).join('\n');
  const body = `\n${lines}\n`;
  const hint = [
    `config set ${key} <key> <value>     Change a ${info.title} setting`,
    'config info                        List all categories',
  ].join('\n');
  console.log(renderListBox(`Config Info: ${info.title}`, body, hint, 'config'));
}

async function runChat(verbose: boolean): Promise<void> {
  const chatPath = requireBuild('console_chat.js');
  process.argv = ['node', ...(verbose ? ['--detailed'] : [])];
  await import(pathToFileURL(chatPath).href);
}

// ─── Main ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  ensureProjectRoot();
  await loadDotenv();

  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const version = pkg.version || '0.0.0';

  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('-'));
  const hasHelpOrVersion = argv.some((a) => ['-h', '--help', '-V', '--version'].includes(a));
  const quiet = process.env.HAKANMCP_QUIET === '1';

  const goingToChat = !hasHelpOrVersion && positional.length === 0;

  if (goingToChat) {
    const { startWarmup } = await import('../src/services/aiProviderWarmup.js');
    startWarmup(PROJECT_ROOT);
    if (!quiet) {
      await renderChatHeaderAnimated();
    }
    const verbose = argv.includes('--verbose');
    await runChat(verbose);
    return;
  }

  if (!quiet) {
    clearScreen();
  }

  const program = new Command();

  let outputShown = false;
  program.configureOutput({
    writeOut: (_str) => {
      if (outputShown) return;
      outputShown = true;
      runHelp();
    },
    writeErr: (str) => {
      if (outputShown) return;
      outputShown = true;
      const raw = str.trim();
      // Rewrite Commander's "error: unknown command 'X'" into a friendlier message
      const unknownMatch = raw.match(/^error:\s*unknown command '([^']+)'/i);
      if (unknownMatch) {
        const typed = unknownMatch[1];
        const knownCmds = ['doctor', 'health', 'tools', 'status', 'journal',
          'providers', 'backup', 'config', 'help', 'logs', 'ralph',
          'init', 'start', 'stop', 'mission', 'report', 'watch', 'scheduled', 'reactive'];
        const suggestion = knownCmds.find(
          (cmd) => cmd.startsWith(typed) || typed.startsWith(cmd),
        );
        const msg = suggestion
          ? `Unknown command '${typed}'. Did you mean '${suggestion}'?`
          : `Unknown command '${typed}'. Run 'hakanmcp help' for available commands.`;
        process.stderr.write(renderTextMenu('Error', msg, undefined, 'help') + '\n');
      } else {
        process.stderr.write(renderTextMenu('Error', raw, undefined, 'help') + '\n');
      }
    },
  });
  program.exitOverride();
  program.showHelpAfterError(false);
  program.showSuggestionAfterError(false);

  program
    .name('hakanmcp')
    .description('hakan-mcp Premium CLI')
    .version(version)
    .option('--verbose', 'Chat: debug/detailed mode');

  const doctorCmd = program.command('doctor').description('System health check & auto-repair');
  doctorCmd.command('fix').description('Auto-repair detected issues').action(() => runDoctor(true));
  doctorCmd.action(() => runDoctor(false));
  program.command('health').description('Alias for doctor (system health check)').action(() => runDoctor(false));
  program.command('tools').description('List all registered MCP tools').action(runTools);

  program.command('status').description('Status board').action(runStatus);

  const backupCmd = program.command('backup').description('Backup info & management');
  backupCmd.command('run').description('Force create a backup now').action(runBackupRun);
  backupCmd.action(runBackupInfo);

  const configCmd = program.command('config').description('Configuration & settings');
  configCmd.action(runSettings);
  const yamlCmd = configCmd.command('yaml').description('View/edit config.yaml');
  yamlCmd.command('help').description('Show all config.yaml paths & types').action(runConfigYamlHelp);
  yamlCmd
    .command('set <path> <value>')
    .description('Update config.yaml (Zod-validated)')
    .action(runConfigSet);
  yamlCmd.action(runConfigYamlHelp);
  const configChatCmd = configCmd.command('chat').description('Chat-specific settings');
  configChatCmd
    .command('useOllama <on|off>')
    .description('Use Ollama fallback in CLI chat (on/off)')
    .action((val: string) => runSettingsChatUseOllama(val));
  configChatCmd
    .command('useApiKeys <on|off>')
    .description('Use API keys (Codex/Gemini/Claude) in CLI chat when CLI fails (on/off)')
    .action((val: string) => runSettingsChatUseApiKeys(val));
  configCmd
    .command('info [category]')
    .description('Detailed info about a config category')
    .action((cat?: string) => runConfigInfo(cat));
  configCmd
    .command('set <category> <key> <value>')
    .description(
      'Set a setting (category: general|ollama|ai|github|monitoring|backup|scheduler|consciousness|self|chat)',
    )
    .action((cat: string, key: string, val: string) => runSettingsSet(cat, key, val));

  const logsCmd = program.command('logs').description('Log overview, browse and tail');
  logsCmd
    .command('tail <name>')
    .description('Tail latest file in area or show root file')
    .action((name: string) => runLogsTail(name));
  logsCmd
    .command('show <area> <file>')
    .description('Show specific file in area')
    .action((area: string, file: string) => runLogsShowFile(area, file));
  logsCmd
    .command('open <name> [file]')
    .description('Browse area or open file: logs open console | logs open console journal')
    .action((name: string, file?: string) => file ? runLogsShowFile(name, file) : runLogsNavigate(name));
  logsCmd.action(() => runLogsOverview());

  program
    .command('help', { hidden: true })
    .description('Show help screen')
    .action(() => {
      runHelp();
    });

  const journalCmd = program
    .command('journal [count]')
    .description('Show consciousness journal timeline')
    .action((count: string) => {
      if (count === 'reset') return runJournalReset();
      return runJournal(count);
    });
  journalCmd
    .command('reset')
    .description('Clear journal entries & reset emotions to defaults')
    .action(() => runJournalReset());


  const providerCmd = program
    .command('providers')
    .description('AI provider status, limits, versions and updates');
  providerCmd
    .command('status')
    .description('Show when each provider cooldown resets')
    .action(runProviderStatus);
  providerCmd
    .command('reset [target] [provider]')
    .description('Reset cooldowns/usage  ·  reset | reset api [provider] | reset cli [provider] | reset apiusage [provider] | reset cliusage [provider]')
    .action(runProviderReset);
  providerCmd
    .command('set <type> <args...>')
    .description('Set limits or ollama config  ·  providers set api daily 50  ·  providers set ollama status enabled  ·  providers set ollama default qwen3')
    .action(runProviderSet);
  providerCmd
    .command('update [provider]')
    .description('Update CLI tools & Ollama models  ·  providers update | providers update ollama | providers update codex')
    .action(runProviderUpdate);
  providerCmd.action(runProviderStatus);

  // ─── Ralph Loop Dashboard & Management ─────────────────────────────

  const RALPH_DIR = path.join(PROJECT_ROOT, 'logs', 'ralph');

  interface RalphLoopState {
    id: string;
    pid: number;
    startedAt: string;
    mode: 'apply' | 'dry-run';
    iterations: { current: number; max: number };
    status: 'running' | 'completed' | 'failed' | 'stopped';
    lastUpdate: string;
    results: string[];
    error: string | null;
    timeoutMs: number;
  }

  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  function isProcessAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  function readLoopStates(): RalphLoopState[] {
    if (!fs.existsSync(RALPH_DIR)) return [];
    const files = fs.readdirSync(RALPH_DIR).filter((f) => f.endsWith('.json'));
    const states: RalphLoopState[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(RALPH_DIR, file), 'utf-8');
        const state: RalphLoopState = JSON.parse(raw);
        if (state.status === 'running' && state.pid > 0 && !isProcessAlive(state.pid)) {
          state.status = 'stopped';
          state.lastUpdate = new Date().toISOString();
          writeLoopState(state);
        }
        states.push(state);
      } catch { /* skip corrupt files */ }
    }
    states.sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime());
    return states;
  }

  function writeLoopState(state: RalphLoopState): void {
    fs.mkdirSync(RALPH_DIR, { recursive: true });
    fs.writeFileSync(path.join(RALPH_DIR, `loop-${state.id}.json`), JSON.stringify(state, null, 2));
  }

  function formatAge(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function runRalphOverview(): void {
    const states = readLoopStates();
    const statusIcons: Record<string, string> = {
      running: chalk.hex(THEME.success)('◆'),
      completed: chalk.hex(THEME.primary)('◆'),
      failed: chalk.hex(THEME.error)('◆'),
      stopped: chalk.hex(THEME.textDim)('◆'),
    };
    let body = '';
    if (states.length > 0) {
      body += `  ${chalk.bold('Active Loops')}\n\n`;
      for (const s of states) {
        const icon = statusIcons[s.status] || '◆';
        const idShort = `#${s.id.slice(0, 7)}..`;
        const iter = `${s.iterations.current}/${s.iterations.max} iter`;
        const statusColor = s.status === 'running' ? THEME.success
          : s.status === 'completed' ? THEME.primary
          : s.status === 'failed' ? THEME.error : THEME.textDim;
        let timeLeft = '';
        if (s.status === 'running' && s.timeoutMs) {
          const elapsed = Date.now() - new Date(s.startedAt).getTime();
          const remaining = Math.max(0, s.timeoutMs - elapsed);
          const remMin = Math.ceil(remaining / 60000);
          timeLeft = remaining > 0 ? `  (${remMin}m left)` : `  (expired)`;
        }
        body += `    ${icon} ${chalk.hex(THEME.textMuted)(idShort.padEnd(12))}` +
          `${s.mode.padEnd(10)}${iter.padEnd(12)}` +
          `${chalk.hex(statusColor)(s.status.padEnd(14))}${chalk.hex(THEME.textMuted)(formatAge(s.lastUpdate) + timeLeft)}\n`;
      }
    } else {
      body += `  ${chalk.hex(THEME.textMuted)('No loops yet.')}\n`;
    }
    const hint = [
      'ralph                    Show dashboard',
      'ralph start              Start new loop',
      'ralph start --dry-run    Report only, no changes',
      'ralph start -n <count>   Max iterations (default 5)',
      'ralph start -t <min>     Timeout in minutes (default 10)',
      'ralph stop <id>          Stop a running loop',
      'ralph log <id>           Show loop output',
    ].join('\n');
    console.log(renderListBox('Ralph', body, hint, 'ralph'));
  }

  function runRalphStart(opts: { dryRun?: boolean; iterations?: string; timeout?: string }): void {
    fs.mkdirSync(RALPH_DIR, { recursive: true });
    const mode: 'apply' | 'dry-run' = opts.dryRun ? 'dry-run' : 'apply';
    const maxIter = Math.min(10, Math.max(1, parseInt(opts.iterations || '5', 10) || 5));
    const timeoutMin = Math.max(1, parseInt(opts.timeout || '10', 10) || 10);
    const id = Date.now().toString();
    const state: RalphLoopState = {
      id,
      pid: 0,
      startedAt: new Date().toISOString(),
      mode,
      iterations: { current: 0, max: maxIter },
      status: 'running',
      lastUpdate: new Date().toISOString(),
      results: [],
      error: null,
      timeoutMs: timeoutMin * 60 * 1000,
    };
    writeLoopState(state);
    const child = spawn(process.execPath, [
      path.join(PROJECT_ROOT, 'dist', 'bin', 'hakanmcp.js'),
      'ralph', '_worker', id,
    ], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, HAKANMCP_PROJECT_ROOT: PROJECT_ROOT },
    });
    if (child.pid) {
      state.pid = child.pid;
      writeLoopState(state);
    }
    child.unref();
    console.log(`  ${chalk.hex(THEME.success)('✓')} Ralph loop ${chalk.bold('#' + id)} started (${mode}, ${maxIter} iterations, ${timeoutMin}m timeout)`);
  }

  async function runRalphWorker(id: string): Promise<void> {
    process.env.HAKANMCP_PROJECT_ROOT = process.env.HAKANMCP_PROJECT_ROOT || PROJECT_ROOT;
    const stateFile = path.join(RALPH_DIR, `loop-${id}.json`);
    if (!fs.existsSync(stateFile)) { process.exit(1); }
    let state: RalphLoopState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const ITER_TIMEOUT = 3 * 60 * 1000; // 3 min per iteration
    const deadline = Date.now() + (state.timeoutMs || 10 * 60 * 1000);
    const donePatterns = [/FINALIZE/i, /^Blocked:/m, /NO_CHANGES_NEEDED/i, /^DONE$/m];
    try {
      const mod = await import(
        pathToFileURL(path.join(PROJECT_ROOT, 'dist', 'src', 'tools', 'aiTools.js')).href
      );
      const tool = mod.aiTools.find((t: { name: string }) => t.name === 'ai_chat');
      if (!tool) throw new Error('ai_chat tool not found');
      const dryRun = state.mode === 'dry-run';
      let consecutiveTimeouts = 0;
      for (let i = 0; i < state.iterations.max; i++) {
        // Total deadline check
        if (Date.now() >= deadline) {
          state.status = 'failed';
          state.error = `Total timeout exceeded (${Math.round((state.timeoutMs || 600000) / 60000)}m)`;
          state.lastUpdate = new Date().toISOString();
          writeLoopState(state);
          break;
        }
        let result: any;
        try {
          result = await withTimeout(
            tool.handler({
              message: `Ralph loop iteration ${i + 1}/${state.iterations.max}. Review project state and suggest improvements.${dryRun ? ' (dry run - do not apply changes)' : ''}`,
            }),
            ITER_TIMEOUT,
            `iteration ${i + 1}`,
          );
          consecutiveTimeouts = 0;
        } catch (timeoutErr: unknown) {
          const errMsg = timeoutErr instanceof Error ? timeoutErr.message : String(timeoutErr);
          if (errMsg.startsWith('Timeout:')) {
            consecutiveTimeouts++;
            state.iterations.current = i + 1;
            state.lastUpdate = new Date().toISOString();
            state.results.push(`--- Iteration ${i + 1} ---\n[TIMEOUT] ${errMsg}`);
            writeLoopState(state);
            if (consecutiveTimeouts >= 2) {
              state.status = 'failed';
              state.error = `2 consecutive iteration timeouts`;
              state.lastUpdate = new Date().toISOString();
              writeLoopState(state);
              break;
            }
            continue;
          }
          throw timeoutErr;
        }
        const text = result?.content?.[0]?.text ?? '';
        state.iterations.current = i + 1;
        state.lastUpdate = new Date().toISOString();
        if (result?.isError) {
          state.results.push(`--- Iteration ${i + 1} ---\n[ERROR] ${text}`);
          state.status = 'failed';
          state.error = text;
          writeLoopState(state);
          process.exit(1);
        }
        state.results.push(`--- Iteration ${i + 1} ---\n${text}`);
        writeLoopState(state);
        if (donePatterns.some((p) => p.test(text))) {
          state.status = 'completed';
          state.lastUpdate = new Date().toISOString();
          writeLoopState(state);
          break;
        }
      }
      if (state.status === 'running') {
        state.status = 'completed';
        state.lastUpdate = new Date().toISOString();
        writeLoopState(state);
      }
    } catch (err: unknown) {
      state.status = 'failed';
      state.error = err instanceof Error ? err.message : String(err);
      state.lastUpdate = new Date().toISOString();
      writeLoopState(state);
    }
    process.exit(0);
  }

  function runRalphStop(id: string): void {
    const stateFile = path.join(RALPH_DIR, `loop-${id}.json`);
    if (!fs.existsSync(stateFile)) {
      console.log(`  ${chalk.hex(THEME.error)('✗')} Loop #${id} not found`);
      return;
    }
    const state: RalphLoopState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    if (state.status !== 'running') {
      console.log(`  ${chalk.hex(THEME.warning)('!')} Loop #${id} is not running (status: ${state.status})`);
      return;
    }
    try { process.kill(state.pid, 'SIGTERM'); } catch { /* already dead */ }
    state.status = 'stopped';
    state.lastUpdate = new Date().toISOString();
    writeLoopState(state);
    console.log(`  ${chalk.hex(THEME.success)('✓')} Loop #${id} stopped`);
  }

  function runRalphLog(id: string): void {
    const states = readLoopStates();
    const match = states.find((s) => s.id === id || s.id.startsWith(id));
    if (!match) {
      console.log(`  ${chalk.hex(THEME.error)('✗')} Loop #${id} not found`);
      return;
    }
    if (match.results.length === 0) {
      console.log(renderTextMenu('Ralph Log', `  ${chalk.hex(THEME.textMuted)('No output yet for loop #' + match.id)}`, undefined, 'ralph'));
      return;
    }
    let body = `  Loop ${chalk.bold('#' + match.id)}  ·  ${match.mode}  ·  ${match.status}\n\n`;
    body += match.results.join('\n\n');
    if (match.error) {
      body += `\n\n  ${chalk.hex(THEME.error)('Error:')} ${match.error}`;
    }
    console.log(renderTextMenu('Ralph Log', body, undefined, 'ralph'));
  }

  const ralphCmd = program.command('ralph').description('Ralph Loop dashboard');
  ralphCmd.command('start')
    .option('--dry-run', 'Only report, do not apply changes')
    .option('-n, --iterations <n>', 'Max iterations (default 5)', '5')
    .option('-t, --timeout <minutes>', 'Total timeout in minutes (default 10)', '10')
    .action((opts) => runRalphStart(opts));
  ralphCmd.command('stop <id>').description('Stop a running loop').action((id) => runRalphStop(id));
  ralphCmd.command('log <id>').description('Show loop output').action((id) => runRalphLog(id));
  ralphCmd.command('_worker <id>').action((id) => runRalphWorker(id));
  ralphCmd.action(() => runRalphOverview());

  // Mission Agent Commands
  program.command('init')
    .description('Interactive workspace & mission setup')
    .option('--force', 'Overwrite existing config/workspace')
    .option('--remove <name>', 'Remove a workspace')
    .action(runInit);

  program.command('start')
    .description('Start mission agent')
    .option('--daemon', 'Run in background')
    .option('--mission <file>', 'Mission file path', 'PRIMARY_MISSION.md')
    .option('--workspace <name>', 'Run specific workspace')
    .option('--all', 'Run all workspaces')
    .option('--parallel', 'Run workspaces in parallel (use with --all)')
    .action(runStart);

  program.command('stop')
    .description('Stop running mission agent')
    .action(runStop);

  program.command('mission')
    .description('Show current mission status')
    .option('--workspace <name>', 'Show specific workspace status')
    .option('--all', 'Show all workspaces status')
    .action(runMission);

  program.command('report')
    .description('Show recent reports')
    .option('-n <count>', 'Number of reports to show', '5')
    .action(runReport);

  program.command('watch')
    .description('Start file watcher for automatic actions')
    .action(runWatch);

  const scheduledCmd = program.command('scheduled').description('Scheduled tasks dashboard & management');
  scheduledCmd.command('start').description('Start scheduled mode (cron/interval)').action(async () => { await runScheduled(); });
  scheduledCmd.command('list').description('List all scheduler tasks').action(async () => { await runScheduledDashboard(); });
  scheduledCmd.command('add <name> <cron> <task>').description('Add a new scheduled task').action(async (name: string, cronExpr: string, task: string) => { await runScheduledAdd(name, cronExpr, task); });
  scheduledCmd.command('remove <id>').description('Remove a scheduled task').action(async (id: string) => { await runScheduledRemove(id); });
  scheduledCmd.command('pause <id>').description('Pause a scheduled task').action(async (id: string) => { await runScheduledToggle(id, false); });
  scheduledCmd.command('resume <id>').description('Resume a paused task').action(async (id: string) => { await runScheduledToggle(id, true); });
  scheduledCmd.action(async () => { await runScheduledDashboard(); });

  program.command('reactive')
    .description('Start reactive mode — watch + scheduled combined')
    .action(runReactive);

  // Display commands: render output then fall through to chat REPL
  const displayCommands = ['doctor', 'health', 'tools', 'status', 'journal', 'providers', 'backup', 'config', 'help', 'logs', 'ralph', 'scheduled'];
  // Action commands: run and exit (no chat fallthrough)
  const actionCommands: string[] = ['init', 'start', 'stop', 'mission', 'report', 'watch', 'scheduled', 'reactive'];

  const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const invokedCmd = positionalArgs[0] || '';
  const hasSubArg = positionalArgs.length > 1; // e.g. "backup run", "config set"
  // Commands that stay in chat even with sub-args (e.g. "backup run")
  const alwaysDisplayCmds = ['backup', 'logs', 'ralph', 'doctor', 'scheduled'];
  const isDisplayCmd = displayCommands.includes(invokedCmd) && (!hasSubArg || alwaysDisplayCmds.includes(invokedCmd));
  const isActionCmd = actionCommands.includes(invokedCmd) || (displayCommands.includes(invokedCmd) && hasSubArg && !alwaysDisplayCmds.includes(invokedCmd));

  try {
    await program.parseAsync();
  } catch (err: unknown) {
    // Commander exitOverride throws CommanderError — already rendered via writeErr
    if (err && typeof err === 'object' && 'exitCode' in err) {
      process.exit((err as { exitCode: number }).exitCode);
    }
    throw err;
  }

  if (isDisplayCmd && !isEmbedOutput()) {
    // Display command finished rendering → drop into chat REPL (no header animation)
    await runChat(false);
  } else if (!isDisplayCmd && !isActionCmd) {
    const opts = program.opts();
    await runChat(!!opts.verbose);
  }
}

main();
