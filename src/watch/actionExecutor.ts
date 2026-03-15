/**
 * ActionExecutor -- executes AI-driven actions when watch triggers fire.
 * Delegates to runAgenticLoop for AI processing.
 */
import type { AgenticCallFn } from '../services/agenticLoop.js';
import { runAgenticLoop } from '../services/agenticLoop.js';
import { resolveAgenticProvider } from '../tools/aiTools.js';
import { buildAgenticToolList, createToolExecutor } from '../services/toolExecutor.js';
import type { TriggerResult, WatchSystemEvent } from './types.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'actionExecutor' });

/** Tool interface matching missionRunner pattern */
interface ToolLike {
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}

export type ActionEventHandler = (event: WatchSystemEvent) => void;

// Provider resolution delegated to resolveAgenticProvider() in aiTools.ts

/**
 * ActionExecutor receives TriggerResults and runs AI actions via runAgenticLoop.
 * Errors are caught and logged -- the watch system keeps running.
 */
export class ActionExecutor {
  private readonly maxIter: number;

  constructor(
    private tools: ToolLike[],
    private onEvent?: ActionEventHandler,
    maxIterations?: number,
  ) {
    this.maxIter = maxIterations ?? 5;
  }

  /** Execute the AI action associated with a matched trigger */
  async execute(result: TriggerResult): Promise<void> {
    const triggerName = result.trigger.name;
    const filePath = result.event.path;
    const eventType = result.event.type;

    this.emitEvent({
      type: 'action:start',
      trigger: triggerName,
      path: filePath,
      timestamp: Date.now(),
    });

    log.info('Executing action for trigger', { trigger: triggerName, path: filePath, eventType });

    try {
      // 1. Resolve provider
      const { callFn, label: providerLabel } = resolveAgenticProvider();

      // 2. Build tool infrastructure
      const filteredTools = result.trigger.action.toolSubset
        ? this.tools.filter((t) => result.trigger.action.toolSubset!.includes(t.name))
        : this.tools;
      const toolDefs = buildAgenticToolList(filteredTools);
      const executor = createToolExecutor(filteredTools);

      // 3. Build prompt with trigger context
      const systemPrompt = [
        `Watch trigger "${triggerName}" fired.`,
        `File: ${filePath}`,
        `Event: ${eventType}`,
        `Action type: ${result.trigger.action.type}`,
      ].join('\n');

      const userPrompt = result.trigger.action.prompt;

      // 4. Run agentic loop
      const loopResult = await runAgenticLoop(
        systemPrompt,
        [{ role: 'user' as const, content: [{ type: 'text' as const, text: userPrompt }] }],
        toolDefs,
        executor,
        callFn,
        providerLabel,
        { maxIterations: this.maxIter },
      );

      log.info('Action completed', {
        trigger: triggerName,
        provider: providerLabel,
        resultLength: loopResult.text?.length ?? 0,
      });

      this.emitEvent({
        type: 'action:complete',
        trigger: triggerName,
        path: filePath,
        timestamp: Date.now(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error('Action execution failed', { trigger: triggerName, error: errorMsg });

      this.emitEvent({
        type: 'action:failed',
        trigger: triggerName,
        path: filePath,
        error: errorMsg,
        timestamp: Date.now(),
      });
      // Do NOT rethrow -- watch system must keep running
    }
  }

  private emitEvent(event: WatchSystemEvent): void {
    this.onEvent?.(event);
  }
}
