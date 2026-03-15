/**
 * Scheduled system type definitions.
 * Shared contract for intervalParser, scheduledExecutor, and orchestrator.
 * Mirrors src/watch/types.ts architecture.
 */

/** A single scheduled trigger: cron expression + mission binding */
export interface ScheduledTrigger {
  name: string;
  missionPath: string;
  cronExpression: string;
  intervalMs?: number;
  useCron: boolean;
  enabled: boolean;
}

/** Scheduled system lifecycle events */
export interface ScheduledSystemEvent {
  type:
    | 'ready'
    | 'trigger:fired'
    | 'action:start'
    | 'action:complete'
    | 'action:failed'
    | 'error'
    | 'stopped';
  trigger?: string;
  error?: string;
  timestamp: number;
}

/** Combined scheduled configuration (workspace config + mission triggers) */
export interface ScheduledConfig {
  enabled: boolean;
  triggers: ScheduledTrigger[];
  cwd: string;
}
