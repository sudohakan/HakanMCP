/**
 * `hakanmcp start` command handler.
 * Starts the agent in foreground (default) or daemon mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { loadWorkspaceConfig } from './configValidator.js';
import { loadMission } from '../mission/missionLoader.js';
import { runMission } from '../mission/missionRunner.js';
import { MissionStateManager } from '../mission/missionState.js';
import type { MissionRunnerConfig, MissionEvent, MissionRunResult } from '../mission/types.js';
import type { WorkspaceEntry } from './configValidator.js';
import { getAgenticToolsRef } from '../tools/aiTools.js';

const HAKANMCP_DIR = '.hakanmcp';
const PID_FILE = 'agent.pid';
const STOP_SIGNAL_FILE = 'stop-signal';
const DAEMON_LOG_FILE = 'daemon.log';

/**
 * Resolve workspace config by name from the workspaces array.
 */
function resolveWorkspace(
  workspaces: WorkspaceEntry[] | undefined,
  name: string,
): WorkspaceEntry {
  if (!workspaces || workspaces.length === 0) {
    throw new Error('No workspaces defined in config. Add a "workspaces" section to hakanmcp.config.yaml');
  }
  const ws = workspaces.find((w) => w.name === name);
  if (!ws) {
    const available = workspaces.map((w) => w.name).join(', ');
    throw new Error(`Workspace "${name}" not found. Available: ${available}`);
  }
  return ws;
}

/**
 * Run a single workspace mission (foreground).
 */
async function runSingleWorkspace(
  cwd: string,
  ws: WorkspaceEntry,
  config: import('./configValidator.js').WorkspaceConfig,
  signal: AbortSignal,
): Promise<MissionRunResult> {
  const missionPath = path.join(cwd, ws.primary);
  const mission = loadMission(missionPath);

  if (!mission) {
    throw new Error(`Mission file not found for workspace "${ws.name}": ${missionPath}`);
  }

  const stateManager = new MissionStateManager(cwd, ws.name);
  const runnerConfig: MissionRunnerConfig = {
    maxIterationsPerStep: config.agent.maxIterationsPerStep,
    maxRetriesPerStep: 2,
    stepTimeoutMs: config.agent.stepTimeoutMs,
    maxTotalTimeMs: 3_600_000,
    continueOnFailure: config.agent.continueOnFailure,
  };

  const onProgress = (event: MissionEvent): void => {
    const prefix = chalk.hex('#6C5CE7')(`[${ws.name}]`);
    switch (event.type) {
      case 'step:start':
        console.log(`${prefix} Step ${(event.index ?? 0) + 1}/${event.total ?? '?'}: ${event.stepId ?? ''}`);
        break;
      case 'step:complete':
        console.log(`${prefix} ${chalk.hex('#00D68F')(`Step ${(event.index ?? 0) + 1} completed`)}`);
        break;
      case 'step:failed':
        console.log(`${prefix} ${chalk.hex('#FF6B6B')(`Step ${(event.index ?? 0) + 1} failed: ${event.error ?? ''}`)}`);
        break;
      case 'mission:complete':
        console.log(`${prefix} ${chalk.hex('#00D68F')('Mission completed')}`);
        break;
      case 'mission:failed':
        console.log(`${prefix} ${chalk.hex('#FF6B6B')(`Mission failed: ${event.error ?? ''}`)}`);
        break;
    }
  };

  return runMission(mission, stateManager, runnerConfig, signal, onProgress, getAgenticToolsRef());
}

/**
 * Check if a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read PID from the PID file. Returns null if not found.
 */
function readPidFile(cwd: string): number | null {
  const pidPath = path.join(cwd, HAKANMCP_DIR, PID_FILE);
  try {
    const content = fs.readFileSync(pidPath, 'utf8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Write PID to the PID file.
 */
function writePidFile(cwd: string, pid: number): void {
  const dir = path.join(cwd, HAKANMCP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PID_FILE), String(pid), 'utf8');
}

/**
 * Remove PID file.
 */
function removePidFile(cwd: string): void {
  const pidPath = path.join(cwd, HAKANMCP_DIR, PID_FILE);
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // Ignore if already removed
  }
}

/**
 * Remove stop-signal file.
 */
function removeStopSignal(cwd: string): void {
  const signalPath = path.join(cwd, HAKANMCP_DIR, STOP_SIGNAL_FILE);
  try {
    fs.unlinkSync(signalPath);
  } catch {
    // Ignore if not present
  }
}

/**
 * Check if stop-signal file exists (Windows-compatible shutdown).
 */
function hasStopSignal(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, HAKANMCP_DIR, STOP_SIGNAL_FILE));
}

/**
 * Start the agent in foreground or daemon mode.
 */
export async function runStart(options: {
  daemon?: boolean;
  mission?: string;
  workspace?: string;
  all?: boolean;
  parallel?: boolean;
}): Promise<void> {
  const cwd = process.cwd();

  // 1. Load and validate workspace config
  const config = loadWorkspaceConfig(cwd);

  // 2. Check for existing running agent
  const existingPid = readPidFile(cwd);
  if (existingPid !== null) {
    if (isProcessAlive(existingPid)) {
      console.error(
        chalk.hex('#FF6B6B')(`Agent already running (PID ${existingPid}). Use "hakanmcp stop" first.`),
      );
      process.exitCode = 1;
      return;
    }
    // Stale PID file — clean it up
    removePidFile(cwd);
  }

  // --- Workspace modes ---
  if (options.all) {
    const workspaces = config.workspaces;
    if (!workspaces || workspaces.length === 0) {
      console.error(chalk.hex('#FF6B6B')('No workspaces defined in config.'));
      process.exitCode = 1;
      return;
    }

    writePidFile(cwd, process.pid);
    removeStopSignal(cwd);
    const abortController = new AbortController();
    const shutdown = () => abortController.abort();
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.log(chalk.hex('#6C5CE7')(`Running ${workspaces.length} workspace(s) ${options.parallel ? 'in parallel' : 'sequentially'}...\n`));

    try {
      if (options.parallel) {
        const results = await Promise.allSettled(
          workspaces.map((ws) => runSingleWorkspace(cwd, ws, config, abortController.signal)),
        );
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const name = workspaces[i].name;
          if (r.status === 'fulfilled') {
            console.log(chalk.hex('#00D68F')(`\n[${name}] ${r.value.status} — ${r.value.steps.filter((s) => s.status === 'completed').length}/${r.value.steps.length} steps`));
          } else {
            console.log(chalk.hex('#FF6B6B')(`\n[${name}] Error: ${r.reason}`));
          }
        }
      } else {
        for (const ws of workspaces) {
          if (abortController.signal.aborted) break;
          console.log(chalk.hex('#6C5CE7')(`\n--- Workspace: ${ws.name} ---`));
          try {
            const result = await runSingleWorkspace(cwd, ws, config, abortController.signal);
            console.log(chalk.hex('#00D68F')(`Result: ${result.status} — ${result.steps.filter((s) => s.status === 'completed').length}/${result.steps.length} steps`));
          } catch (err) {
            console.error(chalk.hex('#FF6B6B')(`Error: ${err instanceof Error ? err.message : String(err)}`));
          }
        }
      }
    } finally {
      process.off('SIGTERM', shutdown);
      process.off('SIGINT', shutdown);
      removePidFile(cwd);
    }
    return;
  }

  if (options.workspace) {
    const ws = resolveWorkspace(config.workspaces, options.workspace);
    writePidFile(cwd, process.pid);
    removeStopSignal(cwd);
    const abortController = new AbortController();
    const shutdown = () => abortController.abort();
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.log(chalk.hex('#6C5CE7')(`Running workspace: ${ws.name}\n`));

    try {
      const result = await runSingleWorkspace(cwd, ws, config, abortController.signal);
      console.log(chalk.hex('#6C5CE7')(
        `\nResult: ${result.status} | Steps: ${result.steps.filter((s) => s.status === 'completed').length}/${result.steps.length} | Provider: ${result.provider}`,
      ));
    } catch (err) {
      console.error(chalk.hex('#FF6B6B')(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    } finally {
      process.off('SIGTERM', shutdown);
      process.off('SIGINT', shutdown);
      removePidFile(cwd);
    }
    return;
  }

  // --- Default workspace (existing behavior below) ---

  // 3. Load mission
  const missionFile = options.mission || 'PRIMARY_MISSION.md';
  const missionPath = path.join(cwd, missionFile);
  const mission = loadMission(missionPath);

  if (!mission) {
    console.error(
      chalk.hex('#FF6B6B')(`Mission file not found: ${missionPath}`),
    );
    process.exitCode = 1;
    return;
  }

  // 4. Daemon mode
  if (options.daemon) {
    const logDir = path.join(cwd, HAKANMCP_DIR);
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, DAEMON_LOG_FILE);
    const out = fs.openSync(logPath, 'a');
    const err = fs.openSync(logPath, 'a');

    const child = spawn(process.execPath, [process.argv[1], 'start', '--mission', missionFile], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd,
      env: { ...process.env, HAKANMCP_DAEMON: '1' },
    });

    child.unref();

    if (child.pid) {
      writePidFile(cwd, child.pid);
      console.log(chalk.hex('#00D68F')(`Agent started in daemon mode (PID ${child.pid})`));
      console.log(chalk.hex('#8395A7')(`Log: ${logPath}`));
    } else {
      console.error(chalk.hex('#FF6B6B')('Failed to start daemon process.'));
      process.exitCode = 1;
    }
    return;
  }

  // 5. Foreground mode
  writePidFile(cwd, process.pid);
  removeStopSignal(cwd);

  const abortController = new AbortController();
  const { signal } = abortController;

  // Shutdown handlers
  const shutdown = () => {
    abortController.abort();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Stop-signal polling for Windows compatibility
  const stopPollInterval = setInterval(() => {
    if (hasStopSignal(cwd)) {
      clearInterval(stopPollInterval);
      removeStopSignal(cwd);
      abortController.abort();
    }
  }, 1000);

  const spinner = ora({
    text: `Running mission: ${mission.frontmatter.title}`,
    color: 'magenta',
  }).start();

  const stateManager = new MissionStateManager(cwd);
  const runnerConfig: MissionRunnerConfig = {
    maxIterationsPerStep: config.agent.maxIterationsPerStep,
    maxRetriesPerStep: 2,
    stepTimeoutMs: config.agent.stepTimeoutMs,
    maxTotalTimeMs: 3_600_000, // 1 hour default
    continueOnFailure: config.agent.continueOnFailure,
  };

  const onProgress = (event: MissionEvent): void => {
    switch (event.type) {
      case 'step:start':
        spinner.text = `Step ${(event.index ?? 0) + 1}/${event.total ?? '?'}: ${event.stepId ?? ''}`;
        break;
      case 'step:complete':
        spinner.succeed(
          chalk.hex('#00D68F')(`Step ${(event.index ?? 0) + 1}/${event.total ?? '?'} completed`),
        );
        spinner.start();
        break;
      case 'step:failed':
        spinner.fail(
          chalk.hex('#FF6B6B')(
            `Step ${(event.index ?? 0) + 1}/${event.total ?? '?'} failed: ${event.error ?? 'unknown'}`,
          ),
        );
        break;
      case 'mission:complete':
        spinner.succeed(chalk.hex('#00D68F')('Mission completed successfully'));
        break;
      case 'mission:failed':
        spinner.fail(chalk.hex('#FF6B6B')(`Mission failed: ${event.error ?? 'unknown'}`));
        break;
    }
  };

  try {
    const result = await runMission(mission, stateManager, runnerConfig, signal, onProgress, getAgenticToolsRef());
    console.log(
      chalk.hex('#6C5CE7')(
        `\nResult: ${result.status} | Steps: ${result.steps.filter((s) => s.status === 'completed').length}/${result.steps.length} | Provider: ${result.provider}`,
      ),
    );
  } catch (err) {
    spinner.fail(chalk.hex('#FF6B6B')(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  } finally {
    clearInterval(stopPollInterval);
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    removePidFile(cwd);
  }
}
