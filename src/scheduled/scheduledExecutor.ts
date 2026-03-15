/**
 * ScheduledExecutor -- executes missions on schedule via runMission().
 * Wraps execution with error isolation so the scheduler keeps running.
 * Mirrors src/watch/actionExecutor.ts architecture.
 */
import type { ParsedMission, MissionRunnerConfig, MissionEvent } from '../mission/types.js';
import type { ScheduledSystemEvent } from './types.js';
import { MissionStateManager } from '../mission/missionState.js';
import { runMission } from '../mission/missionRunner.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'scheduledExecutor' });

/** Default runner configuration for scheduled missions */
const DEFAULT_CONFIG: MissionRunnerConfig = {
  maxIterationsPerStep: 10,
  stepTimeoutMs: 120_000,
  maxTotalTimeMs: 600_000,
  maxRetriesPerStep: 2,
  continueOnFailure: false,
};

/**
 * ScheduledExecutor receives ParsedMission and runs it via runMission().
 * Errors are caught and logged -- the scheduler keeps running.
 */
export class ScheduledExecutor {
  constructor(private onEvent?: (event: ScheduledSystemEvent) => void) {}

  /** Execute a scheduled mission */
  async execute(mission: ParsedMission, cwd: string, signal: AbortSignal): Promise<void> {
    const triggerName = mission.frontmatter.title;

    this.emitEvent({
      type: 'action:start',
      trigger: triggerName,
      timestamp: Date.now(),
    });

    log.info('Executing scheduled mission', { trigger: triggerName, path: mission.filePath });

    try {
      // Create state manager for persistence
      const stateManager = new MissionStateManager(cwd);
      await stateManager.ensureDir();

      // Build config from defaults
      const config: MissionRunnerConfig = { ...DEFAULT_CONFIG };

      // Progress callback logs via winston
      const onProgress = (event: MissionEvent): void => {
        log.debug('Mission progress', { trigger: triggerName, event: event.type, step: event.stepId });
      };

      // Run the mission
      const result = await runMission(mission, stateManager, config, signal, onProgress);

      log.info('Scheduled mission completed', {
        trigger: triggerName,
        status: result.status,
        duration: result.duration,
        provider: result.provider,
      });

      this.emitEvent({
        type: 'action:complete',
        trigger: triggerName,
        timestamp: Date.now(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error('Scheduled mission execution failed', { trigger: triggerName, error: errorMsg });

      this.emitEvent({
        type: 'action:failed',
        trigger: triggerName,
        error: errorMsg,
        timestamp: Date.now(),
      });
      // Do NOT rethrow -- scheduler must keep running
    }
  }

  private emitEvent(event: ScheduledSystemEvent): void {
    this.onEvent?.(event);
  }
}
