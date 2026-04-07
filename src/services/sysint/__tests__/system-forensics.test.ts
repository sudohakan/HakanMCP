/**
 * System forensics tools unit tests — Phase 2 SYS-14..25
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const lastLinuxFixture = readFileSync(join(FIXTURES, 'last-linux.txt'), 'utf8');
const prefetchFixture = readFileSync(join(FIXTURES, 'prefetch-list.txt'), 'utf8');
const jumpListFixture = readFileSync(join(FIXTURES, 'jump-list-files.txt'), 'utf8').trim().split('\n');

let run: (toolId: string, args?: string[]) => Promise<unknown>;
let parseLastOutput: (text: string) => unknown[];
let parsePrefetchList: (json: string) => unknown[];
let parseJumpListFiles: (files: string[]) => unknown[];

beforeAll(async () => {
  const forensicsMod = await import('../tools/system/forensics.js');
  parseLastOutput = forensicsMod.parseLastOutput;
  parsePrefetchList = forensicsMod.parsePrefetchList;
  parseJumpListFiles = forensicsMod.parseJumpListFiles;

  const indexMod = await import('../tools/system/index.js');
  run = indexMod.run;
});

// ── SYS-14: login-history parsers ───────────────────────────────────────────

describe('login-history parsers (SYS-14)', () => {
  it('parseLastOutput: returns rows with user and loginAt', () => {
    const rows = parseLastOutput(lastLinuxFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]['user']).toBe('hakan');
    expect(typeof rows[0]['loginAt']).toBe('string');
    expect(typeof rows[0]['fromAddress']).toBe('string');
  });

  it('parseLastOutput: skips wtmp line', () => {
    const rows = parseLastOutput(lastLinuxFixture) as Array<Record<string, unknown>>;
    const wtmpRows = rows.filter((r) => String(r['user']).startsWith('wtmp'));
    expect(wtmpRows.length).toBe(0);
  });

  it('parseLastOutput: handles empty input', () => {
    const rows = parseLastOutput('');
    expect(rows).toEqual([]);
  });
});

// ── SYS-16: prefetch-info parsers ───────────────────────────────────────────

describe('prefetch-info parsers (SYS-16)', () => {
  it('parsePrefetchList: extracts appName and hash from filename', () => {
    const rows = parsePrefetchList(prefetchFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);
    expect(rows[0]['appName']).toBe('CHROME.EXE');
    expect(rows[0]['hash']).toBe('3A4F8B2C');
    expect(typeof rows[0]['sizeBytes']).toBe('number');
  });

  it('parsePrefetchList: handles empty array', () => {
    const rows = parsePrefetchList('[]');
    expect(rows).toEqual([]);
  });
});

// ── SYS-25: jump-lists parsers ───────────────────────────────────────────────

describe('jump-lists parsers (SYS-25)', () => {
  it('parseJumpListFiles: extracts appId from filenames', () => {
    const rows = parseJumpListFiles(jumpListFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);
    expect(rows[0]['appId']).toBe('1b4dd67f29b99d');
    expect(typeof rows[0]['fileName']).toBe('string');
  });

  it('parseJumpListFiles: handles empty array', () => {
    const rows = parseJumpListFiles([]);
    expect(rows).toEqual([]);
  });
});

// ── SYS-21: environment-vars (integration) ──────────────────────────────────

describe('environment-vars (SYS-21) integration', () => {
  it('returns rows including PATH entry', async () => {
    const result = await run('environment-vars') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const pathRow = rows.find((r) => r['name'] === 'PATH' || r['name'] === 'Path');
    expect(pathRow).toBeDefined();
    expect(typeof pathRow!['value']).toBe('string');
  });

  it('filter: returns only matching vars', async () => {
    const result = await run('environment-vars', ['PATH']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    rows.forEach((r) => {
      expect(String(r['name']).toUpperCase()).toContain('PATH');
    });
  });
});

// ── SYS-18: running-services (integration) ──────────────────────────────────

describe('running-services (SYS-18) integration', () => {
  it('all returned rows have status=running', async () => {
    const result = await run('running-services') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      rows.forEach((r) => {
        expect(r['status']).toBe('running');
      });
    }
  }, 60_000);
});

// ── SYS-19: security-software (integration) ─────────────────────────────────

describe('security-software (SYS-19) integration', () => {
  it('returns rows or empty array without crash', async () => {
    const result = await run('security-software') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 30_000);
});

// ── SYS-24: last-activity (integration) ─────────────────────────────────────

describe('last-activity (SYS-24) integration', () => {
  it('returns rows or empty array without crash', async () => {
    const result = await run('last-activity') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 30_000);
});

// ── Platform guard tests ────────────────────────────────────────────────────

describe('platform guards', () => {
  it('jump-lists on pure Linux (not WSL) returns PLATFORM_UNSUPPORTED', async () => {
    const { getPlatformName } = await import('../platforms/index.js');
    if (getPlatformName() === 'linux') {
      const result = await run('jump-lists') as Record<string, unknown>;
      expect('error' in result).toBe(true);
      expect(result['code']).toBe('PLATFORM_UNSUPPORTED');
    }
  });

  it('shell-extensions on pure Linux (not WSL) returns empty rows', async () => {
    const { getPlatformName } = await import('../platforms/index.js');
    if (getPlatformName() === 'linux') {
      const result = await run('shell-extensions') as Record<string, unknown>;
      expect('rows' in result).toBe(true);
      expect((result['rows'] as unknown[]).length).toBe(0);
    }
  });

  it('prefetch-info on pure Linux (not WSL) returns empty rows', async () => {
    const { getPlatformName } = await import('../platforms/index.js');
    if (getPlatformName() === 'linux') {
      const result = await run('prefetch-info') as Record<string, unknown>;
      expect('rows' in result).toBe(true);
      expect((result['rows'] as unknown[]).length).toBe(0);
    }
  });
});

// ── SYS-14..15 integration ──────────────────────────────────────────────────

describe('login-history (SYS-14) integration', () => {
  it('returns rows or empty array without crash', async () => {
    const result = await run('login-history') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 30_000);
});

describe('boot-history (SYS-15) integration', () => {
  it('returns rows or empty array without crash', async () => {
    const result = await run('boot-history') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 30_000);
});
