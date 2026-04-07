/**
 * Integration tests for sysint MCP tool.
 * Tests the tool handler directly without mocking — list/info use catalog, run hits dispatcher.
 */
import { sysintTools } from '../sysint.js';

type McpResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

const tool = sysintTools.find((t) => t.name === 'sysint')!;

describe('sysint MCP tool', () => {
  it('exports sysintTools array with at least one tool', () => {
    expect(Array.isArray(sysintTools)).toBe(true);
    expect(sysintTools.length).toBeGreaterThan(0);
  });

  it('tool is named "sysint"', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('sysint');
  });

  it('tool has description', () => {
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  describe('action: list', () => {
    it('returns tool list with total and categories', async () => {
      const result = (await tool.handler({ action: 'list' })) as McpResult;
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('total');
      expect(typeof parsed.total).toBe('number');
      expect(parsed.total).toBeGreaterThan(0);
      expect(parsed).toHaveProperty('categories');
      expect(Array.isArray(parsed.categories)).toBe(true);
    });

    it('filters by category', async () => {
      const result = (await tool.handler({ action: 'list', category: 'network' })) as McpResult;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBeGreaterThan(0);
      expect(parsed.tools.every((t: { category: string }) => t.category === 'network')).toBe(true);
    });
  });

  describe('action: info', () => {
    it('returns error when id missing', async () => {
      const result = (await tool.handler({ action: 'info' })) as McpResult;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('error');
    });

    it('returns tool info for known tool', async () => {
      const result = (await tool.handler({ action: 'info', id: 'cports' })) as McpResult;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('id', 'cports');
      expect(parsed).toHaveProperty('category');
    });

    it('returns error for unknown tool', async () => {
      const result = (await tool.handler({ action: 'info', id: 'nonexistent-tool-xyz' })) as McpResult;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('error');
      expect(parsed.error).toContain('not found');
    });
  });

  describe('action: run', () => {
    it('returns error when id missing', async () => {
      const result = (await tool.handler({ action: 'run' })) as McpResult;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('error');
    });

    it('returns result for known tool (native not yet implemented)', async () => {
      const result = (await tool.handler({ action: 'run', id: 'cports' })) as McpResult;
      const parsed = JSON.parse(result.content[0].text);
      // cports has no native impl yet — should get EXEC_FAILED or platform error
      expect(parsed).toBeDefined();
      // Either returns data or a meaningful error — never crashes
      expect(typeof parsed).toBe('object');
    });

    it('accepts tool alias for id', async () => {
      const result = (await tool.handler({ action: 'run', tool: 'cports' })) as McpResult;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toBeDefined();
    });
  });

  describe('action: unknown', () => {
    it('returns error for invalid action', async () => {
      const result = (await tool.handler({ action: 'unknown-action' })) as McpResult;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('error');
    });
  });
});
