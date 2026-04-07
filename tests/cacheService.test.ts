import { MultiLevelCache } from '../src/services/cacheService';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { jest } from '@jest/globals';

describe('MultiLevelCache', () => {
  const dir = path.join(os.tmpdir(), 'cache-test');

  beforeEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets and gets values from memory/disk', async () => {
    const cache = new MultiLevelCache<string>(1000, dir);
    await cache.set('foo', 'bar');

    expect(await cache.get('foo')).toBe('bar');

    // force reload from disk
    (cache as { memory?: { clear: () => void } }).memory?.clear();
    expect(await cache.get('foo')).toBe('bar');
  });

  it('respects TTL expiration', async () => {
    const cache = new MultiLevelCache<string>(60_000, dir);
    await cache.set('foo', 'bar', 5_000);
    expect(await cache.get('foo')).toBe('bar');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    expect(await cache.get('foo')).toBeNull();
    (Date.now as unknown as { mockRestore?: () => void }).mockRestore?.();
  });
});
