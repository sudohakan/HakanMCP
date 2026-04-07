/**
 * Performance benchmarks for SysInt.
 * Verifies:
 * 1. Catalog cold load completes in under 200ms
 * 2. First tool invocation (category lazy-load + execution) completes in under 2s
 * 3. All category modules import in under 500ms each
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../nirsoft/index.js', () => ({
  default: {},
  isWSL: () => false,
  isSupported: () => false,
  loadCatalog: () => ({ tools: [] }),
  parseCsvToJson: () => [],
  createTempFile: async () => '',
}));

describe('Performance: catalog cold load', () => {
  it('catalog cold load completes in under 200ms', async () => {
    jest.resetModules();
    const { resetCatalog, getCatalog } = await import('../catalog/loader.js');
    resetCatalog();
    const start = performance.now();
    getCatalog();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    resetCatalog();
  });

  it('second catalog load (cached) completes in under 5ms', async () => {
    jest.resetModules();
    const { resetCatalog, getCatalog } = await import('../catalog/loader.js');
    resetCatalog();
    getCatalog(); // warm up
    const start = performance.now();
    getCatalog(); // cached
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
    resetCatalog();
  });
});

describe('Performance: first tool invocation', () => {
  // Use a lightweight cross-platform tool that doesn't require real system calls to validate shape
  // On Linux CI, process-list should be fast
  it('process-list first invocation completes in under 2000ms', async () => {
    jest.resetModules();
    const dispatcher = await import('../dispatcher.js');
    dispatcher.resetDispatcher();

    const start = performance.now();
    await dispatcher.runTool('process-list', []);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  }, 5000);

  it('cpu-info first invocation completes in under 2000ms', async () => {
    jest.resetModules();
    const dispatcher = await import('../dispatcher.js');
    dispatcher.resetDispatcher();

    const start = performance.now();
    await dispatcher.runTool('cpu-info', []);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  }, 5000);
});

describe('Performance: category module import time', () => {
  const CATEGORY_MODULES = [
    'network',
    'process',
    'disk',
    'system',
    'browser',
    'registry',
    'password',
    'programmer',
    'outlook',
    'audio',
  ];

  for (const category of CATEGORY_MODULES) {
    it(`${category} module imports in under 500ms`, async () => {
      // Dynamic import of the category module
      const modulePath = `../tools/${category}.js`;
      const start = performance.now();
      await import(modulePath);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(500);
    }, 3000);
  }
});

describe('Performance: catalog size', () => {
  it('catalog contains at least 107 native tools', async () => {
    const { getCatalog, resetCatalog } = await import('../catalog/loader.js');
    resetCatalog();
    const catalog = getCatalog();
    const nativeCount = catalog.tools.filter((t) => (t as unknown as Record<string, unknown>)['native'] === true).length;
    expect(nativeCount).toBeGreaterThanOrEqual(107);
    resetCatalog();
  });

  it('catalog total tool count is at least 200', async () => {
    const { getCatalog, resetCatalog } = await import('../catalog/loader.js');
    resetCatalog();
    const catalog = getCatalog();
    expect(catalog.tools.length).toBeGreaterThanOrEqual(200);
    resetCatalog();
  });
});
