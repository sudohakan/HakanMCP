/**
 * SysInt MCP tool — native cross-platform system intelligence.
 * Wraps the sysint dispatcher with list/info/run actions.
 */
import { z } from 'zod';
import { getCatalog, findTool } from '../services/sysint/catalog/loader.js';
import { runTool } from '../services/sysint/dispatcher.js';
import { createJsonResponse } from '../utils/common.js';
import type { ToolDefinition, ToolResponse } from '../types/index.js';

const SysIntArgsSchema = z.object({
  action: z.enum(['list', 'info', 'run']),
  id: z.string().optional(),
  tool: z.string().optional(),
  category: z.string().optional(),
  args: z.array(z.string()).optional(),
}).transform((data) => ({
  ...data,
  id: data.id ?? data.tool,
}));

type SysIntArgs = z.infer<typeof SysIntArgsSchema>;

function handleList(parsed: SysIntArgs): ToolResponse {
  const catalog = getCatalog();
  const tools = parsed.category
    ? catalog.tools.filter((t) => t.category === parsed.category)
    : catalog.tools;

  return createJsonResponse({
    total: tools.length,
    categories: catalog.categories,
    tools: tools.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      adminRequired: t.adminRequired,
      native: t.native,
      platforms: t.platforms,
    })),
  });
}

function handleInfo(parsed: SysIntArgs): ToolResponse {
  if (!parsed.id) {
    return createJsonResponse({ error: 'id or tool required for info action' });
  }
  try {
    const tool = findTool(parsed.id);
    return createJsonResponse(tool);
  } catch {
    return createJsonResponse({ error: `Tool not found: ${parsed.id}`, code: 'NOT_FOUND' });
  }
}

async function handleRun(parsed: SysIntArgs): Promise<ToolResponse> {
  if (!parsed.id) {
    return createJsonResponse({ error: 'id or tool required for run action' });
  }
  const result = await runTool(parsed.id, parsed.args ?? []);
  return createJsonResponse(result);
}

async function sysintHandler(rawArgs: unknown): Promise<ToolResponse> {
  const parseResult = SysIntArgsSchema.safeParse(rawArgs);
  if (!parseResult.success) {
    return createJsonResponse({
      error: 'Invalid arguments',
      details: parseResult.error.flatten(),
    });
  }

  const parsed = parseResult.data;

  switch (parsed.action) {
    case 'list':
      return handleList(parsed);
    case 'info':
      return handleInfo(parsed);
    case 'run':
      return handleRun(parsed);
    default:
      return createJsonResponse({ error: `Unknown action: ${(parsed as { action: string }).action}` });
  }
}

export const sysintTools: ToolDefinition[] = [
  {
    name: 'sysint',
    description:
      'Cross-platform native system intelligence tools. Actions: list (browse catalog), info (tool details), run (execute tool). Supports Windows, Linux, and WSL. Native implementations where available, NirSoft binary fallback on Windows/WSL.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'info', 'run'],
          description: 'Action to perform',
        },
        id: {
          type: 'string',
          description: 'Tool ID (e.g. cports, netscan). Also accepted as "tool".',
        },
        tool: {
          type: 'string',
          description: 'Alias for id',
        },
        category: {
          type: 'string',
          description: 'Filter list by category',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Extra arguments passed to the tool',
        },
      },
      required: ['action'],
    },
    handler: sysintHandler,
  },
];
