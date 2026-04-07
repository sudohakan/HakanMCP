/**
 * Disk extended tools unit tests — Phase 2 DSK-08..14
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const vssadminFixture = readFileSync(join(FIXTURES, 'vssadmin-shadows.txt'), 'utf8');

let run: (toolId: string, args?: string[]) => Promise<unknown>;
let parseShadowCopies: (output: string) => unknown[];
let computeFileHash: (filePath: string, algorithm?: string) => Promise<string>;

beforeAll(async () => {
  const recoveryMod = await import('../tools/disk/recovery.js');
  parseShadowCopies = recoveryMod.parseShadowCopies;

  const hashMod = await import('../tools/disk/hash.js');
  computeFileHash = hashMod.computeFileHash;

  const indexMod = await import('../tools/disk/index.js');
  run = indexMod.run;
});

// ── DSK-08: disk-ads ────────────────────────────────────────────────────────

describe('disk-ads (DSK-08)', () => {
  it('returns PLATFORM_UNSUPPORTED on pure Linux (not WSL)', async () => {
    // Use sysint platform, not process.platform (WSL reports 'linux' in process.platform but 'wsl' in sysint)
    const { getPlatformName } = await import('../platforms/index.js');
    const sysintPlatform = getPlatformName();
    if (sysintPlatform === 'linux') {
      const result = await run('disk-ads') as Record<string, unknown>;
      expect('error' in result).toBe(true);
      expect(result['code']).toBe('PLATFORM_UNSUPPORTED');
    } else {
      // On Windows/WSL, verify it returns rows or error (PowerShell attempt)
      const result = await run('disk-ads') as Record<string, unknown>;
      expect('rows' in result || 'error' in result).toBe(true);
    }
  }, 30_000);
});

// ── DSK-10: disk-io ─────────────────────────────────────────────────────────

describe('disk-io (DSK-10)', () => {
  it('returns rows with readBytes and writeBytes as numbers', async () => {
    const result = await run('disk-io') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0]['readBytes']).toBe('number');
    expect(typeof rows[0]['writeBytes']).toBe('number');
    expect(result['tool']).toBe('disk-io');
  });
});

// ── DSK-11: disk-freespace-log ──────────────────────────────────────────────

describe('disk-freespace-log (DSK-11)', () => {
  it('snapshot: returns new entries with timestamp and mountPoint', async () => {
    const result = await run('disk-freespace-log', ['snapshot']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0]['timestamp']).toBe('string');
    expect(typeof rows[0]['mountPoint']).toBe('string');
    expect(typeof rows[0]['freeBytes']).toBe('number');
  });

  it('list: returns array without crash', async () => {
    const result = await run('disk-freespace-log', ['list']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    expect(Array.isArray(result['rows'])).toBe(true);
  });
});

// ── DSK-12: disk-links ──────────────────────────────────────────────────────

describe('disk-links (DSK-12)', () => {
  it('returns rows with path and type fields', async () => {
    const result = await run('disk-links', ['src/services/sysint/tools', '2']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    // May return 0 rows if no symlinks, that's valid
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(['symlink', 'junction']).toContain(rows[0]['type']);
      expect(typeof rows[0]['path']).toBe('string');
      expect(typeof rows[0]['exists']).toBe('boolean');
    }
  });
});

// ── DSK-13: file-hash ───────────────────────────────────────────────────────

describe('file-hash (DSK-13)', () => {
  it('computeFileHash returns 64-char hex for sha256', async () => {
    const hash = await computeFileHash('src/services/sysint/tools/disk/hash.ts');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeFileHash returns 32-char hex for md5', async () => {
    const hash = await computeFileHash('src/services/sysint/tools/disk/hash.ts', 'md5');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('run file-hash: returns row with hash field', async () => {
    const result = await run('file-hash', ['src/services/sysint/tools/disk/hash.ts']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0]['hash'])).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]['algorithm']).toBe('sha256');
  });

  it('run file-hash: fails for non-existent file', async () => {
    const result = await run('file-hash', ['/non/existent/file.xyz']) as Record<string, unknown>;
    expect('error' in result).toBe(true);
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('run file-hash: fails when no path given', async () => {
    const result = await run('file-hash') as Record<string, unknown>;
    expect('error' in result).toBe(true);
  });
});

// ── DSK-14: disk-recovery ───────────────────────────────────────────────────

describe('disk-recovery (DSK-14)', () => {
  it('parseShadowCopies: parses two shadow copies from fixture', () => {
    const rows = parseShadowCopies(vssadminFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(typeof rows[0]['id']).toBe('string');
    expect(rows[0]['id']).toBeTruthy();
    expect(rows[0]['originatingMachine']).toBe('DESKTOP-ABC123');
  });

  it('parseShadowCopies: handles empty output', () => {
    const rows = parseShadowCopies('No items found that satisfy the query.');
    expect(rows).toEqual([]);
  });

  it('run disk-recovery: returns rows or empty array', async () => {
    const result = await run('disk-recovery') as Record<string, unknown>;
    // On Windows: rows with shadow copy data. On Linux: rows with recovery tool info.
    // Either rows or error is acceptable.
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 30_000);
});

// ── All disk tools registered ────────────────────────────────────────────────

describe('disk module registration', () => {
  const ALL_DISK_TOOLS = [
    'disk-smart', 'disk-partitions', 'disk-space', 'file-search', 'duplicate-finder',
    'large-files', 'recent-files', 'disk-ads', 'drive-map', 'disk-io',
    'disk-freespace-log', 'disk-links', 'file-hash', 'disk-recovery',
  ];

  for (const toolId of ALL_DISK_TOOLS) {
    it(`${toolId} is reachable via run() without crash`, async () => {
      const args = toolId === 'file-hash' ? ['src/services/sysint/outputFormatter.ts'] :
                   toolId === 'file-search' ? ['src/services/sysint', '*.ts', '1'] :
                   toolId === 'duplicate-finder' ? ['src/services/sysint/tools/disk', '0'] :
                   toolId === 'large-files' ? ['src/services/sysint', '5', '1024'] :
                   toolId === 'recent-files' ? ['src/services/sysint', '5'] :
                   toolId === 'disk-links' ? ['src/services/sysint', '1'] : [];
      const result = await run(toolId, args) as Record<string, unknown>;
      // Either success or a known error — never undefined/null/throw
      expect(result).toBeDefined();
      expect('rows' in result || 'error' in result).toBe(true);
    }, 120_000);
  }
});
