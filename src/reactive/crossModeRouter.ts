/**
 * Declarative cross-mode routing rules.
 * Evaluates rules on EventBus events to trigger actions across mode boundaries.
 */

import type { EventBus } from './eventBus.js';
import type { EventMap } from './types.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'crossModeRouter' });

/** A declarative rule for cross-mode event forwarding */
export interface CrossModeRule {
  name: string;
  sourceEvent: keyof EventMap;
  condition: (payload: unknown) => boolean;
  action: (bus: EventBus, payload: unknown) => void;
}

/**
 * Register cross-mode rules on the EventBus.
 * Each rule listens for its sourceEvent, checks its condition, and fires its action.
 * Default rules array is empty — extensible by callers.
 *
 * Pitfall 5: Async handlers wrapped with .catch() to prevent silent error loss.
 */
export function registerCrossModeRules(bus: EventBus, rules: CrossModeRule[] = []): void {
  for (const rule of rules) {
    bus.on(rule.sourceEvent, (payload: EventMap[typeof rule.sourceEvent]) => {
      try {
        if (rule.condition(payload)) {
          // Pitfall 5: wrap in Promise.resolve to catch both sync and async errors
          Promise.resolve().then(() => rule.action(bus, payload)).catch((err: unknown) => {
            log.error('Cross-mode rule async action failed', err as Error, {
              rule: rule.name,
            });
          });
        }
      } catch (err) {
        log.error('Cross-mode rule action failed', err as Error, {
          rule: rule.name,
        });
      }
    });
  }

  if (rules.length > 0) {
    log.info('Cross-mode rules registered', { count: rules.length });
  }
}
