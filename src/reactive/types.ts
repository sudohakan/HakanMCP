/**
 * Reactive mode type definitions.
 * Unified event types for cross-mode communication via EventBus.
 */

import type { WatchSystemEvent } from '../watch/types.js';
import type { ScheduledSystemEvent } from '../scheduled/types.js';

/** Unified reactive event combining watch + scheduled event types */
export interface ReactiveSystemEvent {
  type:
    | 'ready'
    | 'trigger:fired'
    | 'trigger:debounced'
    | 'action:start'
    | 'action:complete'
    | 'action:failed'
    | 'error'
    | 'stopped';
  source: 'watch' | 'scheduled' | 'assistant' | 'reactive';
  trigger?: string;
  path?: string;
  error?: string;
  timestamp: number;
}

/** Assistant mode events for future integration */
export interface AssistantSystemEvent {
  type: 'query' | 'context:updated' | 'response:complete';
  query?: string;
  timestamp: number;
}

/** Envelope for any event passing through the bus */
export interface BusEvent {
  source: 'watch' | 'scheduled' | 'assistant' | 'system';
  event: WatchSystemEvent | ScheduledSystemEvent | AssistantSystemEvent;
}

/** Typed event map for EventBus generics */
export interface EventMap {
  'watch:event': WatchSystemEvent;
  'scheduled:event': ScheduledSystemEvent;
  'assistant:event': AssistantSystemEvent;
  'bus:event': BusEvent;
  'mode:ready': { mode: string; timestamp: number };
  'mode:stopped': { mode: string; timestamp: number };
  'cross:trigger': {
    sourceMode: string;
    sourceEvent: string;
    targetMode: string;
    targetAction: string;
    payload: Record<string, unknown>;
  };
}
