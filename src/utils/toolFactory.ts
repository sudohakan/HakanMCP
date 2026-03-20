/**
 * Tool factory utilities for standardized tool creation
 * Provides consistent error handling, logging, and validation
 */

import { z, ZodSchema } from 'zod';
import { zodToJsonSchema as convertZodToJsonSchema } from 'zod-to-json-schema';
import { logger } from './logger.js';
import { ToolDefinition, ToolResponse, ToolHandler } from '../types/index.js';
import { createErrorResponse } from './common.js';

export interface ToolOptions<T> {
  name: string;
  description: string;
  inputSchema: ZodSchema<T>;
  handler: ToolHandler<T>;
  skipLogging?: boolean;
  operation?: string;
}

/**
 * Creates a standardized tool with automatic error handling and logging
 */
export function createTool<T = unknown>(options: ToolOptions<T>): ToolDefinition<T> {
  const {
    name,
    description,
    inputSchema,
    handler,
    skipLogging = false,
    operation = 'invoke',
  } = options;

  return {
    name,
    description,
    inputSchema: zodToJsonSchema(inputSchema),
    handler: async (args: unknown): Promise<ToolResponse> => {
      const toolLogger = logger.child({ tool: name, operation });

      try {
        if (!skipLogging) {
          toolLogger.info('Tool invoked', { args });
        }

        const validatedArgs = inputSchema.parse(args) as T;

        const result = await handler(validatedArgs);

        if (!skipLogging) {
          toolLogger.info('Tool completed successfully');
        }

        return result;
      } catch (error: unknown) {
        toolLogger.error('Tool execution failed', error, { args });

        if (error instanceof z.ZodError) {
          return createErrorResponse(
            `Validation error: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          );
        }

        if (error instanceof Error) {
          return createErrorResponse(error);
        }

        return createErrorResponse('Unknown error occurred');
      }
    },
  };
}

/**
 * Converts Zod schema to JSON Schema format for MCP
 */
function zodToJsonSchema(schema: ZodSchema): {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod-to-json-schema accepts ZodType
  const converted = convertZodToJsonSchema(schema as any, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  return {
    type: 'object',
    properties: (converted.properties as Record<string, unknown>) ?? {},
    required: converted.required as string[] | undefined,
  };
}

/**
 * Creates a tool definition with explicit JSON schema (for backward compatibility)
 */
export function createToolWithJsonSchema<T = unknown>(
  name: string,
  description: string,
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  },
  handler: ToolHandler<T>,
  zodSchema?: ZodSchema<T>,
  operation: string = 'invoke',
): ToolDefinition<T> {
  const toolLogger = logger.child({ tool: name, operation });

  return {
    name,
    description,
    inputSchema,
    handler: async (args: unknown): Promise<ToolResponse> => {
      try {
        toolLogger.debug('Tool invoked', { args });

        const validatedArgs = zodSchema ? zodSchema.parse(args) : args;

        const result = await handler(validatedArgs as T);

        toolLogger.debug('Tool completed successfully');

        return result;
      } catch (error: unknown) {
        toolLogger.error('Tool execution failed', error, { args });

        if (error instanceof z.ZodError) {
          return createErrorResponse(
            `Validation error: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          );
        }

        if (error instanceof Error) {
          return createErrorResponse(error);
        }

        return createErrorResponse('Unknown error occurred');
      }
    },
  };
}

/**
 * Wraps multiple tools with standardized error handling
 */
export function wrapTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => {
    const originalHandler = tool.handler;

    return {
      ...tool,
      handler: async (args: unknown): Promise<ToolResponse> => {
        const toolLogger = logger.child({ tool: tool.name, operation: 'invoke' });

        try {
          toolLogger.info('Tool invoked', { args });
          const result = await originalHandler(args);
          toolLogger.info('Tool completed successfully');
          return result;
        } catch (error: unknown) {
          toolLogger.error('Tool execution failed', error, { args });

          if (error instanceof Error) {
            return createErrorResponse(error);
          }

          return createErrorResponse('Unknown error occurred');
        }
      },
    };
  });
}
