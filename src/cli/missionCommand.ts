/**
 * `hakanmcp mission` command handler.
 * Displays current mission status from .hakanmcp/state.json.
 */

import chalk from 'chalk';
import { MissionStateManager } from '../mission/missionState.js';
import { formatDuration } from '../mission/reportGenerator.js';
import type { StepStatus } from '../mission/types.js';

// Theme colors
const SUCCESS = '#00D68F';
const ERROR = '#FF6B6B';
const INFO = '#6C5CE7';
const MUTED = '#8395A7';

/**
 * Get colored status indicator for mission status.
 */
function statusBadge(status: string): string {
  switch (status) {
    case 'running':
      return chalk.hex(INFO)('RUNNING');
    case 'completed':
      return chalk.hex(SUCCESS)('COMPLETED');
    case 'failed':
      return chalk.hex(ERROR)('FAILED');
    case 'paused':
      return chalk.yellow('PAUSED');
    case 'idle':
      return chalk.hex(MUTED)('IDLE');
    default:
      return chalk.hex(MUTED)(status.toUpperCase());
  }
}

/**
 * Get step status icon.
 */
function stepIcon(status: StepStatus): string {
  switch (status) {
    case 'completed':
      return chalk.hex(SUCCESS)('[OK]');
    case 'running':
      return chalk.hex(INFO)('[..]');
    case 'failed':
      return chalk.hex(ERROR)('[!!]');
    case 'skipped':
      return chalk.hex(MUTED)('[--]');
    case 'pending':
      return chalk.hex(MUTED)('[  ]');
    case 'evaluating':
      return chalk.hex(INFO)('[??]');
    default:
      return chalk.hex(MUTED)('[  ]');
  }
}

/**
 * Display formatted mission status.
 */
export async function runMission(): Promise<void> {
  const cwd = process.cwd();
  const stateManager = new MissionStateManager(cwd);
  const state = stateManager.getState();

  if (!state) {
    console.log(chalk.hex(MUTED)('No active mission. Run "hakanmcp start" to begin.'));
    return;
  }

  // Header
  console.log();
  console.log(chalk.bold(`Mission: ${state.title}`));
  console.log(`Status:  ${statusBadge(state.status)}`);
  if (state.provider) {
    console.log(`Provider: ${chalk.hex(INFO)(state.provider)}`);
  }

  // Progress
  const completedCount = state.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = state.steps.length;
  const pct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
  const elapsed = state.updatedAt - state.startedAt;

  console.log(`Progress: ${completedCount}/${totalSteps} steps (${pct}%)`);
  console.log(`Elapsed:  ${formatDuration(elapsed)}`);
  console.log();

  // Step list
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
