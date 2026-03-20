/**
 * `hakanmcp scheduled` command handler.
 * Starts periodic mission execution via cron/interval triggers.
 */
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { loadWorkspaceConfig } from './configValidator.js';
import { startScheduledMode } from '../scheduled/index.js';
import type { ScheduledSystemEvent } from '../scheduled/types.js';

const HAKANMCP_DIR = '.hakanmcp';
const PID_FILE = 'scheduled.pid';
const STOP_SIGNAL_FILE = 'scheduled-stop-signal';

function writePidFile(cwd: string, pid: number): void {
  const dir = path.join(cwd, HAKANMCP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PID_FILE), String(pid), 'utf8');
}

function removePidFile(cwd: string): void {
  try {
    fs.unlinkSync(path.join(cwd, HAKANMCP_DIR, PID_FILE));
  } catch { /* empty */ }
}

function hasStopSignal(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, HAKANMCP_DIR, STOP_SIGNAL_FILE));
}

function removeStopSignal(cwd: string): void {
  try {
    fs.unlinkSync(path.join(cwd, HAKANMCP_DIR, STOP_SIGNAL_FILE));
  } catch { /* empty */ }
}

/**
 * CLI handler for `hakanmcp scheduled`.
 * Same lifecycle pattern as watchCommand.ts (spinner, signal handlers, stop-signal polling).
 */
export async function runScheduled(): Promise<void> {
  const cwd = process.cwd();

  let config;
  try {
    config = loadWorkspaceConfig(cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isMissing = msg.includes('not found');
    console.log('');
    console.log(`  ${chalk.hex('#FF6B6B')('✗')} ${chalk.hex('#F1F2F6')('Workspace config not loaded')}`);
    console.log(`    ${chalk.hex('#8395A7')(msg.split('\n')[0])}`);
    if (isMissing) {
      console.log(`\n  ${chalk.hex('#6C5CE7')('Hint:')} Run ${chalk.hex('#F1F2F6')('hakanmcp init')} to create workspace config.`);
    }
    console.log('');
    process.exitCode = 1;
    return;
  }

  const scheduleEnabled = config.schedule?.enabled ?? false;
  if (!scheduleEnabled) {
    console.warn(
      chalk.hex('#FDCB6E')('Scheduled mode is not enabled in config (schedule.enabled: false). Proceeding anyway...'),
    );
  }

  writePidFile(cwd, process.pid);
  removeStopSignal(cwd);

  const abortController = new AbortController();
  const { signal } = abortController;

  const shutdown = () => {
    abortController.abort();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const stopPollInterval = setInterval(() => {
    if (hasStopSignal(cwd)) {
      clearInterval(stopPollInterval);
      removeStopSignal(cwd);
      abortController.abort();
    }
  }, 1000);

  const spinner = ora({
    text: 'Starting scheduled mode...',
    color: 'magenta',
  }).start();

  const onEvent = (event: ScheduledSystemEvent): void => {
    switch (event.type) {
      case 'ready':
        spinner.text = chalk.hex('#00D68F')('Scheduled mode running. Waiting for next trigger...');
        break;
      case 'trigger:fired':
        spinner.text = `Trigger fired: ${event.trigger ?? 'unknown'}`;
        break;
      case 'action:start':
        spinner.text = `Running scheduled mission: ${event.trigger ?? 'unknown'}`;
        break;
      case 'action:complete':
        spinner.succeed(chalk.hex('#00D68F')(`Action completed: ${event.trigger ?? 'unknown'}`));
        spinner.start('Waiting for next trigger...');
        break;
      case 'action:failed':
        spinner.fail(chalk.hex('#FF6B6B')(`Action failed: ${event.trigger ?? 'unknown'} - ${event.error ?? ''}`));
        spinner.start('Waiting for next trigger...');
        break;
      case 'stopped':
        spinner.stop();
        break;
    }
  };

  try {
    await startScheduledMode(cwd, signal, onEvent);
    console.log(chalk.hex('#6C5CE7')('\nScheduled mode stopped.'));
  } catch (err) {
    spinner.fail(chalk.hex('#FF6B6B')(`Scheduled error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  } finally {
    clearInterval(stopPollInterval);
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    removePidFile(cwd);
  }
}
