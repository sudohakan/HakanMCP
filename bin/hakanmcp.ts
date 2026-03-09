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
import { getCharacterProfile } from '../src/utils/characterProfile.js';
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
    ['mission',   'watch',     'scheduled', 'reactive',  'report'],
    ['init',      'start',     'stop',      'clear',     'exit'],
  ];
  const fmt = (label: string, colIdx: number) => {
    const color = chalk.hex(PILL_COL_COLORS[colIdx]);
    return `${color('◆')} ${chalk.hex('#F1F2F6')(label.padEnd(PILL_COL_WIDTHS[colIdx]))}`;
  };
  return rows.map((row) => '  ' + row.map((label, i) => fmt(label, i)).join('  ')).join('\n');
}

// ─── Status Bar ───────────────────────────────────────────────────
function renderStatusBar(): string {
  const version = getAppVersion();
  const ready = chalk.hex(THEME.success)('●') + ' ' + chalk.hex(THEME.success)('Ready');
  const ver = chalk.hex(THEME.textMuted)(`v${version}`);
  const pad = ' '.repeat(Math.max(2, 50 - 8 - version.length));
  return `  ${ready}${pad}${ver}`;
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
  scheduled: '#FDCB6E',
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
function renderUnifiedScreen(taglineTitle: string, content?: string, customHint?: string): string {
  clearScreen();
  const logo = renderGradientLogo();
  const pills = renderPillMenu();
  const statusBar = renderStatusBar();
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
  clearScreen();
  console.log(renderUnifiedScreen('Chat'));
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
      const remote = execSync('npm view hakan-mcp version --json', {
        cwd: PROJECT_ROOT, timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().replace(/"/g, '');
      if (remote && remote !== localVer) {
        versionDetail += ` (registry: v${remote})`;
        checks.push({ label: 'package.json', status: 'warn', detail: versionDetail });
      } else {
        checks.push({ label: 'package.json', status: 'ok', detail: versionDetail });
      }
    } catch {
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
    const srcNewest = getNewestMtime(path.join(PROJECT_ROOT, 'src'), '.ts');
    const distMtime = fs.statSync(distIndex).mtimeMs;
    if (srcNewest > distMtime) {
      checks.push({
        label: 'Build (dist/)',
        status: 'fail',
        detail: 'Stale (src newer than dist)',
        repairAction: {
          description: 'Rebuilding...',
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

        const jsonMatch = aiResult?.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const commands: string[] = JSON.parse(jsonMatch[0]);
          for (const cmd of commands.slice(0, 5)) {
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
        const srcN = getNewestMtime(path.join(PROJECT_ROOT, 'src'), '.ts');
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
  try {
    const { config: cfg } = await import('../src/config.js');
    serverName = cfg.serverName || serverName;
    const fb = cfg.aiProviders?.fallbackOrder ?? ['cli', 'api', 'ollama', 'codexmini'];
    const cli = cfg.aiProviders?.cliPriority ?? ['codex', 'claude', 'gemini', 'cursor'];
    const api = cfg.aiProviders?.apiPriority ?? ['codex', 'claude', 'gemini'];
    const agentic = cfg.aiProviders?.agenticEnabled ?? false;
    aiProviderLine = fb.join('-') + (agentic ? ` ${chalk.hex(THEME.success)('(agentic)')}` : '');
    aiProviderLine += `\n  ${chalk.hex(THEME.primary)('CLI Priority')}  ${chalk.hex('#F1F2F6')(cli.join('-'))}`;
    aiProviderLine += `\n  ${chalk.hex(THEME.primary)('API Priority')}  ${chalk.hex('#F1F2F6')(api.join('-'))}`;
  } catch { /* ignore */ }

  let body = '';
  body += `  ${chalk.hex(THEME.primary)('Server')}        ${chalk.hex('#F1F2F6')(serverName)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Version')}       ${chalk.hex('#F1F2F6')(version)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Node')}          ${chalk.hex('#F1F2F6')(process.version)}\n`;
  body += `  ${chalk.hex(THEME.primary)('PID')}           ${chalk.hex('#F1F2F6')(String(process.pid))}\n`;
  body += `  ${chalk.hex(THEME.primary)('Uptime')}        ${chalk.hex('#F1F2F6')(uptime)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Backup')}        ${backupLine}\n`;
  body += `  ${chalk.hex(THEME.primary)('AI Providers')}  ${chalk.hex('#F1F2F6')(aiProviderLine)}\n`;
  body += `  ${chalk.hex(THEME.primary)('Project')}       ${chalk.hex(THEME.textMuted)(PROJECT_ROOT)}\n`;

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
      ['mongoDbUrl', 'url', 'MongoDB connection string'],
    ]},
    { title: 'github.*', paths: [
      ['github.enabled', 'true|false', 'GitHub integration'],
      ['github.owner', 'string', 'Repo owner'],
      ['github.repo', 'string', 'Repo name'],
      ['github.branch', 'string', 'Default branch'],
      ['github.autoBackup', 'true|false', 'Auto push backups'],
      ['github.backupInterval', 'number', 'Backup interval (s)'],
      ['github.private', 'true|false', 'Repo visibility'],
    ]},
    { title: 'monitoring.*', paths: [
      ['monitoring.enabled', 'true|false', 'Health monitoring'],
      ['monitoring.checkInterval', 'number', 'Check interval (ms)'],
      ['monitoring.autoHeal', 'true|false', 'Auto-restart on fail'],
      ['monitoring.notifyOnError', 'true|false', 'Error alerts'],
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
      ['aiProviders.ollamaForTools', 'true|false', 'Ollama for MCP tools'],
      ['aiProviders.agenticEnabled', 'true|false', 'Agentic mode'],
      ['aiProviders.agenticMaxIterations', '1-50', 'Max agentic iterations'],
    ]},
    { title: 'scheduler.*', paths: [
      ['scheduler.enabled', 'true|false', 'Task scheduler'],
      ['scheduler.maxConcurrentTasks', 'number', 'Parallel task limit'],
      ['scheduler.taskHistoryRetentionDays', 'number', 'History retention (days)'],
    ]},
    { title: 'conversations.*', paths: [
      ['conversations.maxMessages', '10-1000', 'Max messages'],
      ['conversations.persistOnEveryMessage', 'true|false', 'Save per message'],
    ]},
    { title: 'consciousness.*', paths: [
      ['consciousness.enabled', 'true|false', 'Self-reflection'],
      ['consciousness.reflectionIntervalHours', 'number', 'Reflection interval (h)'],
      ['consciousness.maxJournalEntries', 'number', 'Max journal entries'],
    ]},
    { title: 'selfImprovement.*', paths: [
      ['selfImprovement.enabled', 'true|false', 'Auto-improvement'],
      ['selfImprovement.autoCommit', 'true|false', 'Auto-commit'],
      ['selfImprovement.requireApproval', 'true|false', 'Require approval'],
      ['selfImprovement.maxChangesPerDay', 'number', 'Daily change limit'],
    ]},
    { title: 'cli.* / api.*', paths: [
      ['cli.dailyLimit', 'number', 'CLI daily request limit'],
      ['cli.weeklyLimit', 'number', 'CLI weekly request limit'],
      ['api.dailyLimit', 'number', 'API daily request limit'],
      ['api.weeklyLimit', 'number', 'API weekly request limit'],
    ]},
    { title: 'watch.* / schedule.* / assistant.* / reactive.*', paths: [
      ['watch.enabled', 'true|false', 'File watch mode'],
      ['watch.debounceMs', 'number', 'Watch debounce (ms)'],
      ['schedule.enabled', 'true|false', 'Scheduled mode'],
      ['schedule.cron', 'string', 'Cron expression'],
      ['schedule.interval', 'string', 'Interval (e.g. "every 30m")'],
      ['assistant.enabled', 'true|false', 'Assistant context'],
      ['assistant.includeTargets', 'true|false', 'Include targets'],
      ['assistant.maxTargetSize', 'number', 'Max target size (bytes)'],
      ['reactive.enabled', 'true|false', 'Reactive mode'],
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
  const icon = (s: string) => chalk.hex(THEME.primary)(`  ✦ `);
  const cmd = (s: string) => chalk.hex('#F1F2F6')(s.padEnd(24));
  const desc = (s: string) => chalk.hex(THEME.textMuted)(s);
  const cat = (s: string) => chalk.hex(THEME.primary).bold(`  ${s}`);

  const sections = [
    { title: 'System', items: [
      ['doctor [fix]', 'Health check / auto-repair'],
      ['status', 'Status dashboard (version, uptime, backup)'],
    ]},
    { title: 'AI Providers', items: [
      ['providers', 'Provider status, usage limits & cooldowns'],
      ['providers set', 'Configure daily/weekly limits, Ollama settings'],
      ['providers reset', 'Reset cooldowns & usage counters'],
      ['providers update', 'Update CLI tools & Ollama models'],
    ]},
    { title: 'Consciousness', items: [
      ['journal [n]', 'Show last N journal entries (default: 5)'],
      ['journal reset', 'Clear journal & reset emotions'],
      ['ralph', 'Ralph loop dashboard'],
      ['ralph start', 'Start reflection loop (-n, -t, --dry-run)'],
      ['ralph stop <id>', 'Stop a running loop'],
      ['ralph log <id>', 'Show loop output'],
    ]},
    { title: 'Data & Config', items: [
      ['backup [run]', 'Show backup status / run now'],
      ['config', 'Show current configuration'],
      ['config set <c> <k> <v>', 'Update config value'],
      ['config chat', 'Chat-specific settings'],
      ['config yaml [set]', 'Show/edit config.yaml paths & types'],
      ['logs [tail|open]', 'Browse / tail / open log areas'],
      ['tools', 'List all registered MCP tools'],
    ]},
    { title: 'Mission Agent', items: [
      ['init [--force]', 'Initialize workspace (config + mission templates)'],
      ['start [--daemon]', 'Start mission agent'],
      ['stop', 'Stop running agent / watcher / scheduler'],
      ['mission', 'Show current mission status'],
      ['report [-n N]', 'Show recent reports'],
      ['watch', 'Start file watcher mode'],
      ['scheduled', 'Start scheduled mode'],
      ['reactive', 'Start reactive mode (watch + scheduled)'],
    ]},
    { title: 'Chat Commands (in /console)', items: [
      ['/help', 'Show this help'],
      ['/doctor [fix]', 'Health check / auto-repair'],
      ['/status', 'Status dashboard'],
      ['/providers [sub]', 'Provider management'],
      ['/journal [n]', 'Journal entries'],
      ['/tools', 'List MCP tools'],
      ['/backup [run]', 'Backup management'],
      ['/config [sub]', 'Configuration'],
      ['/logs [sub]', 'Log browser'],
      ['/ralph [sub]', 'Ralph loop'],
      ['/init [--force]', 'Initialize workspace'],
      ['/start [--daemon]', 'Start mission agent (daemon by default)'],
      ['/stop', 'Stop running agent'],
      ['/mission', 'Mission status'],
      ['/report [-n N]', 'Recent reports'],
      ['/watch', 'File watcher mode'],
      ['/scheduled', 'Scheduled mode'],
      ['/assistant', 'Mission-aware assistant info'],
      ['/reactive', 'Reactive mode'],
      ['/clear', 'Clear chat history'],
      ['/exit', 'Exit console'],
    ]},
  ];

  const lines: string[] = [];
  sections.forEach((section, idx) => {
    if (idx > 0) lines.push('');
    lines.push(cat(section.title));
    for (const [name, description] of section.items) {
      lines.push(`${icon('✦')}${cmd(name)}${desc(description)}`);
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
    const thought = (e.thought || e.result || '').replace(/[\n\r]+/g, ' ').replace(/[#*_`~>]/g, '').trim();
    const typeLabel = e.type ? chalk.hex(THEME.textMuted)(` (${e.type})`) : '';
    const provLabel = e.provider ? chalk.hex(THEME.textMuted)(` via ${e.provider}`) : '';
    body += `  ${chalk.hex(THEME.primary)(`${i + 1}.`)} ${chalk.hex(THEME.textMuted)(`[${ts}]`)}${typeLabel}${provLabel}\n`;
    body += `     ${chalk.hex('#F1F2F6')(thought)}\n\n`;
  });
  // Prepend mood/emotion + character summary
  const cogPath = path.join(PROJECT_ROOT, 'logs', 'consciousness', 'cognition_state.json');
  if (fs.existsSync(cogPath)) {
    try {
      const cog = JSON.parse(fs.readFileSync(cogPath, 'utf8'));
      const em = cog.emotions;
      if (em) {
        // Character traits (short labels from Big Five)
        const profile = getCharacterProfile(PROJECT_ROOT);
        const traitLabels: string[] = [];
        traitLabels.push(profile.openness >= 0.7 ? 'Curious' : profile.openness < 0.3 ? 'Practical' : 'Balanced');
        traitLabels.push(profile.agreeableness >= 0.7 ? 'Warm' : profile.agreeableness < 0.3 ? 'Direct' : 'Moderate');
        traitLabels.push(profile.conscientiousness >= 0.7 ? 'Organized' : profile.conscientiousness < 0.3 ? 'Flexible' : 'Steady');
        traitLabels.push(profile.extraversion >= 0.6 ? 'Expressive' : profile.extraversion < 0.3 ? 'Reserved' : 'Moderate');
        traitLabels.push(profile.emotionalStability >= 0.6 ? 'Steady' : profile.emotionalStability < 0.3 ? 'Sensitive' : 'Balanced');

        // Mood description with emoji
        const moodDesc = em.mood > 0.6 ? 'positive' : em.mood > 0.2 ? 'calm' : em.mood > -0.2 ? 'neutral' : em.mood > -0.6 ? 'low' : 'frustrated';
        const moodEmoji = em.mood > 0.6 ? '😊' : em.mood > 0.2 ? '😌' : em.mood > -0.2 ? '😐' : em.mood > -0.6 ? '😔' : '😤';
        const energyDesc = em.energy > 0.7 ? 'energetic' : em.energy > 0.4 ? 'alert' : 'tired';
        const curiosityDesc = em.curiosity > 0.7 ? 'very curious' : em.curiosity > 0.4 ? 'interested' : 'reflective';

        // Progress bar helper
        const bar = (val: number) => {
          const filled = Math.round(val * 10);
          return '█'.repeat(filled) + '░'.repeat(10 - filled);
        };

        let moodBody = '';
        moodBody += `  ${chalk.hex(THEME.primary)('Character')}     ${chalk.hex('#F1F2F6')(traitLabels.join(' · '))}\n`;
        moodBody += `  ${chalk.hex(THEME.primary)('Mood')}          ${moodEmoji} ${chalk.hex('#F1F2F6')(moodDesc)} · ${energyDesc} · ${curiosityDesc}\n`;
        moodBody += `  ${chalk.hex(THEME.primary)('Energy')}        ${chalk.hex('#6C5CE7')(bar(em.energy))} ${Math.round(em.energy * 100)}%\n`;
        moodBody += `  ${chalk.hex(THEME.primary)('Satisfaction')}  ${chalk.hex('#00D68F')(bar(em.satisfaction))} ${Math.round(em.satisfaction * 100)}%`;
        moodBody += `    ${chalk.hex(THEME.primary)('Frustration')} ${chalk.hex('#FF6B6B')(bar(em.frustration))} ${Math.round(em.frustration * 100)}%\n`;
        moodBody += `  ${chalk.hex(THEME.primary)('Interactions')}  ${chalk.hex('#F1F2F6')(String(cog.interactionCount || 0))} total · ${chalk.hex('#F1F2F6')(String(cog.consecutiveSuccesses || 0))} consecutive ok\n\n`;
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

  // Backup journal if it exists and has content
  if (fs.existsSync(journalPath)) {
    const content = fs.readFileSync(journalPath, 'utf8').trim();
    if (content) {
      const bakPath = journalPath + '.bak';
      fs.copyFileSync(journalPath, bakPath);
    }
    fs.writeFileSync(journalPath, '');
  }

  // Reset cognition state
  if (fs.existsSync(cogPath)) {
    const cog = JSON.parse(fs.readFileSync(cogPath, 'utf8'));
    cog.interactionCount = 0;
    cog.consecutiveSuccesses = 0;
    cog.consecutiveErrors = 0;
    cog.recentTopics = [];
    cog.emotions = { mood: 0.5, energy: 0.5, curiosity: 0.5, satisfaction: 0.5, frustration: 0.1 };
    cog.lastUpdated = new Date().toISOString();
    fs.writeFileSync(cogPath, JSON.stringify(cog, null, 2) + '\n');
  }

  const body = `  ${chalk.hex(THEME.success)('✓')} Journal cleared and emotions reset to defaults.\n` +
    `  ${chalk.hex(THEME.textMuted)('Backup saved to journal.jsonl.bak')}`;
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
        ['localModels', config.aiProviders?.localModels ?? false, 'Enable local Ollama models'],
        ['ollamaForTools', config.aiProviders?.ollamaForTools ?? true, 'Allow Ollama as MCP tool backend'],
        ['agenticEnabled', config.aiProviders?.agenticEnabled ?? false, 'Enable multi-step agentic mode'],
        ['agenticMaxIterations', config.aiProviders?.agenticMaxIterations ?? 5, 'Max agentic loop iterations'],
        ['fallbackOrder', (config.aiProviders?.fallbackOrder ?? ['cli', 'api', 'ollama', 'codexmini']).join('-'), 'Provider fallback chain'],
        ['cliPriority', (config.aiProviders?.cliPriority ?? ['codex', 'claude', 'gemini', 'cursor']).join('-'), 'CLI tool priority order'],
        ['apiPriority', (config.aiProviders?.apiPriority ?? ['codex', 'claude', 'gemini']).join('-'), 'API key priority order'],
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
        ['useOllamaInChat', chat.useOllamaInChat ?? false, 'Use Ollama as chat fallback'],
        ['useApiKeys', chat.useApiKeys !== false, 'Use API keys when CLI fails'],
      ],
    },
    {
      title: 'Usage Limits',
      rows: [
        ['API (daily/weekly)', `${config.api?.dailyLimit ?? 50}/${config.api?.weeklyLimit ?? 200}`, 'API request limits'],
        ['CLI (daily/weekly)', `${config.cli?.dailyLimit ?? 50}/${config.cli?.weeklyLimit ?? 200}`, 'CLI request limits'],
      ],
    },
    {
      title: 'GitHub',
      rows: [
        ['enabled', config.github?.enabled ?? false, 'GitHub integration on/off'],
        ['owner', config.github?.owner ?? '—', 'Repository owner'],
        ['repo', config.github?.repo ?? '—', 'Repository name'],
        ['branch', config.github?.branch ?? '—', 'Default branch'],
        ['autoBackup', config.github?.autoBackup ?? false, 'Auto push backups to GitHub'],
        ['backupInterval', config.github?.backupInterval ?? 24, 'Backup interval in seconds'],
        ['private', config.github?.private ?? true, 'Repository visibility'],
      ],
    },
    {
      title: 'Monitoring',
      rows: [
        ['enabled', config.monitoring?.enabled ?? false, 'Health monitoring on/off'],
        ['checkInterval', config.monitoring?.checkInterval ?? 300000, 'Check interval in seconds'],
        ['autoHeal', config.monitoring?.autoHeal ?? false, 'Auto-restart on failure'],
        ['notifyOnError', config.monitoring?.notifyOnError ?? true, 'Send alerts on errors'],
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
      title: 'Conversations',
      rows: [
        ['maxMessages', 100, 'Max messages per conversation'],
        ['persistOnEveryMessage', false, 'Save after each message'],
      ],
    },
    {
      title: 'Consciousness',
      rows: [
        ['enabled', config.consciousness?.enabled ?? false, 'Self-reflection system on/off'],
        ['reflectionIntervalHours', config.consciousness?.reflectionIntervalHours ?? 24, 'Hours between reflections'],
        ['maxJournalEntries', config.consciousness?.maxJournalEntries ?? 100, 'Max journal entries to keep'],
        ['reflection.style', (config.consciousness as any)?.reflection?.style ?? 'brief', 'Reflection style (auto/brief/detailed)'],
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
        ['enabled', (config as any).watch?.enabled ?? false, 'File watch mode on/off'],
        ['debounceMs', (config as any).watch?.debounceMs ?? 1000, 'Watch debounce delay (ms)'],
      ],
    },
    {
      title: 'Schedule',
      rows: [
        ['enabled', (config as any).schedule?.enabled ?? false, 'Scheduled mode on/off'],
        ['cron', (config as any).schedule?.cron ?? '—', 'Cron expression'],
        ['interval', (config as any).schedule?.interval ?? '—', 'Interval (e.g. "every 30m")'],
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
        ['enabled', (config as any).reactive?.enabled ?? false, 'Reactive mode on/off'],
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
    'config chat useOllama <on|off>          Ollama in chat',
    'config chat useApiKeys <on|off>         API keys in chat',
    'config yaml                             Show all yaml paths & types',
    'config yaml set <path> <value>          Edit config.yaml directly',
    'Categories: general | ollama | ai | chat | github | monitoring | backup',
    '            scheduler | conversations | consciousness | self',
    '            watch | schedule | assistant | reactive',
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
    ollamaForTools: 'aiProviders.ollamaForTools',
    agenticEnabled: 'aiProviders.agenticEnabled',
    agenticMaxIterations: 'aiProviders.agenticMaxIterations',
    fallbackOrder: 'aiProviders.fallbackOrder',
    cliPriority: 'aiProviders.cliPriority',
    apiPriority: 'aiProviders.apiPriority',
  },
  github: { enabled: 'github.enabled', autoBackup: 'github.autoBackup', backupInterval: 'github.backupInterval', private: 'github.private' },
  monitoring: { enabled: 'monitoring.enabled', checkInterval: 'monitoring.checkInterval', autoHeal: 'monitoring.autoHeal', notifyOnError: 'monitoring.notifyOnError' },
  backup: { enabled: 'backup.enabled', maxBackups: 'backup.maxBackups', retentionHours: 'backup.retentionHours', compressionEnabled: 'backup.compressionEnabled', intervalHours: 'backup.intervalHours' },
  scheduler: { enabled: 'scheduler.enabled', maxConcurrentTasks: 'scheduler.maxConcurrentTasks', taskHistoryRetentionDays: 'scheduler.taskHistoryRetentionDays' },
  conversations: { maxMessages: 'conversations.maxMessages', persistOnEveryMessage: 'conversations.persistOnEveryMessage' },
  consciousness: { enabled: 'consciousness.enabled', reflectionIntervalHours: 'consciousness.reflectionIntervalHours', maxJournalEntries: 'consciousness.maxJournalEntries' },
  self: { enabled: 'selfImprovement.enabled', autoCommit: 'selfImprovement.autoCommit', requireApproval: 'selfImprovement.requireApproval', maxChangesPerDay: 'selfImprovement.maxChangesPerDay' },
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
  // Array fields: dash-separated input → JSON array (e.g. "cli-api-ollama" → '["cli","api","ollama"]')
  const arrayFields = ['fallbackOrder', 'cliPriority', 'apiPriority'];
  const isArrayField = arrayFields.includes(key);
  let valStr: string;
  if (isBooleanValue) {
    valStr = (lower === 'on' || lower === 'true' || lower === '1') ? 'true' : 'false';
  } else if (isArrayField && !value.startsWith('[')) {
    valStr = JSON.stringify(value.split('-'));
  } else {
    valStr = value;
  }

  await runConfigSet(configPath, valStr);
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
    .command('set <category> <key> <value>')
    .description(
      'Set a setting (category: general|ollama|ai|github|monitoring|backup|scheduler|conversations|consciousness|self|chat)',
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
    .description('Initialize workspace (config + mission templates)')
    .option('--force', 'Overwrite existing config')
    .action(runInit);

  program.command('start')
    .description('Start mission agent')
    .option('--daemon', 'Run in background')
    .option('--mission <file>', 'Mission file path', 'PRIMARY_MISSION.md')
    .action(runStart);

  program.command('stop')
    .description('Stop running mission agent')
    .action(runStop);

  program.command('mission')
    .description('Show current mission status')
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
