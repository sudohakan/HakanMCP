import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';

const HAKANMCP_DIR = '.hakanmcp';

const PID_CONFIGS = [
  { pidFile: 'agent.pid', stopSignal: 'stop-signal', label: 'agent' },
  { pidFile: 'watch.pid', stopSignal: 'watch-stop-signal', label: 'watch' },
  { pidFile: 'scheduled.pid', stopSignal: 'scheduled-stop-signal', label: 'scheduled' },
  { pidFile: 'reactive.pid', stopSignal: 'reactive-stop-signal', label: 'reactive' },
];

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
 * Read PID from a PID file. Returns null if not found.
 */
function readPidFile(cwd: string, pidFile: string): number | null {
  const pidPath = path.join(cwd, HAKANMCP_DIR, pidFile);
  try {
    const content = fs.readFileSync(pidPath, 'utf8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Remove a PID file.
 */
function removePidFile(cwd: string, pidFile: string): void {
  const pidPath = path.join(cwd, HAKANMCP_DIR, pidFile);
  try {
    fs.unlinkSync(pidPath);
  } catch { /* empty */
  }
}

/**
 * Remove a stop-signal file.
 */
function removeStopSignal(cwd: string, signalFile: string): void {
  const signalPath = path.join(cwd, HAKANMCP_DIR, signalFile);
  try {
    fs.unlinkSync(signalPath);
  } catch { /* empty */
  }
}

/**
 * Sleep for given milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stop a single running process by PID config.
 * Returns true if stopped successfully, false otherwise.
 */
async function stopProcess(
  cwd: string,
  config: typeof PID_CONFIGS[number],
  pid: number,
): Promise<boolean> {
  const signalPath = path.join(cwd, HAKANMCP_DIR, config.stopSignal);
  fs.mkdirSync(path.join(cwd, HAKANMCP_DIR), { recursive: true });
  fs.writeFileSync(signalPath, String(Date.now()), 'utf8');

  try {
    process.kill(pid, 'SIGTERM');
  } catch { /* empty */
  }

  const spinner = ora({
    text: `Stopping ${config.label} (PID ${pid})...`,
    color: 'magenta',
  }).start();

  const MAX_ATTEMPTS = 10;
  let stopped = false;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await sleep(1000);
    if (!isProcessAlive(pid)) {
      stopped = true;
      break;
    }
    spinner.text = `Waiting for ${config.label} to stop (${i + 1}/${MAX_ATTEMPTS})...`;
  }

  if (!stopped) {
    spinner.text = `Force killing ${config.label}...`;
    try {
      process.kill(pid, 'SIGKILL');
    } catch { /* empty */
    }
    await sleep(500);
    stopped = !isProcessAlive(pid);
  }

  removePidFile(cwd, config.pidFile);
  removeStopSignal(cwd, config.stopSignal);

  if (stopped) {
    spinner.succeed(chalk.hex('#00D68F')(`${config.label} stopped (PID ${pid}).`));
  } else {
    spinner.fail(chalk.hex('#FF6B6B')(`Failed to stop ${config.label} (PID ${pid}).`));
  }

  return stopped;
}

/**
 * Stop all running processes gracefully.
 */
export async function runStop(): Promise<void> {
  const cwd = process.cwd();

  let anyFound = false;
  let anyFailed = false;

  for (const config of PID_CONFIGS) {
    const pid = readPidFile(cwd, config.pidFile);

    if (pid === null) {
      continue;
    }

    if (!isProcessAlive(pid)) {
      removePidFile(cwd, config.pidFile);
      continue;
    }

    anyFound = true;
    const stopped = await stopProcess(cwd, config, pid);
    if (!stopped) {
      anyFailed = true;
    }
  }

  if (!anyFound) {
    console.log(chalk.hex('#8395A7')('No agent running.'));
    return;
  }

  if (anyFailed) {
    process.exitCode = 1;
  }
}
