/**
 * `hakanmcp reactive` command handler.
 * Starts watch + scheduled modes simultaneously via the reactive orchestrator.
 */
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { loadWorkspaceConfig } from './configValidator.js';
import { startReactiveMode } from '../reactive/index.js';
import type { ReactiveSystemEvent } from '../reactive/types.js';

const HAKANMCP_DIR = '.hakanmcp';
const PID_FILE = 'reactive.pid';
const STOP_SIGNAL_FILE = 'reactive-stop-signal';

function writePidFile(cwd: string, pid: number): void {
  const dir = path.join(cwd, HAKANMCP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PID_FILE), String(pid), 'utf8');
}

function removePidFile(cwd: string): void {
  try {
    fs.unlinkSync(path.join(cwd, HAKANMCP_DIR, PID_FILE));
  } catch {
    // Ignore
  }
}

function hasStopSignal(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, HAKANMCP_DIR, STOP_SIGNAL_FILE));
}

function removeStopSignal(cwd: string): void {
  try {
    fs.unlinkSync(path.join(cwd, HAKANMCP_DIR, STOP_SIGNAL_FILE));
  } catch {
    // Ignore
  }
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
 * Check for existing running modes. Returns mode name if conflict found, null if clear.
 */
function checkExistingModes(cwd: string): string | null {
  const modes = [
    { pidFile: 'watch.pid', label: 'watch' },
    { pidFile: 'scheduled.pid', label: 'scheduled' },
    { pidFile: 'reactive.pid', label: 'reactive' },
  ];

  for (const mode of modes) {
    const pidPath = path.join(cwd, HAKANMCP_DIR, mode.pidFile);
    try {
      const content = fs.readFileSync(pidPath, 'utf8').trim();
      const pid = parseInt(content, 10);
      if (Number.isFinite(pid) && isProcessAlive(pid)) {
        return mode.label;
      }
    } catch {
      // PID file not found or unreadable — no conflict
    }
  }

  return null;
}

/**
 * CLI handler for `hakanmcp reactive`.
 * Same lifecycle pattern as watchCommand.ts / scheduledCommand.ts.
 */
export async function runReactive(): Promise<void> {
  const cwd = process.cwd();

  // 1. Load workspace config
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

  // 2. Check for existing running modes (prevent double-registration)
  const existingMode = checkExistingModes(cwd);
  if (existingMode) {
    console.error(
      chalk.hex('#FF6B6B')(`Another mode (${existingMode}) is already running. Stop it first with: hakanmcp stop`),
    );
    process.exitCode = 1;
    return;
  }

  // 3. Setup lifecycle
  writePidFile(cwd, process.pid);
  removeStopSignal(cwd);

  const abortController = new AbortController();
  const { signal } = abortController;

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
    text: 'Starting reactive mode (watch + scheduled)...',
    color: 'magenta',
  }).start();

  // 4. Event handler updates spinner
  const onEvent = (event: ReactiveSystemEvent): void => {
    switch (event.type) {
      case 'ready':
        spinner.text = chalk.hex('#00D68F')('Reactive mode running (watch + scheduled). Waiting for events...');
        break;
      case 'trigger:fired':
        spinner.text = `Trigger fired [${event.source}]: ${event.trigger ?? 'unknown'} (${event.path ?? ''})`;
        break;
      case 'action:start':
        spinner.text = `Running action [${event.source}]: ${event.trigger ?? 'unknown'}`;
        break;
      case 'action:complete':
        spinner.succeed(chalk.hex('#00D68F')(`Action completed [${event.source}]: ${event.trigger ?? 'unknown'}`));
        spinner.start('Waiting for events...');
        break;
      case 'action:failed':
        spinner.fail(chalk.hex('#FF6B6B')(`Action failed [${event.source}]: ${event.trigger ?? 'unknown'} - ${event.error ?? ''}`));
        spinner.start('Waiting for events...');
        break;
      case 'error':
        spinner.fail(chalk.hex('#FF6B6B')(`Error [${event.source}]: ${event.error ?? 'unknown'}`));
        spinner.start('Waiting for events...');
        break;
      case 'stopped':
        spinner.stop();
        break;
    }
  };

  // 5. Run reactive mode
  try {
    await startReactiveMode(cwd, signal, onEvent);
    console.log(chalk.hex('#6C5CE7')('\nReactive mode stopped.'));
  } catch (err) {
    spinner.fail(chalk.hex('#FF6B6B')(`Reactive error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  } finally {
    clearInterval(stopPollInterval);
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    removePidFile(cwd);
  }
}
