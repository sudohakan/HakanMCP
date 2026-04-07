/**
 * MCP Bridge — routes agentic tool calls to remote MCP servers via connectionManager.
 */

import type { MCPConnectionManager } from '../tools/mcpClient.js';
import type { MCPBridgeExecutor } from './toolExecutor.js';
import type { ClaudeToolDefinition } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function createMCPBridge(connectionManager: MCPConnectionManager): MCPBridgeExecutor {
  return {
    async execute(
      connectionId: string,
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<string> {
      const result = await connectionManager.sendRequest(connectionId, 'tools/call', {
        name: toolName,
        arguments: input,
      });

      const typed = result as { content?: Array<{ type?: string; text?: string }> };
      if (typed?.content && Array.isArray(typed.content)) {
        return typed.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text || '')
          .join('\n')
          .trim();
      }

      return JSON.stringify(result, null, 2);
    },

    async getRemoteTools(): Promise<ClaudeToolDefinition[]> {
      const connections = connectionManager.listConnections();
      const allDefs: ClaudeToolDefinition[] = [];

      for (const conn of connections) {
        try {
          const result = (await connectionManager.sendRequest(conn.id, 'tools/list')) as {
            tools?: Array<{
              name?: string;
              description?: string;
              inputSchema?: Record<string, unknown>;
            }>;
          };

          for (const tool of result.tools || []) {
            if (tool.name) {
              allDefs.push({
                name: `mcp:${conn.id}:${tool.name}`,
                description: `[MCP:${conn.id}] ${tool.description || tool.name}`,
                input_schema: tool.inputSchema || { type: 'object', properties: {} },
              });
            }
          }
        } catch (err) {
          logger.warn('Failed to list tools from MCP connection', {
            connectionId: conn.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return allDefs;
    },
  };
}
