/**
 * TriggerEngine — evaluates watch trigger conditions against file events.
 * Handles glob matching, extension filtering, content pattern matching,
 * directory exclusion, and per-trigger debouncing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import type { WatchEvent, WatchTrigger, TriggerResult } from './types.js';

const log = logger.child({ component: 'triggerEngine' });

function matchesPattern(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\\/g, '\\\\')
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/<<GLOBSTAR>>/g, '.*');
  return new RegExp(`^${regexStr}$`).test(filePath);
}

export type TriggerCallback = (result: TriggerResult) => void;

export class TriggerEngine {
  private triggers: WatchTrigger[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private callback: TriggerCallback | null = null;
  private defaultDebounceMs: number;

  constructor(defaultDebounceMs = 1000) {
    this.defaultDebounceMs = defaultDebounceMs;
  }

  /** Set the callback for when a trigger fires */
  onTrigger(callback: TriggerCallback): void {
    this.callback = callback;
  }

  /** Add triggers */
  addTriggers(triggers: WatchTrigger[]): void {
    this.triggers.push(...triggers);
    log.info('Triggers added', {
      count: triggers.length,
      names: triggers.map((t) => t.name),
    });
  }

  /** Clear all triggers and debounce timers */
  clear(): void {
    this.triggers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /** Evaluate an event against all triggers */
  evaluate(event: WatchEvent, cwd: string): void {
    for (const trigger of this.triggers) {
      const result = this.evaluateTrigger(trigger, event, cwd);
      if (result.matched) {
        this.debounceFire(trigger, result);
      }
    }
  }

  /** Evaluate a single trigger against an event */
  private evaluateTrigger(
    trigger: WatchTrigger,
    event: WatchEvent,
    cwd: string,
  ): TriggerResult {
    const filePath = event.path;

    const patternMatch = trigger.patterns.some((p) =>
      matchesPattern(filePath, p),
    );
    if (!patternMatch) {
      return { trigger, event, matched: false, reason: 'pattern_mismatch' };
    }

    if (trigger.extensions && trigger.extensions.length > 0) {
      const ext = path.extname(filePath).toLowerCase();
      if (!trigger.extensions.includes(ext)) {
        return { trigger, event, matched: false, reason: 'extension_mismatch' };
      }
    }

    if (trigger.excludeDirs && trigger.excludeDirs.length > 0) {
      const parts = filePath.split(/[/\\]/);
      const excluded = trigger.excludeDirs.some((dir) => parts.includes(dir));
      if (excluded) {
        return { trigger, event, matched: false, reason: 'excluded_dir' };
      }
    }

    if (trigger.contentMatch && event.type !== 'unlink') {
      try {
        const fullPath = path.resolve(cwd, filePath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const regex = new RegExp(trigger.contentMatch);
        if (!regex.test(content)) {
          return {
            trigger,
            event,
            matched: false,
            reason: 'content_mismatch',
          };
        }
      } catch (err) {
        log.warn('Content match read failed', {
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          trigger,
          event,
          matched: false,
          reason: 'content_read_error',
        };
      }
    }

    return { trigger, event, matched: true };
  }

  /** Debounce and fire trigger */
  private debounceFire(trigger: WatchTrigger, result: TriggerResult): void {
    const key = trigger.name;
    const debounceMs = trigger.debounceMs ?? this.defaultDebounceMs;

    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      log.debug('Trigger debounced', { trigger: key });
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      log.info('Trigger fired', { trigger: key, path: result.event.path });
      this.callback?.(result);
    }, debounceMs);

    this.debounceTimers.set(key, timer);
  }
}
