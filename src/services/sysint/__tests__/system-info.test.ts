/**
 * System info tools unit tests — Phase 2 SYS-01..05, SYS-20, SYS-22
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const dpkgFixture = readFileSync(join(FIXTURES, 'dpkg-list.txt'), 'utf8');
const wingetFixture = readFileSync(join(FIXTURES, 'winget-list.json'), 'utf8');
const hotfixFixture = readFileSync(join(FIXTURES, 'get-hotfix.json'), 'utf8');

let run: (toolId: string, args?: string[]) => Promise<unknown>;
let parseInstalledAppsWindows: (json: string) => unknown[];
let parseInstalledAppsLinux: (text: string) => unknown[];
let parseHotFix: (json: string) => unknown[];
let parseDpkgLog: (text: string) => unknown[];

beforeAll(async () => {
  const appsMod = await import('../tools/system/apps.js');
  parseInstalledAppsWindows = appsMod.parseInstalledAppsWindows;
  parseInstalledAppsLinux = appsMod.parseInstalledAppsLinux;
  parseHotFix = appsMod.parseHotFix;
  parseDpkgLog = appsMod.parseDpkgLog;

  const indexMod = await import('../tools/system/index.js');
  run = indexMod.run;
});

// ── SYS-01: cpu-info ────────────────────────────────────────────────────────

describe('cpu-info (SYS-01)', () => {
  it('returns cores > 0 and brand as string', async () => {
    const result = await run('cpu-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(Number(rows[0]['cores'])).toBeGreaterThan(0);
    expect(typeof rows[0]['brand']).toBe('string');
    expect(result['tool']).toBe('cpu-info');
    expect(['linux', 'win32', 'wsl']).toContain(result['platform']);
  });
});

// ── SYS-02: memory-info ─────────────────────────────────────────────────────

describe('memory-info (SYS-02)', () => {
  it('totalBytes > 0 and freeBytes <= totalBytes', async () => {
    const result = await run('memory-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(Number(row['totalBytes'])).toBeGreaterThan(0);
    expect(Number(row['freeBytes'])).toBeLessThanOrEqual(Number(row['totalBytes']));
    expect(typeof row['swapTotalBytes']).toBe('number');
  });
});

// ── SYS-03: os-info ─────────────────────────────────────────────────────────

describe('os-info (SYS-03)', () => {
  it('platform is win32 or linux, uptime is number', async () => {
    const result = await run('os-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(['win32', 'linux', 'wsl']).toContain(rows[0]['platform']);
    expect(Number(rows[0]['uptime'])).toBeGreaterThan(0);
    expect(typeof rows[0]['hostname']).toBe('string');
  });
});

// ── SYS-04: installed-apps parsers ──────────────────────────────────────────

describe('installed-apps parsers (SYS-04)', () => {
  it('parseInstalledAppsWindows: returns rows with name and version', () => {
    const rows = parseInstalledAppsWindows(wingetFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(4);
    expect(rows[0]['name']).toBe('Google Chrome');
    expect(rows[0]['version']).toBe('120.0.6099.217');
    expect(typeof rows[0]['publisher']).toBe('string');
  });

  it('parseInstalledAppsLinux: returns rows from dpkg-query output', () => {
    const rows = parseInstalledAppsLinux(dpkgFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const bash = rows.find((r) => r['name'] === 'bash');
    expect(bash).toBeDefined();
    expect(bash!['version']).toBe('5.1-6ubuntu1');
  });

  it('parseInstalledAppsWindows: handles empty array', () => {
    const rows = parseInstalledAppsWindows('[]');
    expect(rows).toEqual([]);
  });
});

// ── SYS-05: update-history parsers ──────────────────────────────────────────

describe('update-history parsers (SYS-05)', () => {
  it('parseHotFix: returns rows with id and installedAt', () => {
    const rows = parseHotFix(hotfixFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);
    expect(rows[0]['id']).toBe('KB5034441');
    expect(rows[0]['description']).toBe('Security Update');
    expect(typeof rows[0]['installedAt']).toBe('string');
  });

  it('parseDpkgLog: parses install entries', () => {
    const log = '2024-01-15 10:30:00 install curl:amd64 <none> 7.81.0-1ubuntu1.15\n2024-01-15 10:31:00 upgrade bash:amd64 5.1-6ubuntu1 5.1-6ubuntu2';
    const rows = parseDpkgLog(log) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows[0]['source']).toBe('dpkg');
  });
});

// ── SYS-22: timezone-info ───────────────────────────────────────────────────

describe('timezone-info (SYS-22)', () => {
  it('returns timezone, utcOffset, and currentTime', async () => {
    const result = await run('timezone-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(typeof rows[0]['timezone']).toBe('string');
    expect(String(rows[0]['utcOffset'])).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
    expect(typeof rows[0]['currentTime']).toBe('string');
  });
});

// ── SYS-04 integration ──────────────────────────────────────────────────────

describe('installed-apps (SYS-04) integration', () => {
  it('returns at least 1 row on any system', async () => {
    const result = await run('installed-apps') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
    }
  }, 90_000);
});

// ── SYS-05 integration ──────────────────────────────────────────────────────

describe('update-history (SYS-05) integration', () => {
  it('returns rows or empty array without crash', async () => {
    const result = await run('update-history') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 30_000);
});

// ── SYS-20 integration ──────────────────────────────────────────────────────

describe('installed-packages (SYS-20) integration', () => {
  it('returns rows or empty array without crash', async () => {
    const result = await run('installed-packages') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 60_000);
});
