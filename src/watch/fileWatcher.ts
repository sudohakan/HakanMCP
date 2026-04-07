/**
 * FileWatcher — chokidar wrapper for file/directory monitoring.
 * Manages watcher lifecycle, emits WatchEvent objects.
 */
import { watch, type FSWatcher } from 'chokidar';
import { logger } from '../utils/logger.js';
import type { WatchEvent } from './types.js';

const log = logger.child({ component: 'fileWatcher' });

export type WatchEventHandler = (event: WatchEvent) => void;

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private handlers: WatchEventHandler[] = [];
  private ready = false;

  constructor(
    private readonly patterns: string[],
    private readonly options: {
      cwd: string;
      ignoreInitial?: boolean;
      awaitWriteFinish?:
        | boolean
        | { stabilityThreshold: number; pollInterval: number };
      ignored?: string | RegExp | string[];
    },
  ) {}

  /** Register an event handler */
  onEvent(handler: WatchEventHandler): void {
    this.handlers.push(handler);
  }

  /** Start watching */
  async start(): Promise<void> {
    if (this.watcher) {
      log.warn('FileWatcher already started');
      return;
    }

    log.info('Starting file watcher', {
      patterns: this.patterns,
      cwd: this.options.cwd,
    });

    this.watcher = watch(this.patterns, {
      cwd: this.options.cwd,
      ignoreInitial: this.options.ignoreInitial ?? true,
      awaitWriteFinish: this.options.awaitWriteFinish ?? {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
      ignored: this.options.ignored ?? /(^|[/\\])\./,
      persistent: true,
    });

    this.watcher.on('add', (filePath) => this.emit('add', filePath));
    this.watcher.on('change', (filePath) => this.emit('change', filePath));
    this.watcher.on('unlink', (filePath) => this.emit('unlink', filePath));
    this.watcher.on('error', (error: unknown) => {
      log.error('File watcher error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return new Promise<void>((resolve) => {
      this.watcher!.on('ready', () => {
        this.ready = true;
        log.info('File watcher ready');
        resolve();
      });
    });
  }

  /** Stop watching and cleanup */
  async stop(): Promise<void> {
    if (!this.watcher) return;
    log.info('Stopping file watcher');
    await this.watcher.close();
    this.watcher = null;
    this.ready = false;
    this.handlers = [];
  }

  /** Check if watcher is active */
  isActive(): boolean {
    return this.watcher !== null && this.ready;
  }

  private emit(type: WatchEvent['type'], filePath: string): void {
    const event: WatchEvent = {
      type,
      path: filePath,
      timestamp: Date.now(),
    };
    log.debug('File event', { type, path: filePath });
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        log.error('Event handler error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
