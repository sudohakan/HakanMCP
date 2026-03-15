/**
 * Watch module barrel export + orchestrator.
 * Provides startWatchMode to wire FileWatcher -> TriggerEngine -> ActionExecutor.
 */
export { FileWatcher } from './fileWatcher.js';
export { TriggerEngine } from './triggerEngine.js';
export { ActionExecutor } from './actionExecutor.js';
export type {
  WatchTrigger,
  WatchAction,
  WatchEvent,
  WatchConfig,
  TriggerResult,
  WatchSystemEvent,
} from './types.js';

import { FileWatcher } from './fileWatcher.js';
import { TriggerEngine } from './triggerEngine.js';
import { ActionExecutor } from './actionExecutor.js';
import type { WatchTrigger, WatchSystemEvent } from './types.js';
import type { ParsedMission } from '../mission/types.js';
import { loadAllMissions } from '../mission/missionLoader.js';
import { loadWorkspaceConfig } from '../cli/configValidator.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'watchIndex' });

/**
 * Extract WatchTriggers from missions that have schedule.mode === 'watch'.
 * Each matching mission becomes a trigger watching its targets array.
 */
export function extractTriggersFromMissions(missions: ParsedMission[]): WatchTrigger[] {
  const triggers: WatchTrigger[] = [];

  for (const mission of missions) {
    if (mission.frontmatter.schedule?.mode !== 'watch') continue;

    const targets = mission.frontmatter.targets;
    if (!targets || targets.length === 0) {
      log.warn('Watch mission has no targets, skipping', { title: mission.frontmatter.title });
      continue;
    }

    // Build prompt from mission description + task descriptions
    const taskList = mission.tasks
      .map((t) => `- ${t.description}`)
      .join('\n');

    const prompt = [
      mission.description || mission.frontmatter.title,
      taskList ? `\nTasks:\n${taskList}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    triggers.push({
      name: mission.frontmatter.title.replace(/[^a-zA-Z0-9_-]/g, '_'),
      patterns: targets,
      action: {
        type: 'analyze',
        prompt,
      },
    });
  }

  return triggers;
}

/**
 * Start the watch system end-to-end.
 * Wires FileWatcher -> TriggerEngine -> ActionExecutor and waits for abort signal.
 */
export async function startWatchMode(
  cwd: string,
  signal: AbortSignal,
  onEvent?: (event: WatchSystemEvent) => void,
): Promise<void> {
  // 1. Load workspace config
  const config = loadWorkspaceConfig(cwd);
  const watchConfig = config.watch ?? { enabled: false, paths: [], debounceMs: 1000 };

  // 2. Load missions and extract watch triggers
  const missions = loadAllMissions(cwd);
  const missionTriggers = extractTriggersFromMissions(missions);

  // 3. Merge workspace paths with mission-derived patterns
  const allPatterns = [
    ...watchConfig.paths,
    ...missionTriggers.flatMap((t) => t.patterns),
  ];

  if (allPatterns.length === 0) {
    log.warn('No watch patterns found (workspace config + missions). Nothing to watch.');
    onEvent?.({ type: 'stopped', timestamp: Date.now() });
    return;
  }

  // 4. Create components
  const fileWatcher = new FileWatcher(allPatterns, {
    cwd,
    ignoreInitial: true,
  });

  const triggerEngine = new TriggerEngine(watchConfig.debounceMs);
  const actionExecutor = new ActionExecutor([], onEvent, 5);

  // 5. Add triggers
  triggerEngine.addTriggers(missionTriggers);

  // 6. Wire: fileWatcher -> triggerEngine -> actionExecutor
  fileWatcher.onEvent((event) => {
    triggerEngine.evaluate(event, cwd);
  });

  triggerEngine.onTrigger((result) => {
    if (result.matched) {
      onEvent?.({
        type: 'trigger:fired',
        trigger: result.trigger.name,
        path: result.event.path,
        timestamp: Date.now(),
      });
      // Fire-and-forget -- errors are handled inside ActionExecutor
      actionExecutor.execute(result).catch(() => {});
    }
  });

  // 7. Start watching
  await fileWatcher.start();

  onEvent?.({ type: 'ready', timestamp: Date.now() });
  log.info('Watch mode started', { patterns: allPatterns.length, triggers: missionTriggers.length });

  // 8. Wait for abort signal
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });

  // 9. Cleanup
  await fileWatcher.stop();
  triggerEngine.clear();

  onEvent?.({ type: 'stopped', timestamp: Date.now() });
  log.info('Watch mode stopped');
}
