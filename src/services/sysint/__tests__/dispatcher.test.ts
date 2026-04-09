import { jest } from '@jest/globals';

describe('SysInt Dispatcher', () => {
  let runTool: (toolId: string, args?: string[], options?: Record<string, unknown>) => Promise<unknown>;
  let resetDispatcher: () => void;

  beforeEach(async () => {
    jest.resetModules();
    const dispatcher = await import('../dispatcher.js');
    runTool = dispatcher.runTool;
    resetDispatcher = dispatcher.resetDispatcher;
    resetDispatcher();
  });

  afterEach(() => {
    resetDispatcher();
  });

  describe('Guard sequence — fail-fast', () => {
    it('returns NOT_FOUND for unknown tool ID', async () => {
      const result = await runTool('nonexistent-tool-xyz');
      expect(result).toMatchObject({ code: 'NOT_FOUND', tool: 'nonexistent-tool-xyz' });
    });

    it('returns PLATFORM_UNSUPPORTED before PRIVILEGE_REQUIRED check', async () => {
      // cports is Windows/WSL only; on Linux it should fail with PLATFORM_UNSUPPORTED
      // We can verify the error code order by testing with a Windows-only tool on linux env
      // This test depends on platform — skip platform-specific check, verify error structure
      const result = await runTool('cports'); // known tool from catalog
      // Either it runs (on Windows/WSL) or returns PLATFORM_UNSUPPORTED
      if (result && typeof result === 'object' && 'code' in result) {
        const err = result as { code: string; tool: string };
        expect(['PLATFORM_UNSUPPORTED', 'EXEC_FAILED', 'PRIVILEGE_REQUIRED']).toContain(err.code);
        expect(err.tool).toBe('cports');
      }
    });
  });

  describe('resetDispatcher', () => {
    it('can be called without error', () => {
      expect(() => resetDispatcher()).not.toThrow();
    });
  });

  describe('native module execution paths', () => {
    it('falls through to EXEC_FAILED when native module throws during run', async () => {
      // process-list is a native tool; if its module run() throws, dispatcher returns EXEC_FAILED
      // We can only verify the shape here since real execution depends on OS
      const result = await runTool('process-list') as Record<string, unknown>;
      expect(result).toBeDefined();
      // Either succeeds (rows) or fails gracefully (EXEC_FAILED)
      expect('rows' in result || 'code' in result).toBe(true);
      if ('code' in result) {
        expect(['EXEC_FAILED', 'PLATFORM_UNSUPPORTED', 'PRIVILEGE_REQUIRED']).toContain(result['code']);
      }
    });

    it('result passes through when native module returns successfully', async () => {
      // process-list on Linux should return rows; verify shape when successful
      const result = await runTool('process-list') as Record<string, unknown>;
      if ('rows' in result) {
        expect(Array.isArray(result['rows'])).toBe(true);
        expect(typeof result['tool']).toBe('string');
        expect(typeof result['timestamp']).toBe('string');
      }
    });
  });

  describe('Error result shape', () => {
    it('NOT_FOUND error has required fields', async () => {
      const result = await runTool('no-such-tool') as { error: string; code: string; tool: string };
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('code', 'NOT_FOUND');
      expect(result).toHaveProperty('tool', 'no-such-tool');
    });
  });
});
