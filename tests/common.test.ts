import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createTextResponse,
  createJsonResponse,
  createErrorResponse,
  withErrorHandling,
  validateRequired,
  safeJsonParse,
  validatePath,
  validateUrl,
  validatePort,
  validateHostname,
  validateEmail,
  debounce,
  retry,
  sleep,
  formatBytes,
  truncate,
  isValidJson,
  deepClone,
  deepMerge,
  sanitizeFilename,
  generateId,
  atomicWriteFileSync,
} from '../src/utils/common';
import { ToolError } from '../src/types/index';

describe('common utilities', () => {
  it('creates text and json responses', () => {
    const text = createTextResponse('hello', { id: 1 });
    expect(text.content[0].text).toBe('hello');
    expect(text.meta?.id).toBe(1);

    const json = createJsonResponse({ ok: true });
    expect(json.content[0].text).toContain('"ok": true');
  });

  it('creates error responses for errors and strings', () => {
    const errResponse = createErrorResponse(new Error('boom'));
    expect(errResponse.isError).toBe(true);
    expect(errResponse.content[0].text).toContain('boom');

    const strResponse = createErrorResponse('bad');
    expect(strResponse.content[0].text).toContain('bad');
  });

  it('wraps handlers with error handling', async () => {
    const handler = withErrorHandling(async () => {
      throw new ToolError('validation failed', 'VALIDATION_ERROR');
    });
    const result = await handler({} as unknown);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('validation failed');
  });

  it('validates required fields and throws ToolError', () => {
    expect(() => validateRequired({ a: 1, b: null }, ['a', 'b'])).toThrow(ToolError);
  });

  it('parses json safely with fallback', () => {
    expect(safeJsonParse('{"ok":true}')).toEqual({ ok: true });
    expect(safeJsonParse('invalid', { ok: false })).toEqual({ ok: false });
    expect(() => safeJsonParse('invalid')).toThrow(ToolError);
  });

  it.each([
    [() => validatePath(null as unknown), 'Invalid file path'],
    [() => validatePath('   '), 'File path cannot be empty'],
    [() => validateUrl('notaurl'), 'Invalid URL format'],
    [() => validatePort(0), 'Invalid port number'],
    [() => validateHostname('@@@'), 'Invalid hostname'],
    [() => validateEmail('not-email'), 'Invalid email'],
  ])('rejects invalid values (%s)', (fn, expected) => {
    expect(fn as () => unknown).toThrow(expected);
  });

  it('debounces function calls', () => {
    jest.useFakeTimers();
    const spy = jest.fn();
    const debounced = debounce(spy, 100);
    debounced('a');
    debounced('b');
    jest.advanceTimersByTime(99);
    expect(spy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    expect(spy).toHaveBeenCalledWith('b');
    jest.useRealTimers();
  });

  it('retries operations and respects max attempts', async () => {
    let attempts = 0;
    const result = await retry(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error('fail once');
        }
        return 'success';
      },
      { maxAttempts: 3, initialDelay: 1, maxDelay: 2 },
    );

    expect(result).toBe('success');
    await expect(
      retry(
        async () => {
          throw new Error('always fails');
        },
        { maxAttempts: 2, initialDelay: 1, maxDelay: 2 },
      ),
    ).rejects.toThrow('Operation failed after 2 attempts');
  });

  it('sleeps for specified duration', async () => {
    const before = Date.now();
    await sleep(5);
    expect(Date.now() - before).toBeGreaterThanOrEqual(0);
  });

  it('formats bytes and truncates strings', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(truncate('abcdef', 4)).toBe('a...');
  });

  it('detects valid json, clones deeply, and merges', () => {
    expect(isValidJson('{"ok":true}')).toBe(true);
    expect(isValidJson('not json')).toBe(false);

    const original = { nested: { value: 1 } };
    const clone = deepClone(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);

    const merged = deepMerge(
      { a: 1, nested: { value: 1 } } as unknown,
      { b: 2, nested: { extra: 3 } } as unknown,
    );
    expect(merged).toEqual({ a: 1, nested: { value: 1, extra: 3 }, b: 2 });
  });

  it('sanitizes filenames and generates deterministic ids when random mocked', () => {
    expect(sanitizeFilename('inv@lid?.txt')).toBe('inv_lid_.txt');

    const randomSpy = jest.spyOn(Math, 'random').mockImplementation(() => 0.5);
    expect(generateId(4)).toBe('ffff'); // index floor(0.5 * 62) = 31 -> 'f'
    randomSpy.mockRestore();
  });

  describe('atomicWriteFileSync (plan.md §E)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hakan-mcp-atomic-test-'));
    afterAll(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        /* ignore */
      }
    });

    it('writes and renames successfully', () => {
      const f = path.join(tmpDir, 'ok.txt');
      atomicWriteFileSync(f, 'hello');
      expect(fs.readFileSync(f, 'utf8')).toBe('hello');
      expect(fs.existsSync(f + '.tmp')).toBe(false);
    });

    it('preserves original on write error, logs and cleans up .tmp', () => {
      const f = path.join(tmpDir, 'orig.txt');
      fs.writeFileSync(f, 'original', 'utf8');
      const origWrite = fs.writeFileSync.bind(fs);
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((p, ...args) => {
        if (typeof p === 'string' && p.endsWith('.tmp')) {
          throw new Error('ENOSPC: disk full');
        }
        return origWrite(p as fs.PathLike, ...args);
      });
      expect(fs.readFileSync(f, 'utf8')).toBe('original');
      expect(() => atomicWriteFileSync(f, 'new')).toThrow('ENOSPC');
      expect(fs.readFileSync(f, 'utf8')).toBe('original');
      expect(fs.existsSync(f + '.tmp')).toBe(false);
      writeSpy.mockRestore();
    });

    it('preserves original and keeps .tmp on rename error', () => {
      const f = path.join(tmpDir, 'rename-target.txt');
      fs.writeFileSync(f, 'original', 'utf8');
      const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('EXDEV: cross-device');
      });
      expect(() => atomicWriteFileSync(f, 'new')).toThrow('EXDEV');
      expect(fs.readFileSync(f, 'utf8')).toBe('original');
      expect(fs.readFileSync(f + '.tmp', 'utf8')).toBe('new');
      renameSpy.mockRestore();
      fs.unlinkSync(f + '.tmp');
    });
  });
});
