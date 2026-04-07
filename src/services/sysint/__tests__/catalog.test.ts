import path from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadSysIntCatalog, getCatalog, resetCatalog } from '../catalog/loader.js';
import type { SysIntCatalog } from '../catalog/types.js';

describe('SysInt Catalog Loader', () => {
  let tmpDir: string;
  let validCatalogPath: string;

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `sysint-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    validCatalogPath = path.join(tmpDir, 'catalog.json');

    // Write a minimal valid catalog
    writeFileSync(validCatalogPath, JSON.stringify({
      version: 1,
      categories: ['network', 'process'],
      tools: [
        { id: 'cports', name: 'CurrPorts', description: 'TCP/UDP connections', category: 'network', adminRequired: false, timeout: 30, native: false, platforms: ['win32', 'linux', 'wsl'] },
        { id: 'processhacker', name: 'Process Hacker', description: 'Process manager', category: 'process', adminRequired: true, timeout: 15, native: false, platforms: ['win32', 'wsl'] },
      ],
    }));

    resetCatalog();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    resetCatalog();
  });

  describe('loadSysIntCatalog', () => {
    it('returns valid catalog from correct JSON file', () => {
      const catalog = loadSysIntCatalog(validCatalogPath);
      expect(catalog.version).toBe(1);
      expect(catalog.categories).toEqual(['network', 'process']);
      expect(catalog.tools).toHaveLength(2);
      expect(catalog.tools[0].id).toBe('cports');
    });

    it('throws when file does not exist', () => {
      expect(() => loadSysIntCatalog('/nonexistent/path/catalog.json'))
        .toThrow(/Failed to parse catalog at/);
    });

    it('throws on unsupported catalog version', () => {
      const wrongVersionPath = path.join(tmpDir, 'wrong.json');
      writeFileSync(wrongVersionPath, JSON.stringify({ version: 2, categories: [], tools: [] }));
      expect(() => loadSysIntCatalog(wrongVersionPath))
        .toThrow(/Unsupported catalog version: 2/);
    });

    it('throws on tool missing required fields', () => {
      const badCatalogPath = path.join(tmpDir, 'bad.json');
      writeFileSync(badCatalogPath, JSON.stringify({
        version: 1,
        categories: ['network'],
        tools: [{ name: 'Missing ID' }], // no id
      }));
      expect(() => loadSysIntCatalog(badCatalogPath))
        .toThrow(/Invalid catalog entry/);
    });

    it('returns tools with native and platforms fields', () => {
      const catalog = loadSysIntCatalog(validCatalogPath);
      for (const tool of catalog.tools) {
        expect(tool).toHaveProperty('native');
        expect(tool).toHaveProperty('platforms');
        expect(Array.isArray(tool.platforms)).toBe(true);
      }
    });
  });

  describe('getCatalog singleton', () => {
    it('loads catalog from PROJECT_ROOT/data/sysint/catalog.json on first call', () => {
      // Just verify it doesn't throw (actual catalog must exist)
      const catalog = getCatalog();
      expect(catalog.version).toBe(1);
      expect(catalog.tools.length).toBeGreaterThan(200);
    });

    it('returns same object reference on subsequent calls (memoized)', () => {
      const catalog1 = getCatalog();
      const catalog2 = getCatalog();
      expect(catalog1).toBe(catalog2); // same reference
    });

    it('resetCatalog() causes getCatalog() to reload', () => {
      const catalog1 = getCatalog();
      resetCatalog();
      const catalog2 = getCatalog();
      // Fresh instance after reset
      expect(catalog1).not.toBe(catalog2);
    });
  });
});
