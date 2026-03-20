/**
 * Central registry for tracking all spawned child processes.
 * Ensures graceful cleanup on shutdown — prevents zombie processes.
 */
import { ChildProcess } from 'node:child_process';
import { logger } from './logger.js';

class ProcessRegistry {
  private processes = new Map<number, { child: ChildProcess; label: string }>();

  /**
   * Register a child process for tracking.
   * Automatically unregisters on exit.
   */
  track(child: ChildProcess, label: string): ChildProcess {
    const pid = child.pid;
    if (pid == null) return child;

    this.processes.set(pid, { child, label });

    const unregister = () => {
      this.processes.delete(pid);
    };
    child.once('exit', unregister);
    child.once('error', unregister);

    return child;
  }

  /**
   * Kill all tracked child processes.
   * Tries SIGTERM first, then SIGKILL after timeout.
   */
  async killAll(timeoutMs = 3000): Promise<void> {
    if (this.processes.size === 0) return;

    const entries = Array.from(this.processes.entries());
    logger.info('Killing tracked child processes', {
      count: entries.length,
      pids: entries.map(([pid, { label }]) => `${pid}(${label})`),
    });

    for (const [, { child, label }] of entries) {
      try {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      } catch {
        logger.debug(`Failed to SIGTERM ${label}`);
      }
    }

    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.processes.size === 0) {
          clearTimeout(forceTimer);
          resolve();
        }
      };

      check();

      const interval = setInterval(check, 100);

      const forceTimer = setTimeout(() => {
        clearInterval(interval);
        for (const [pid, { child, label }] of this.processes.entries()) {
          try {
            if (!child.killed) {
              child.kill('SIGKILL');
              logger.warn(`Force-killed child process`, { pid, label });
            }
          } catch {
            /* empty */
          }
        }
        this.processes.clear();
        resolve();
      }, timeoutMs);
    });
  }

  get size(): number {
    return this.processes.size;
  }
}

export const processRegistry = new ProcessRegistry();
