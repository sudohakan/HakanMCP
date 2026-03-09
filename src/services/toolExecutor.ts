/**
 * Tool executor for agentic loop — filters, routes, and executes tool calls.
 */

import type { ClaudeToolDefinition } from '../types/index.js';
import { logger } from '../utils/logger.js';

/** Tools excluded from the agentic tool list to prevent recursive/dangerous calls */
const EXCLUDED_TOOL_NAMES = new Set([
  'ai_chat',
  'ai_generate',
  'ai_history',
  'ai_provider_chat',
  'ai_listModels',
  'moe_route',
]);

const MAX_RESULT_CHARS = 50_000;

export interface MCPBridgeExecutor {
  execute(connectionId: string, toolName: string, input: Record<string, unknown>): Promise<string>;
  getRemoteTools(): Promise<ClaudeToolDefinition[]>;
}

interface ToolLike {
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}

export interface ToolExecutor {
  execute(toolName: string, input: Record<string, unknown>): Promise<{ result: string; is_error: boolean; duration_ms: number }>;
  getAvailableToolDefs(): ClaudeToolDefinition[];
}

/**
 * Filter allTools and convert to Claude API tool definition format.
 */
export function buildAgenticToolList(tools: ToolLike[]): ClaudeToolDefinition[] {
  return tools
    .filter((t) => !EXCLUDED_TOOL_NAMES.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Record<string, unknown>,
    }));
}

function truncate(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS) + `\n...[truncated at ${MAX_RESULT_CHARS} chars]`;
}

/**
 * Create a unified tool executor that routes calls to local handlers or MCP bridge.
 */
export function createToolExecutor(
  localTools: ToolLike[],
  mcpBridge?: MCPBridgeExecutor,
): ToolExecutor {
  const localMap = new Map<string, ToolLike>();
  for (const tool of localTools) {
    if (!EXCLUDED_TOOL_NAMES.has(tool.name)) {
      localMap.set(tool.name, tool);
    }
  }

  const localDefs = buildAgenticToolList(localTools);

  return {
    getAvailableToolDefs(): ClaudeToolDefinition[] {
      // MCP bridge tools would be added here if needed in the future
      return localDefs;
    },

    async execute(toolName: string, input: Record<string, unknown>) {
      const start = Date.now();

      // Check if it's an MCP bridge tool (mcp:{connId}:{toolName} format)
      if (toolName.startsWith('mcp:') && mcpBridge) {
        const parts = toolName.split(':');
        if (parts.length >= 3) {
          const connectionId = parts[1];
          const remoteTool = parts.slice(2).join(':');
          try {
            const result = await mcpBridge.execute(connectionId, remoteTool, input);
            return { result: truncate(result), is_error: false, duration_ms: Date.now() - start };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { result: `MCP bridge error: ${msg}`, is_error: true, duration_ms: Date.now() - start };
          }
        }
      }

      // Local tool execution
      const tool = localMap.get(toolName);
      if (!tool) {
        return {
          result: `Unknown tool: ${toolName}`,
          is_error: true,
          duration_ms: Date.now() - start,
        };
      }

      try {
        const response = await tool.handler(input);
        const text = response.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text || '')
          .join('\n')
          .trim() || JSON.stringify(response, null, 2);
        return {
          result: truncate(text),
          is_error: response.isError === true,
          duration_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Agentic tool execution error', { tool: toolName, error: msg });
        return {
          result: `Tool error: ${msg}`,
          is_error: true,
          duration_ms: Date.now() - start,
        };
      }
    },
  };
}
