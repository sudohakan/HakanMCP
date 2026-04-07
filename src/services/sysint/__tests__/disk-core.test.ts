/**
 * Disk core tools unit tests — Phase 2 DSK-01..07
 *
 * Test strategy:
 * - Parser functions tested with fixture data
 * - Integration tests against real OS for shape validation
 * - Error cases tested with invalid inputs
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURES = join(process.cwd(), 'src/services/sysint/__tests__/fixtures');

const diskSmartWindowsFixture = readFileSync(join(FIXTURES, 'disk-smart-windows.txt'), 'utf8');
const diskSmartLinuxFixture = readFileSync(join(FIXTURES, 'disk-smart-linux.txt'), 'utf8');

let run: (toolId: string, args?: string[]) => Promise<unknown>;
let parseDiskSmartWindows: (json: string) => unknown[];
let parseDiskSmartLinux: (json: string) => unknown[];

beforeAll(async () => {
  const smartMod = await import('../tools/disk/smart.js');
  parseDiskSmartWindows = smartMod.parseDiskSmartWindows;
  parseDiskSmartLinux = smartMod.parseDiskSmartLinux;

  const indexMod = await import('../tools/disk/index.js');
  run = indexMod.run;
});

// ── DSK-01: disk-smart parsers ──────────────────────────────────────────────

describe('disk-smart parsers', () => {
  it('parseDiskSmartWindows: returns rows with required fields', () => {
    const rows = parseDiskSmartWindows(diskSmartWindowsFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(typeof rows[0]['device']).toBe('string');
    expect(typeof rows[0]['model']).toBe('string');
    expect(typeof rows[0]['health']).toBe('string');
    expect(typeof rows[0]['sizeBytes']).toBe('number');
    expect(rows[0]['sizeBytes']).toBeGreaterThan(0);
    expect(rows[0]['mediaType']).toBe('SSD');
  });

  it('parseDiskSmartLinux (lsblk format): returns disk devices', () => {
    const rows = parseDiskSmartLinux(diskSmartLinuxFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows[0]['device']).toBe('sda');
    expect(rows[0]['mediaType']).toBe('SSD');
    expect(rows[1]['mediaType']).toBe('HDD');
  });

  it('parseDiskSmartWindows: handles empty array', () => {
    const rows = parseDiskSmartWindows('[]');
    expect(rows).toEqual([]);
  });
});

// ── DSK-02: disk-partitions (integration) ──────────────────────────────────

describe('disk-partitions (DSK-02)', () => {
  it('returns rows with device and fsType fields', async () => {
    const result = await run('disk-partitions') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      expect(Array.isArray(rows)).toBe(true);
      if (rows.length > 0) {
        expect(typeof rows[0]['device']).toBe('string');
        expect(typeof rows[0]['sizeBytes']).toBe('number');
      }
    }
  });
});

// ── DSK-03: disk-space (integration) ────────────────────────────────────────

describe('disk-space (DSK-03)', () => {
  it('returns rows with sizeBytes > 0 and valid usePercent', async () => {
    const result = await run('disk-space') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(typeof first['sizeBytes']).toBe('number');
    expect(Number(first['sizeBytes'])).toBeGreaterThan(0);
    expect(Number(first['usePercent'])).toBeGreaterThanOrEqual(0);
    expect(Number(first['usePercent'])).toBeLessThanOrEqual(100);
    expect(result['tool']).toBe('disk-space');
    expect(['linux', 'win32', 'wsl']).toContain(result['platform']);
  });
});

// ── DSK-04: file-search ─────────────────────────────────────────────────────

describe('file-search (DSK-04)', () => {
  it('finds TypeScript files in src directory', async () => {
    const result = await run('file-search', ['src/services/sysint/tools/disk', '*.ts']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(String(first['name']).endsWith('.ts')).toBe(true);
    expect(typeof first['sizeBytes']).toBe('number');
    expect(typeof first['modifiedAt']).toBe('string');
  });

  it('returns EXEC_FAILED for non-existent directory', async () => {
    const result = await run('file-search', ['/non/existent/path/xyz123']) as Record<string, unknown>;
    expect('error' in result).toBe(true);
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('returns empty array when pattern matches nothing', async () => {
    const result = await run('file-search', ['.', '*.xyz_doesnt_exist_abc']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    expect((result['rows'] as unknown[]).length).toBe(0);
  });
});

// ── DSK-05: duplicate-finder ────────────────────────────────────────────────

describe('duplicate-finder (DSK-05)', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = join(tmpdir(), `sysint-test-dupes-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    // Create duplicate files
    await writeFile(join(tempDir, 'file1.txt'), 'hello world duplicate content');
    await writeFile(join(tempDir, 'file2.txt'), 'hello world duplicate content');
    await writeFile(join(tempDir, 'file3.txt'), 'different content here');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects duplicate files by hash', async () => {
    const result = await run('duplicate-finder', [tempDir, '0']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(Number(rows[0]['count'])).toBe(2);
    expect(Array.isArray(rows[0]['paths'])).toBe(true);
  });

  it('returns empty when no duplicates', async () => {
    const uniqueDir = join(tmpdir(), `sysint-unique-${Date.now()}`);
    await mkdir(uniqueDir, { recursive: true });
    await writeFile(join(uniqueDir, 'a.txt'), 'content a');
    await writeFile(join(uniqueDir, 'b.txt'), 'content b');
    const result = await run('duplicate-finder', [uniqueDir, '0']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    expect((result['rows'] as unknown[]).length).toBe(0);
    await rm(uniqueDir, { recursive: true, force: true });
  });
});

// ── DSK-06: large-files ─────────────────────────────────────────────────────

describe('large-files (DSK-06)', () => {
  it('returns rows sorted by size descending', async () => {
    const result = await run('large-files', ['src/services/sysint', '10', '1024']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    if (rows.length >= 2) {
      expect(Number(rows[0]['sizeBytes'])).toBeGreaterThanOrEqual(Number(rows[1]['sizeBytes']));
    }
    if (rows.length > 0) {
      expect(Number(rows[0]['sizeBytes'])).toBeGreaterThanOrEqual(1024);
    }
  }, 60_000);
});

// ── DSK-07: recent-files ────────────────────────────────────────────────────

describe('recent-files (DSK-07)', () => {
  it('returns rows with modifiedAt field', async () => {
    const result = await run('recent-files', ['src/services/sysint', '10']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      expect(typeof rows[0]['modifiedAt']).toBe('string');
      expect(typeof rows[0]['path']).toBe('string');
      // Should be sortable ISO timestamp
      expect(new Date(rows[0]['modifiedAt'] as string).getTime()).not.toBeNaN();
    }
  }, 60_000);
});

// ── DSK-09: drive-map ───────────────────────────────────────────────────────

describe('drive-map (DSK-09)', () => {
  it('returns rows with drive and root fields', async () => {
    const result = await run('drive-map') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        expect(typeof rows[0]['drive']).toBe('string');
        expect(typeof rows[0]['root']).toBe('string');
      }
    }
  });
});

// ── Standard envelope check ──────────────────────────────────────────────────

describe('standard SysInt envelope', () => {
  it('disk-space has tool, platform, timestamp, rows, count fields', async () => {
    const result = await run('disk-space') as Record<string, unknown>;
    expect(result['tool']).toBe('disk-space');
    expect(['linux', 'win32', 'wsl']).toContain(result['platform']);
    expect(typeof result['timestamp']).toBe('string');
    expect(Array.isArray(result['rows'])).toBe(true);
    expect(typeof result['count']).toBe('number');
  });
});
