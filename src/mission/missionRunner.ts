import { runAgenticLoop } from '../services/agenticLoop.js';
import { resolveAgenticProvider } from '../tools/aiTools.js';
import type { ToolExecutor } from '../services/toolExecutor.js';
import { buildAgenticToolList, createToolExecutor } from '../services/toolExecutor.js';
import type {
  ParsedMission,
  MissionState,
  MissionStepState,
  MissionRunnerConfig,
  MissionEvent,
  MissionRunResult,
} from './types.js';
import type { MissionStateManager } from './missionState.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'missionRunner' });

/**
 * Returns a promise that rejects after `ms` milliseconds or on abort signal.
 */
function timeoutPromise(ms: number, signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Step timed out after ${ms}ms`));
    }, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Mission aborted'));
      };
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new Error('Mission aborted'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Filter tools by name subset. If no subset provided, return all.
 */
interface ToolLike {
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}

function filterToolsForMission(
  allTools: ToolLike[],
  subset?: string[],
): ToolLike[] {
  if (!subset || subset.length === 0) return allTools;
  const allowed = new Set(subset);
  return allTools.filter((t) => allowed.has(t.name));
}

/**
 * Run a mission by executing each step sequentially via runAgenticLoop.
 * State is persisted before and after each step for crash resilience.
 */
export async function runMission(
  mission: ParsedMission,
  stateManager: MissionStateManager,
  config: MissionRunnerConfig,
  signal: AbortSignal,
  onProgress: (event: MissionEvent) => void,
  tools?: ToolLike[],
): Promise<MissionRunResult> {
  const startTime = Date.now();

  const { callFn, label: providerLabel } = resolveAgenticProvider();
  log.info('Mission started', {
    missionId: mission.frontmatter.title,
    provider: providerLabel,
    steps: mission.tasks.length,
  });

  const filteredTools = tools ? filterToolsForMission(tools, config.toolSubset) : [];
  const toolDefs = buildAgenticToolList(filteredTools);
  const executor: ToolExecutor = createToolExecutor(filteredTools);

  const steps: MissionStepState[] = mission.tasks.map((task) => ({
    id: task.id,
    description: task.description,
    status: 'pending' as const,
    retryCount: 0,
  }));

  const missionState: MissionState = {
    missionId: mission.tasks.length > 0 ? mission.tasks[0].id : 'unknown',
    filePath: mission.filePath,
    title: mission.frontmatter.title,
    status: 'running',
    currentStepIndex: 0,
    steps,
    startedAt: startTime,
    updatedAt: startTime,
    provider: providerLabel,
  };
  await stateManager.ensureDir();
  stateManager.saveState(missionState);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    missionState.currentStepIndex = i;

    if (signal.aborted) {
      log.info('Mission aborted, skipping remaining steps', { fromStep: i });
      for (let j = i; j < steps.length; j++) {
        steps[j].status = 'skipped';
      }
      break;
    }

    if (Date.now() - startTime > config.maxTotalTimeMs) {
      log.warn('Mission total time exceeded', {
        elapsed: Date.now() - startTime,
        budget: config.maxTotalTimeMs,
      });
      for (let j = i; j < steps.length; j++) {
        steps[j].status = 'skipped';
      }
      missionState.status = 'failed';
      stateManager.saveState(missionState);
      return {
        status: 'timeout',
        steps,
        duration: Date.now() - startTime,
        provider: providerLabel,
      };
    }

    step.status = 'running';
    step.startedAt = Date.now();

    stateManager.saveState(missionState);

    onProgress({
      type: 'step:start',
      stepId: step.id,
      index: i,
      total: steps.length,
    });

    const previousResults = steps
      .slice(0, i)
      .filter((s) => s.status === 'completed' && s.result)
      .map((s) => `- ${s.description}: ${s.result}`)
      .join('\n');

    const systemPrompt = [
      `Mission: ${mission.frontmatter.title}`,
      mission.description ? `Description: ${mission.description}` : '',
      `Current step (${i + 1}/${steps.length}): ${step.description}`,
      previousResults
        ? `\nPrevious completed steps:\n${previousResults}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    let stepSucceeded = false;
    let lastError: string | undefined;

    for (let retry = 0; retry <= config.maxRetriesPerStep; retry++) {
      if (retry > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, retry), 30000);
        log.info('Retrying step after backoff', {
          step: step.id,
          retry,
          backoffMs,
        });
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      try {
        const loopResult = await Promise.race([
          runAgenticLoop(
            systemPrompt,
            [
              {
                role: 'user' as const,
                content: [{ type: 'text' as const, text: step.description }],
              },
            ],
            toolDefs,
            executor,
            callFn,
            providerLabel,
            { maxIterations: config.maxIterationsPerStep },
          ),
          timeoutPromise(config.stepTimeoutMs, signal),
        ]);

        step.result = loopResult.text || 'Step completed (no text output)';
        step.status = 'completed';
        step.completedAt = Date.now();
        stepSucceeded = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        step.retryCount = retry + 1;
        log.warn('Step execution error', {
          step: step.id,
          retry,
          error: lastError,
        });

        if (signal.aborted) break;
      }
    }

    if (!stepSucceeded) {
      step.status = 'failed';
      step.error = lastError || 'Unknown error';
      step.completedAt = Date.now();

      onProgress({
        type: 'step:failed',
        stepId: step.id,
        index: i,
        total: steps.length,
        error: step.error,
      });

      if (!config.continueOnFailure) {
        missionState.status = 'failed';
        stateManager.saveState(missionState);
        onProgress({
          type: 'mission:failed',
          error: `Step ${i + 1} failed: ${step.error}`,
        });
        return {
          status: 'failed',
          steps,
          duration: Date.now() - startTime,
          provider: providerLabel,
        };
      }
    } else {
      onProgress({
        type: 'step:complete',
        stepId: step.id,
        index: i,
        total: steps.length,
      });
    }

    stateManager.saveState(missionState);
  }

  const anyFailed = steps.some((s) => s.status === 'failed');
  const allSkipped = steps.every(
    (s) => s.status === 'skipped' || s.status === 'pending',
  );
  const finalStatus: MissionRunResult['status'] = signal.aborted
    ? 'aborted'
    : anyFailed
      ? 'failed'
      : allSkipped
        ? 'aborted'
        : 'completed';

  missionState.status =
    finalStatus === 'completed'
      ? 'completed'
      : finalStatus === 'aborted'
        ? 'paused'
        : 'failed';
  stateManager.saveState(missionState);

  onProgress({
    type: finalStatus === 'completed' ? 'mission:complete' : 'mission:failed',
  });

  log.info('Mission finished', {
    status: finalStatus,
    duration: Date.now() - startTime,
    stepsCompleted: steps.filter((s) => s.status === 'completed').length,
    stepsFailed: steps.filter((s) => s.status === 'failed').length,
  });

  return {
    status: finalStatus,
    steps,
    duration: Date.now() - startTime,
    provider: providerLabel,
  };
}
