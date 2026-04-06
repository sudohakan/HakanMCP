import { isWSL, isSupported, toWindowsPath } from '../src/services/nirsoft/platform.js';
import { loadCatalog } from '../src/services/nirsoft/catalog.js';
import { parseCsvToJson } from '../src/services/nirsoft/csvParser.js';
import { createTempFile } from '../src/services/nirsoft/tempFile.js';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

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
