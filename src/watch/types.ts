/**
 * Watch system type definitions.
 * Shared contract for fileWatcher, triggerEngine, and actionExecutor.
 */

/** Describes what action to take when a trigger fires */
export interface WatchAction {
  type: 'analyze' | 'fix' | 'notify' | 'custom';
  prompt: string;
  toolSubset?: string[];
}

/** A single watch trigger: pattern match + conditions + action */
export interface WatchTrigger {
  name: string;
  patterns: string[];
  extensions?: string[];
  contentMatch?: string;
  excludeDirs?: string[];
  action: WatchAction;
  debounceMs?: number;
}

/** A file change event from chokidar */
export interface WatchEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  timestamp: number;
}

/** Combined watch configuration (workspace config + mission triggers) */
export interface WatchConfig {
  enabled: boolean;
  basePaths: string[];
  debounceMs: number;
  triggers: WatchTrigger[];
  cwd: string;
}

/** Result of trigger evaluation */
export interface TriggerResult {
  trigger: WatchTrigger;
  event: WatchEvent;
  matched: boolean;
  reason?: string;
}

/** Watch system lifecycle events */
export interface WatchSystemEvent {
  type:
    | 'ready'
    | 'trigger:fired'
    | 'trigger:debounced'
    | 'action:start'
    | 'action:complete'
    | 'action:failed'
    | 'error'
    | 'stopped';
  trigger?: string;
  path?: string;
  error?: string;
  timestamp: number;
}
