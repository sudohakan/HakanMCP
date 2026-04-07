import { buildSuccess, buildError, toCSV, isError } from '../outputFormatter.js';
import type { SysIntErrorCode } from '../outputFormatter.js';

describe('Output Formatter', () => {
  describe('buildSuccess', () => {
    it('returns correct shape for empty rows', () => {
      const result = buildSuccess([], 'cports', 'win32');
      expect(result.rows).toEqual([]);
      expect(result.count).toBe(0);
      expect(result.platform).toBe('win32');
      expect(result.tool).toBe('cports');
      expect(typeof result.timestamp).toBe('string');
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('count equals rows.length', () => {
      const rows = [{ a: 1 }, { a: 2 }];
      const result = buildSuccess(rows, 'cports', 'linux');
      expect(result.count).toBe(2);
      expect(result.rows).toHaveLength(2);
    });

    it('timestamp is valid ISO8601', () => {
      const result = buildSuccess([], 'test', 'wsl');
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('accepts wsl as valid platform', () => {
      const result = buildSuccess([], 'test', 'wsl');
      expect(result.platform).toBe('wsl');
    });

    it('includes all required fields', () => {
      const result = buildSuccess([{ x: 1 }], 'mytool', 'linux');
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('platform');
      expect(result).toHaveProperty('tool');
    });
  });

  describe('buildError', () => {
    it('returns correct error shape', () => {
      const result = buildError('requires admin', 'PRIVILEGE_REQUIRED', 'cports');
      expect(result.error).toBe('requires admin');
      expect(result.code).toBe('PRIVILEGE_REQUIRED');
      expect(result.tool).toBe('cports');
    });

    it('accepts all 4 valid error codes', () => {
      const codes: SysIntErrorCode[] = ['PLATFORM_UNSUPPORTED', 'PRIVILEGE_REQUIRED', 'NOT_FOUND', 'EXEC_FAILED'];
      for (const code of codes) {
        const result = buildError('test', code, 'tool');
        expect(result.code).toBe(code);
      }
    });
  });

  describe('toCSV', () => {
    it('returns empty string for empty array', () => {
      expect(toCSV([])).toBe('');
    });

    it('returns header + row for single object', () => {
      const result = toCSV([{ name: 'foo', pid: 123 }]);
      const lines = result.split('\n');
      expect(lines[0]).toBe('name,pid');
      expect(lines[1]).toBe('foo,123');
    });

    it('quotes fields containing commas', () => {
      const result = toCSV([{ name: 'with,comma' }]);
      expect(result).toContain('"with,comma"');
    });

    it('escapes double quotes in fields', () => {
      const result = toCSV([{ name: 'with"quote' }]);
      expect(result).toContain('"with""quote"');
    });

    it('handles null/undefined values as empty string', () => {
      const result = toCSV([{ name: null, pid: undefined }] as unknown as Record<string, unknown>[]);
      const lines = result.split('\n');
      expect(lines[1]).toBe(',');
    });

    it('normalizes CRLF to LF in values', () => {
      const result = toCSV([{ desc: 'line1\r\nline2' }]);
      expect(result).not.toContain('\r\n');
    });

    it('handles inconsistent keys across rows — uses first row keys as headers', () => {
      const result = toCSV([
        { name: 'foo', pid: 1 },
        { name: 'bar' } as Record<string, unknown>,
      ]);
      const lines = result.split('\n');
      expect(lines[0]).toBe('name,pid');
      expect(lines[1]).toBe('foo,1');
      // second row missing pid key → empty
      expect(lines[2]).toBe('bar,');
    });

    it('handles newline-only values by quoting them', () => {
      const result = toCSV([{ desc: '\n' }]);
      expect(result).toContain('"');
    });
  });

  describe('isError', () => {
    it('returns true for error result', () => {
      const err = buildError('failed', 'EXEC_FAILED', 'tool');
      expect(isError(err)).toBe(true);
    });

    it('returns false for success result', () => {
      const ok = buildSuccess([], 'tool', 'linux');
      expect(isError(ok)).toBe(false);
    });
  });
});
