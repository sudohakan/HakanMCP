/**
 * `hakanmcp mission` command handler.
 * Shows workspace dashboard by default, detailed status with --workspace or --all.
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { MissionStateManager } from '../mission/missionState.js';
import { formatDuration } from '../mission/reportGenerator.js';
import type { StepStatus } from '../mission/types.js';
import { loadWorkspaceConfig } from './configValidator.js';
import { renderCommandHeader, renderDivider } from './cliUtils.js';

const SUCCESS = '#00D68F';
const ERROR = '#FF6B6B';
const INFO = '#6C5CE7';
const MUTED = '#8395A7';
const WARN = '#FDCB6E';

function statusBadge(status: string): string {
  switch (status) {
    case 'running': return chalk.hex(INFO)('● RUNNING');
    case 'completed': return chalk.hex(SUCCESS)('✓ COMPLETED');
    case 'failed': return chalk.hex(ERROR)('✗ FAILED');
    case 'paused': return chalk.hex(WARN)('⏸ PAUSED');
    case 'idle': return chalk.hex(MUTED)('○ IDLE');
    default: return chalk.hex(MUTED)(`○ ${status.toUpperCase()}`);
  }
}

function stepIcon(status: StepStatus): string {
  switch (status) {
    case 'completed': return chalk.hex(SUCCESS)('[OK]');
    case 'running': return chalk.hex(INFO)('[..]');
    case 'failed': return chalk.hex(ERROR)('[!!]');
    case 'skipped': return chalk.hex(MUTED)('[--]');
    case 'pending': return chalk.hex(MUTED)('[  ]');
    case 'evaluating': return chalk.hex(INFO)('[??]');
    default: return chalk.hex(MUTED)('[  ]');
  }
}

/**
 * Workspace dashboard — lists all workspaces with status summary.
 */
function showWorkspaceDashboard(cwd: string): void {
  let config;
  try {
    config = loadWorkspaceConfig(cwd);
  } catch {
    console.log(chalk.hex(MUTED)('  No config found. Run hakanmcp init to get started.\n'));
    return;
  }

  console.log(renderCommandHeader('Mission', 'mission'));

  const workspaces = config.workspaces ?? [];

  if (workspaces.length === 0) {
    console.log(chalk.hex(MUTED)('\n  No workspaces defined. Run hakanmcp init to add one.'));

    const defaultState = new MissionStateManager(cwd);
    const state = defaultState.getState();
    if (state) {
      console.log('');
      console.log(chalk.hex(INFO)('  Default Workspace'));
      console.log(`    Status: ${statusBadge(state.status)}`);
      const done = state.steps.filter((s) => s.status === 'completed').length;
      console.log(`    Steps:  ${done}/${state.steps.length}`);
    }
    console.log('');
    return;
  }

  for (const ws of workspaces) {
    const stateManager = new MissionStateManager(cwd, ws.name);
    const state = stateManager.getState();

    const targetExists = fs.existsSync(ws.path);
    const missionExists = fs.existsSync(path.join(cwd, ws.primary));

    console.log('');
    console.log(`  ${chalk.hex(INFO).bold(ws.name)}`);
    console.log(`    Target:  ${targetExists ? chalk.hex(SUCCESS)(ws.path) : chalk.hex(ERROR)(ws.path + ' (not found)')}`);
    console.log(`    Mission: ${missionExists ? chalk.hex(MUTED)(ws.primary) : chalk.hex(ERROR)(ws.primary + ' (missing)')}`);

    if (state) {
      const done = state.steps.filter((s) => s.status === 'completed').length;
      console.log(`    Status:  ${statusBadge(state.status)}`);
      console.log(`    Steps:   ${done}/${state.steps.length}`);
    } else {
      console.log(`    Status:  ${chalk.hex(MUTED)('○ NOT STARTED')}`);
    }
  }

  console.log('');
  console.log(renderDivider());
  console.log(chalk.dim('  start --workspace <name>              Run a workspace'));
  console.log(chalk.dim('  mission --workspace <name>            Detailed status'));
  console.log(chalk.dim('  mission --all                         All workspaces detail'));
  console.log(chalk.dim('  init                                  Add new workspace'));
  console.log('');
}

export async function runMission(options?: {
  workspace?: string;
  all?: boolean;
}): Promise<void> {
  const cwd = process.cwd();

  if (options?.all) {
    const config = loadWorkspaceConfig(cwd);
    if (!config.workspaces || config.workspaces.length === 0) {
      console.log(chalk.hex(MUTED)('No workspaces defined in config.'));
      return;
    }
    for (const ws of config.workspaces) {
      console.log(chalk.bold(`\n--- Workspace: ${ws.name} ---`));
      const stateManager = new MissionStateManager(cwd, ws.name);
      displayMissionState(stateManager);
    }
    return;
  }

  if (options?.workspace) {
    const config = loadWorkspaceConfig(cwd);
    const ws = config.workspaces?.find((w) => w.name === options.workspace);
    if (!ws) {
      console.log(chalk.hex(ERROR)(`Workspace "${options.workspace}" not found.`));
      return;
    }
    console.log(chalk.bold(`Workspace: ${ws.name} (${ws.path})\n`));
    const stateManager = new MissionStateManager(cwd, ws.name);
    displayMissionState(stateManager);
    return;
  }

  showWorkspaceDashboard(cwd);
}

/** Display detailed mission state from a MissionStateManager instance. */
function displayMissionState(stateManager: MissionStateManager): void {
  const state = stateManager.getState();

  if (!state) {
    console.log(chalk.hex(MUTED)('No active mission. Run "hakanmcp start" to begin.'));
    return;
  }

  console.log(chalk.bold(`Mission: ${state.title}`));
  console.log(`Status:  ${statusBadge(state.status)}`);
  if (state.provider) {
    console.log(`Provider: ${chalk.hex(INFO)(state.provider)}`);
  }

  const completedCount = state.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = state.steps.length;
  const pct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
  const elapsed = state.updatedAt - state.startedAt;

  console.log(`Progress: ${completedCount}/${totalSteps} steps (${pct}%)`);
  console.log(`Elapsed:  ${formatDuration(elapsed)}`);
  console.log();

  console.log(chalk.bold('Steps:'));
  for (let i = 0; i < state.steps.length; i++) {
    const step = state.steps[i];
    const icon = stepIcon(step.status);
    const desc = step.description;
    const current = i === state.currentStepIndex && state.status === 'running' ? ' <--' : '';
    console.log(`  ${icon} ${i + 1}. ${desc}${chalk.hex(MUTED)(current)}`);
  }
  console.log();
}
