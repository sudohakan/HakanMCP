/**
 * Tests for AI provider warmup service.
 */

import path from 'node:path';
import {
  startWarmup,
  getWarmedCliOrder,
  getWarmedApiKey,
  recordLastSuccess,
  loadLastSuccessFromDisk,
  saveLastSuccessToDisk,
  isWarmupReady,
} from '../src/services/aiProviderWarmup.js';
import { setCooldownsBasePath } from '../src/services/aiProviderCooldown.js';

describe('aiProviderWarmup', () => {
  const testDir = path.join(process.cwd(), 'test-warmup-output');

  beforeAll(() => {
    setCooldownsBasePath(testDir);
  });

  it('startWarmup runs without throwing', () => {
    expect(() => startWarmup(testDir)).not.toThrow();
  });

  it('getWarmedCliOrder returns fallback when not warmed', () => {
    const fallback = ['codex', 'claude', 'gemini', 'cursor'] as const;
    const order = getWarmedCliOrder([...fallback]);
    expect(order).toHaveLength(4);
    expect(order).toContain('codex');
    expect(order).toContain('claude');
    expect(order).toContain('gemini');
    expect(order).toContain('cursor');
  });

  it('recordLastSuccess and getWarmedCliOrder put last success first when warmed', async () => {
    startWarmup(testDir);
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (isWarmupReady()) break;
    }
    recordLastSuccess('claude');
    const fallback = ['codex', 'claude', 'gemini', 'cursor'] as const;
    const order = getWarmedCliOrder([...fallback]);
    expect(order).toContain('claude');
    if (isWarmupReady()) {
      expect(order[0]).toBe('claude');
    }
  });

  it('getWarmedApiKey returns key or undefined', () => {
    const codex = getWarmedApiKey('codex');
    const claude = getWarmedApiKey('claude');
    const gemini = getWarmedApiKey('gemini');
    expect(typeof codex === 'string' || codex === undefined).toBe(true);
    expect(typeof claude === 'string' || claude === undefined).toBe(true);
    expect(typeof gemini === 'string' || gemini === undefined).toBe(true);
  });

  it('saveLastSuccessToDisk and loadLastSuccessFromDisk roundtrip', () => {
    saveLastSuccessToDisk('gemini');
    const loaded = loadLastSuccessFromDisk();
    expect(loaded).toBe('gemini');
  });

  it('isWarmupReady returns boolean', () => {
    expect(typeof isWarmupReady()).toBe('boolean');
  });
});
