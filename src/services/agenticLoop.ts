/**
 * Agentic Loop — Provider-agnostic tool-use iteration.
 * Accepts a generic callFn so any provider (Claude, OpenAI, Gemini) can drive the loop.
 * Internal message format uses Claude-style content blocks as the canonical representation.
 */

import type {
  ClaudeToolDefinition,
  ClaudeMessage,
  ClaudeApiResponse,
  ClaudeContentBlock,
  ClaudeToolUseBlock,
  AgenticToolCall,
  AgenticLoopResult,
} from '../types/index.js';
import type { ToolExecutor } from './toolExecutor.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Generic call function signature. Each provider adapter implements this.
 * Takes system prompt, messages (Claude format), tools → returns normalized ClaudeApiResponse.
 */
export type AgenticCallFn = (
  system: string | undefined,
  messages: ClaudeMessage[],
  tools: ClaudeToolDefinition[],
) => Promise<ClaudeApiResponse>;

export interface AgenticLoopConfig {
  maxIterations?: number;
}

function extractText(content: ClaudeContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function extractToolUseBlocks(content: ClaudeContentBlock[]): ClaudeToolUseBlock[] {
  return content.filter((b): b is ClaudeToolUseBlock => b.type === 'tool_use');
}

/**
 * Run the agentic loop with any provider that implements AgenticCallFn.
 */
export async function runAgenticLoop(
  system: string | undefined,
  initialMessages: ClaudeMessage[],
  tools: ClaudeToolDefinition[],
  executor: ToolExecutor,
  callFn: AgenticCallFn,
  providerLabel: string,
  config?: AgenticLoopConfig,
): Promise<AgenticLoopResult> {
  const maxIterations = config?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const messages: ClaudeMessage[] = [...initialMessages];
  const allToolCalls: AgenticToolCall[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = '';
  let resolvedModel = providerLabel;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    logger.debug('Agentic loop iteration', { iteration: iteration + 1, maxIterations, provider: providerLabel });

    const response = await callFn(system, messages, tools);
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;
    if (response.model) resolvedModel = response.model;

    const iterText = extractText(response.content);
    if (iterText) finalText = iterText;

    if (response.stop_reason !== 'tool_use') {
      logger.debug('Agentic loop completed', {
        reason: response.stop_reason,
        iterations: iteration + 1,
        toolCalls: allToolCalls.length,
      });
      break;
    }

    const toolUseBlocks = extractToolUseBlocks(response.content);
    if (toolUseBlocks.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });

    const toolResultBlocks: ClaudeContentBlock[] = [];
    for (const toolUse of toolUseBlocks) {
      logger.debug('Executing agentic tool', { tool: toolUse.name, id: toolUse.id });

      const { result, is_error, duration_ms } = await executor.execute(
        toolUse.name,
        toolUse.input,
      );

      allToolCalls.push({ name: toolUse.name, input: toolUse.input, result, is_error, duration_ms });

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
        is_error: is_error || undefined,
      });
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  return {
    text: finalText,
    model: resolvedModel,
    toolCalls: allToolCalls,
    iterations: allToolCalls.length,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}
