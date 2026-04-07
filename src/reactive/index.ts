export type {
  ReactiveSystemEvent,
  AssistantSystemEvent,
  BusEvent,
  EventMap,
} from './types.js';
export { EventBus, getEventBus, resetEventBus } from './eventBus.js';
export type { CrossModeRule } from './crossModeRouter.js';
export { registerCrossModeRules } from './crossModeRouter.js';

import type { ReactiveSystemEvent } from './types.js';
import type { WatchSystemEvent } from '../watch/types.js';
import type { ScheduledSystemEvent } from '../scheduled/types.js';
import { getEventBus, resetEventBus } from './eventBus.js';
import { registerCrossModeRules } from './crossModeRouter.js';
import { startWatchMode } from '../watch/index.js';
import { startScheduledMode } from '../scheduled/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'reactiveMode' });

/**
 * Start reactive mode: runs watch + scheduled modes in parallel via Promise.allSettled.
 * A single AbortSignal tears down all modes at once.
 * EventBus routes typed events between modes without direct imports.
 */
export async function startReactiveMode(
  cwd: string,
  signal: AbortSignal,
  onEvent?: (event: ReactiveSystemEvent) => void,
): Promise<void> {
  const bus = getEventBus();

  if (onEvent) {
    bus.on('bus:event', (busEvent) => {
      const sourceEvent = busEvent.event;
      const reactiveEvent: ReactiveSystemEvent = {
        type: sourceEvent.type as ReactiveSystemEvent['type'],
        source: busEvent.source as ReactiveSystemEvent['source'],
        trigger: 'trigger' in sourceEvent ? (sourceEvent.trigger as string | undefined) : undefined,
        path: 'path' in sourceEvent ? (sourceEvent.path as string | undefined) : undefined,
        error: 'error' in sourceEvent ? (sourceEvent.error as string | undefined) : undefined,
        timestamp: sourceEvent.timestamp,
      };
      onEvent(reactiveEvent);
    });
  }

  registerCrossModeRules(bus);

  bus.on('mode:ready', (payload) => {
    log.info('Mode ready', { mode: payload.mode });
  });
  bus.on('mode:stopped', (payload) => {
    log.info('Mode stopped', { mode: payload.mode });
  });

  const watchAdapter = (event: WatchSystemEvent): void => {
    bus.emit('watch:event', event);
    bus.emit('bus:event', { source: 'watch', event });

    if (event.type === 'ready') {
      bus.emit('mode:ready', { mode: 'watch', timestamp: event.timestamp });
    }
    if (event.type === 'stopped') {
      bus.emit('mode:stopped', { mode: 'watch', timestamp: event.timestamp });
    }
  };

  const scheduledAdapter = (event: ScheduledSystemEvent): void => {
    bus.emit('scheduled:event', event);
    bus.emit('bus:event', { source: 'scheduled', event });

    if (event.type === 'ready') {
      bus.emit('mode:ready', { mode: 'scheduled', timestamp: event.timestamp });
    }
    if (event.type === 'stopped') {
      bus.emit('mode:stopped', { mode: 'scheduled', timestamp: event.timestamp });
    }
  };

  const fs = await import('node:fs');
  const path = await import('node:path');
  const pidDir = path.join(cwd, '.hakanmcp');
  const pidFiles = ['watch.pid', 'scheduled.pid', 'reactive.pid'];

  for (const pidFile of pidFiles) {
    const pidPath = path.join(pidDir, pidFile);
    try {
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0);
            log.warn('Existing process detected, exiting early', {
              pidFile,
              pid,
            });
            onEvent?.({
              type: 'error',
              source: 'reactive',
              error: `Existing process detected: ${pidFile} (pid: ${pid})`,
              timestamp: Date.now(),
            });
            return;
          } catch { /* empty */
          }
        }
      }
    } catch { /* empty */
    }
  }

  log.info('Starting reactive mode', { cwd });

  const modesPromise = Promise.allSettled([
    startWatchMode(cwd, signal, watchAdapter),
    startScheduledMode(cwd, signal, scheduledAdapter),
  ]);

  let results: PromiseSettledResult<void>[];

  if (signal.aborted) {
    results = await modesPromise;
  } else {
    const shutdownTimeout = new Promise<'timeout'>((resolve) => {
      const onAbort = (): void => {
        setTimeout(() => resolve('timeout'), 10_000);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

    const raceResult = await Promise.race([
      modesPromise.then((r) => r),
      shutdownTimeout.then((t) => t),
    ]);

    if (raceResult === 'timeout') {
      log.warn('Shutdown timeout: modes did not stop within 10s after abort signal');
      results = await modesPromise;
    } else {
      results = raceResult;
    }
  }

  const modeNames = ['watch', 'scheduled'] as const;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      const errorMsg = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      log.error(`Mode ${modeNames[i]} failed`, result.reason as Error);
      onEvent?.({
        type: 'error',
        source: 'reactive',
        error: `Mode ${modeNames[i]} failed: ${errorMsg}`,
        timestamp: Date.now(),
      });
    }
  }

  resetEventBus();

  onEvent?.({
    type: 'stopped',
    source: 'reactive',
    timestamp: Date.now(),
  });

  log.info('Reactive mode stopped');
}
