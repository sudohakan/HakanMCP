import { createTool, createToolWithJsonSchema, wrapTools } from '../src/utils/toolFactory';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { ToolHandler } from '../src/types';

describe('Tool Factory', () => {
  describe('createTool', () => {
    it('should create a tool with valid definition', async () => {
      const handler = jest.fn(async () => ({
        content: [{ type: 'text', text: 'success' }],
      })) as unknown as ToolHandler<{ arg: string }>;
      const tool = createTool({
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: z.object({
          arg: z.string(),
        }),
        handler,
      });

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('Test tool');
      expect(tool.inputSchema).toBeDefined();

      const result = await tool.handler({ arg: 'value' });
      expect(result.content[0].text).toBe('success');
      expect(handler).toHaveBeenCalledWith({ arg: 'value' });
    });

    it('should handle validation errors', async () => {
      const tool = createTool({
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: z.object({
          arg: z.string(),
        }),
        handler: async () => ({ content: [] }),
      });

      const result = await tool.handler({ arg: 123 } as unknown); // Invalid type
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation error');
    });

    it('should handle handler errors', async () => {
      const tool = createTool({
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: z.object({}),
        handler: async () => {
          throw new Error('Handler failed');
        },
      });

      const result = await tool.handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Handler failed');
    });
  });

  describe('createToolWithJsonSchema', () => {
    it('should create tool with explicit JSON schema', async () => {
      const handler = jest.fn(async () => ({
        content: [{ type: 'text', text: 'success' }],
      })) as unknown as ToolHandler<{ arg: string }>;
      const tool = createToolWithJsonSchema(
        'test_tool',
        'Test tool',
        {
          type: 'object',
          properties: { arg: { type: 'string' } },
        },
        handler,
        z.object({ arg: z.string() }),
      );

      expect(tool.name).toBe('test_tool');
      expect(tool.inputSchema.type).toBe('object');

      const result = await tool.handler({ arg: 'value' });
      expect(result.content[0].text).toBe('success');
    });
  });

  describe('wrapTools', () => {
    it('should wrap existing tools with error handling', async () => {
      const originalTool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' as const, properties: {} },
        handler: async () => {
          throw new Error('Original error');
        },
      };

      const wrapped = wrapTools([originalTool]);
      const result = await wrapped[0].handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Original error');
    });
  });
});
