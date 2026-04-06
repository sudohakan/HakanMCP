import { isWSL, isSupported, toWindowsPath } from '../src/services/nirsoft/platform.js';
import { loadCatalog } from '../src/services/nirsoft/catalog.js';
import { parseCsvToJson } from '../src/services/nirsoft/csvParser.js';
import { createTempFile } from '../src/services/nirsoft/tempFile.js';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BIN_DIR = path.resolve(__dirname, '..', 'data', 'nirsoft', 'bin');
const CATALOG_PATH = path.resolve(__dirname, '..', 'data', 'nirsoft', 'catalog.json');
const FIXTURES_DIR = path.resolve(__dirname, 'nirsoft-fixtures');
const IS_WSL_ENV = isWSL();
const SKIP_LIVE = process.platform !== 'win32' && !IS_WSL_ENV;
const IS_LIVE = !SKIP_LIVE && process.env.TEST_NIRSOFT_LIVE === '1';
const describeLive = IS_LIVE ? describe : describe.skip;

// --- Platform ---

describe('nirsoft platform', () => {
  it('isWSL returns a boolean', () => {
    expect(typeof isWSL()).toBe('boolean');
  });

  it('isSupported returns true on win32 or WSL', () => {
    if (process.platform === 'win32' || isWSL()) {
      expect(isSupported()).toBe(true);
    } else {
      expect(isSupported()).toBe(false);
    }
  });

  describe('toWindowsPath', () => {
    it('converts /mnt/c/Users/test to C:\\Users\\test', async () => {
      const result = await toWindowsPath('/mnt/c/Users/test');
      expect(result).toBe('C:\\Users\\test');
    });

    it('converts drive root /mnt/c to C:\\', async () => {
      const result = await toWindowsPath('/mnt/c');
      expect(result).toBe('C:\\');
    });

    it('converts /mnt/d/folder to D:\\folder', async () => {
      const result = await toWindowsPath('/mnt/d/folder');
      expect(result).toBe('D:\\folder');
    });
  });
});

// --- Catalog ---

describe('nirsoft catalog', () => {
  const catalogPath = path.resolve(__dirname, '..', 'data', 'nirsoft', 'catalog.json');

  it('loads and validates catalog', () => {
    const catalog = loadCatalog(catalogPath);
    expect(catalog.version).toBe(1);
    expect(catalog.categories).toContain('network');
  });

  it('rejects invalid version', () => {
    const tmpPath = '/tmp/bad-catalog.json';
    writeFileSync(tmpPath, JSON.stringify({ version: 99, categories: [], tools: [] }));
    expect(() => loadCatalog(tmpPath)).toThrow('Unsupported catalog version');
    unlinkSync(tmpPath);
  });

  it('rejects tool with path separator in exe', () => {
    const tmpPath = '/tmp/bad-catalog2.json';
    writeFileSync(tmpPath, JSON.stringify({
      version: 1, categories: ['network'],
      tools: [{ id: 'bad', exe: '../evil.exe', name: 'Bad', description: 'Bad tool description', category: 'network', cli: true, adminRequired: false, specialDeps: null, timeout: 10, outputColumns: null }],
    }));
    expect(() => loadCatalog(tmpPath)).toThrow('Invalid exe path');
    unlinkSync(tmpPath);
  });

  it('rejects tool with zero timeout', () => {
    const tmpPath = '/tmp/bad-catalog3.json';
    writeFileSync(tmpPath, JSON.stringify({
      version: 1, categories: ['network'],
      tools: [{ id: 'bad', exe: 'bad.exe', name: 'Bad', description: 'Bad tool description', category: 'network', cli: true, adminRequired: false, specialDeps: null, timeout: 0, outputColumns: null }],
    }));
    expect(() => loadCatalog(tmpPath)).toThrow('Invalid timeout');
    unlinkSync(tmpPath);
  });

  it('rejects empty outputColumns array', () => {
    const tmpPath = '/tmp/bad-catalog4.json';
    writeFileSync(tmpPath, JSON.stringify({
      version: 1, categories: ['network'],
      tools: [{ id: 'bad', exe: 'bad.exe', name: 'Bad', description: 'Bad tool description', category: 'network', cli: true, adminRequired: false, specialDeps: null, timeout: 10, outputColumns: [] }],
    }));
    expect(() => loadCatalog(tmpPath)).toThrow('outputColumns cannot be empty');
    unlinkSync(tmpPath);
  });
});

// --- CSV Parser ---

describe('nirsoft csvParser', () => {
  it('parses CSV with known columns', () => {
    const csv = 'TCP,8080,127.0.0.1\nUDP,53,10.0.0.1\n';
    const columns = ['Protocol', 'Port', 'Address'];
    const result = parseCsvToJson(csv, columns) as Record<string, string>[];
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].Protocol).toBe('TCP');
    expect(result[0].Port).toBe('8080');
    expect(result[1].Protocol).toBe('UDP');
  });

  it('returns raw string for null columns', () => {
    const csv = 'some,raw,data\n';
    const result = parseCsvToJson(csv, null);
    expect(typeof result).toBe('string');
    expect(result).toBe(csv);
  });

  it('handles quoted fields with commas', () => {
    const csv = '"Process, Name",8080,"127.0.0.1"\n';
    const columns = ['Name', 'Port', 'Address'];
    const result = parseCsvToJson(csv, columns) as Record<string, string>[];
    expect(result[0].Name).toBe('Process, Name');
  });

  it('handles empty CSV', () => {
    const result = parseCsvToJson('', ['A', 'B']);
    expect(result).toEqual([]);
  });
});

// --- TempFile ---

describe('nirsoft tempFile', () => {
  it('creates a TempFile with linuxPath and winPath', () => {
    const tf = createTempFile();
    expect(tf.linuxPath).toBeTruthy();
    expect(tf.winPath).toBeTruthy();
  });

  it('linuxPath directory exists', () => {
    const tf = createTempFile();
    const dir = path.dirname(tf.linuxPath);
    expect(existsSync(dir)).toBe(true);
  });
});

// --- Tier 1: Catalog Integrity ---

const hasCatalog = existsSync(CATALOG_PATH);
const describeCatalog = hasCatalog ? describe : describe.skip;

describeCatalog('nirsoft catalog integrity', () => {
  const catalog = loadCatalog(CATALOG_PATH);

  catalog.tools.forEach((tool) => {
    it(`${tool.id}: exe exists`, () => {
      expect(existsSync(path.join(BIN_DIR, tool.exe))).toBe(true);
    });
  });

  it('all tools have valid categories', () => {
    for (const tool of catalog.tools) {
      expect(catalog.categories).toContain(tool.category);
    }
  });

  it('all tools have valid id format', () => {
    for (const tool of catalog.tools) {
      expect(tool.id).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it('all tools have positive timeout', () => {
    for (const tool of catalog.tools) {
      expect(tool.timeout).toBeGreaterThan(0);
    }
  });

  it('no tools have empty outputColumns array', () => {
    for (const tool of catalog.tools) {
      if (Array.isArray(tool.outputColumns)) {
        expect(tool.outputColumns.length).toBeGreaterThan(0);
      }
    }
  });
});

// --- Tier 2: Fixture Parse ---

describe('nirsoft fixture parse', () => {
  it('parses cports fixture', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'sample-cports.csv');
    if (!existsSync(fixturePath)) return;
    const csv = readFileSync(fixturePath, 'utf8');
    const catalog = loadCatalog(CATALOG_PATH);
    const tool = catalog.tools.find((t) => t.id === 'cports');
    if (!tool || !tool.outputColumns) return;
    const result = parseCsvToJson(csv, tool.outputColumns);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Record<string, string>[];
    if (arr.length > 0) {
      expect(arr[0]).toHaveProperty(tool.outputColumns[0]);
    }
  });
});

// --- Tier 3: Live Integration ---
// Live tests use MCP stdin/stdout protocol via child_process
// because Jest can't import the full tool chain (logger/winston deps).
// Run with: TEST_NIRSOFT_LIVE=1 npx jest tests/nirsoft.test.ts

import { execSync } from 'node:child_process';

function mcpCall(action: string, extra: Record<string, unknown> = {}): any {
  const args = { action, ...extra };
  const request = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'nirsoft', arguments: args },
    id: 1,
  });
  const result = execSync(
    `echo '${request}' | node dist/index.js 2>/dev/null`,
    { cwd: path.resolve(__dirname, '..'), timeout: 30000 },
  ).toString();
  // Find JSON response line
  const lines = result.split('\n').filter((l) => l.startsWith('{'));
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.result?.content) {
        return JSON.parse(parsed.result.content[0].text);
      }
    } catch { /* skip non-JSON lines */ }
  }
  throw new Error('No valid MCP response found');
}

describeLive('nirsoft live integration', () => {
  it('list action returns tools', () => {
    const data = mcpCall('list');
    expect(data.total).toBeGreaterThan(0);
  }, 30000);

  it('list with category filter', () => {
    const data = mcpCall('list', { category: 'network' });
    expect(data.tools.every((t: any) => t.category === 'network')).toBe(true);
  }, 30000);

  it('info returns tool details', () => {
    const data = mcpCall('info', { id: 'cports' });
    expect(data.id).toBe('cports');
  }, 30000);
});
