export { ScheduledExecutor } from './scheduledExecutor.js';
export { parseInterval } from './intervalParser.js';
export type { ParsedInterval } from './intervalParser.js';
export type {
  ScheduledTrigger,
  ScheduledSystemEvent,
  ScheduledConfig,
} from './types.js';

import cron from 'node-cron';
import type { ParsedMission } from '../mission/types.js';
import type { ScheduledTrigger, ScheduledSystemEvent } from './types.js';
import { parseInterval } from './intervalParser.js';
import { ScheduledExecutor } from './scheduledExecutor.js';
import { loadAllMissions } from '../mission/missionLoader.js';
import { loadWorkspaceConfig } from '../cli/configValidator.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'scheduledMode' });

/**
 * Extract ScheduledTriggers from missions that have schedule.mode === 'scheduled'.
 * Each matching mission becomes a trigger with a cron expression or interval.
 */
export function extractScheduledFromMissions(missions: ParsedMission[]): ScheduledTrigger[] {
  const triggers: ScheduledTrigger[] = [];

  for (const mission of missions) {
    if (mission.frontmatter.schedule?.mode !== 'scheduled') continue;

    const schedule = mission.frontmatter.schedule;
    const name = mission.frontmatter.title.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (schedule.cron) {
      triggers.push({
        name,
        missionPath: mission.filePath,
        cronExpression: schedule.cron,
        useCron: true,
        enabled: true,
      });
    } else if (schedule.interval) {
      try {
        const parsed = parseInterval(schedule.interval);
        triggers.push({
          name,
          missionPath: mission.filePath,
          cronExpression: parsed.cronExpression,
          intervalMs: parsed.intervalMs,
          useCron: parsed.useCron,
          enabled: true,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.warn('Failed to parse schedule interval, skipping mission', {
          title: mission.frontmatter.title,
          interval: schedule.interval,
          error: errorMsg,
        });
      }
    } else {
      log.warn('Scheduled mission has neither cron nor interval, skipping', {
        title: mission.frontmatter.title,
      });
    }
  }

  return triggers;
}

/**
 * Start the scheduled system end-to-end.
 * Creates cron jobs or interval timers for each scheduled mission and waits for abort signal.
 */
export async function startScheduledMode(
  cwd: string,
  signal: AbortSignal,
  onEvent?: (event: ScheduledSystemEvent) => void,
): Promise<void> {
  const config = loadWorkspaceConfig(cwd);
  const scheduleConfig = config.schedule ?? { enabled: false };

  if (!scheduleConfig.enabled) {
    log.warn('Scheduled mode is disabled in workspace config. Proceeding anyway with mission-level schedules.');
  }

  const missions = loadAllMissions(cwd);
  const triggers = extractScheduledFromMissions(missions);

  if (triggers.length === 0) {
    log.warn('No scheduled triggers found. Nothing to schedule.');
    onEvent?.({ type: 'stopped', timestamp: Date.now() });
    return;
  }

  const runningGuards = new Map<string, boolean>();
  const cronTasks: cron.ScheduledTask[] = [];
  const intervalTimers: ReturnType<typeof setInterval>[] = [];

  for (const trigger of triggers) {
    if (!trigger.enabled) continue;

    runningGuards.set(trigger.name, false);

    const executeCallback = async (): Promise<void> => {
      if (runningGuards.get(trigger.name)) {
        log.warn('Skipping scheduled execution — previous run still active', {
          trigger: trigger.name,
        });
        return;
      }

      runningGuards.set(trigger.name, true);

      onEvent?.({
        type: 'trigger:fired',
        trigger: trigger.name,
        timestamp: Date.now(),
      });

      try {
        const executor = new ScheduledExecutor(onEvent);
        const currentMissions = loadAllMissions(cwd);
        const mission = currentMissions.find((m) => m.filePath === trigger.missionPath);

        if (!mission) {
          log.error('Mission file not found for scheduled trigger', {
            trigger: trigger.name,
            path: trigger.missionPath,
          });
          return;
        }

        await executor.execute(mission, cwd, signal);
      } finally {
        runningGuards.set(trigger.name, false);
      }
    };

    if (!trigger.useCron && trigger.intervalMs) {
      log.info('Registering interval timer for trigger', {
        trigger: trigger.name,
        intervalMs: trigger.intervalMs,
      });
      const timer = setInterval(() => {
        executeCallback().catch(() => {});
      }, trigger.intervalMs);
      intervalTimers.push(timer);
    } else {
      if (!cron.validate(trigger.cronExpression)) {
        log.error('Invalid cron expression, skipping trigger', {
          trigger: trigger.name,
          cron: trigger.cronExpression,
        });
        continue;
      }

      log.info('Registering cron job for trigger', {
        trigger: trigger.name,
        cron: trigger.cronExpression,
      });
      const task = cron.schedule(trigger.cronExpression, () => {
        executeCallback().catch(() => {});
      });
      cronTasks.push(task);
    }
  }

  onEvent?.({ type: 'ready', timestamp: Date.now() });
  log.info('Scheduled mode started', { triggers: triggers.length });

  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });

  for (const task of cronTasks) {
    task.stop();
  }
  for (const timer of intervalTimers) {
    clearInterval(timer);
  }

  onEvent?.({ type: 'stopped', timestamp: Date.now() });
  log.info('Scheduled mode stopped');
}
