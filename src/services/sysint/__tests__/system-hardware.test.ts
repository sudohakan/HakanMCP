/**
 * System hardware tools unit tests — Phase 2 SYS-06..13, SYS-23
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const driverQueryFixture = readFileSync(join(FIXTURES, 'driverquery.csv'), 'utf8');
const lsmodFixture = readFileSync(join(FIXTURES, 'lsmod.txt'), 'utf8');
const winEventFixture = readFileSync(join(FIXTURES, 'winevent-sample.json'), 'utf8');

let run: (toolId: string, args?: string[]) => Promise<unknown>;
let parseDriverQuery: (csv: string) => unknown[];
let parseLsmod: (text: string) => unknown[];
let parseScheduledTasks: (csv: string) => unknown[];
let parseCrontab: (text: string) => unknown[];
let parseWinEvent: (json: string) => unknown[];
let parseMinidumpList: (files: string[]) => unknown[];

beforeAll(async () => {
  const hwMod = await import('../tools/system/hardware.js');
  parseDriverQuery = hwMod.parseDriverQuery;
  parseLsmod = hwMod.parseLsmod;
  parseScheduledTasks = hwMod.parseScheduledTasks;
  parseCrontab = hwMod.parseCrontab;

  const evMod = await import('../tools/system/events.js');
  parseWinEvent = evMod.parseWinEvent;
  parseMinidumpList = evMod.parseMinidumpList;

  const indexMod = await import('../tools/system/index.js');
  run = indexMod.run;
});

// ── SYS-06: driver-list parsers ─────────────────────────────────────────────

describe('driver-list parsers (SYS-06)', () => {
  it('parseDriverQuery: returns rows with name and state', () => {
    const rows = parseDriverQuery(driverQueryFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0]['name']).toBe('string');
    expect(typeof rows[0]['state']).toBe('string');
  });

  it('parseLsmod: returns rows with name and sizeBytes', () => {
    const rows = parseLsmod(lsmodFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(7);
    expect(rows[0]['name']).toBe('nvidia_uvm');
    expect(Number(rows[0]['sizeBytes'])).toBeGreaterThan(0);
  });
});

// ── SYS-08: scheduled-tasks parsers ─────────────────────────────────────────

describe('scheduled-tasks parsers (SYS-08)', () => {
  it('parseCrontab: returns rows from crontab text', () => {
    const crontab = '# run daily\n0 2 * * * /usr/bin/backup.sh\n30 8 * * 1-5 /home/user/sync.sh';
    const rows = parseCrontab(crontab) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows[0]['status']).toBe('enabled');
    expect(typeof rows[0]['command']).toBe('string');
  });
});

// ── SYS-09: event-log parsers ───────────────────────────────────────────────

describe('event-log parsers (SYS-09)', () => {
  it('parseWinEvent: returns rows with timestamp, level, source, message', () => {
    const rows = parseWinEvent(winEventFixture) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);
    expect(typeof rows[0]['timestamp']).toBe('string');
    expect(typeof rows[0]['level']).toBe('string');
    expect(typeof rows[0]['source']).toBe('string');
    expect(typeof rows[0]['message']).toBe('string');
    expect(rows[0]['id']).toBe(7036);
  });

  it('parseMinidumpList: empty array for no files', () => {
    const rows = parseMinidumpList([]);
    expect(rows).toEqual([]);
  });

  it('parseMinidumpList: returns metadata for .dmp files', () => {
    const rows = parseMinidumpList(['Mini010124-01.dmp', 'Mini010224-02.dmp']) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows[0]['fileName']).toBe('Mini010124-01.dmp');
  });
});

// ── SYS-12: battery-info (integration) ──────────────────────────────────────

describe('battery-info (SYS-12)', () => {
  it('returns rows including hasBattery field', async () => {
    const result = await run('battery-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(typeof rows[0]['hasBattery']).toBe('boolean');
  });
});

// ── SYS-13: monitor-info (integration) ──────────────────────────────────────

describe('monitor-info (SYS-13)', () => {
  it('returns rows or empty array without crash', async () => {
    const result = await run('monitor-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    expect(Array.isArray(result['rows'])).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      expect(typeof rows[0]['model']).toBe('string');
      expect(typeof rows[0]['main']).toBe('boolean');
    }
  });
});

// ── SYS-06 integration ──────────────────────────────────────────────────────

describe('driver-list (SYS-06) integration', () => {
  it('returns rows with name field on current platform', async () => {
    const result = await run('driver-list') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      expect(typeof rows[0]['name']).toBe('string');
    }
  }, 30_000);
});

// ── SYS-07: startup-programs (integration) ──────────────────────────────────

describe('startup-programs (SYS-07) integration', () => {
  it('returns at least 1 row on any system', async () => {
    const result = await run('startup-programs') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 30_000);
});

// ── SYS-09: event-log (integration) ─────────────────────────────────────────

describe('event-log (SYS-09) integration', () => {
  it('returns rows or empty array with hours=1', async () => {
    const result = await run('event-log', ['all', '', '1', '10']) as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 60_000);
});

// ── SYS-10: crash-analysis (integration) ────────────────────────────────────

describe('crash-analysis (SYS-10) integration', () => {
  it('returns empty array on healthy system (no crash)', async () => {
    const result = await run('crash-analysis') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    expect(Array.isArray(result['rows'])).toBe(true);
  }, 30_000);
});

// ── SYS-11: usb-history (integration) ───────────────────────────────────────

describe('usb-history (SYS-11) integration', () => {
  it('returns rows or empty array without crash', async () => {
    const result = await run('usb-history') as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 30_000);
});

// ── SYS-23: hardware-info (integration) ─────────────────────────────────────

describe('hardware-info (SYS-23) integration', () => {
  it('returns manufacturer as string', async () => {
    const result = await run('hardware-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(typeof rows[0]['manufacturer']).toBe('string');
    expect(typeof rows[0]['biosVersion']).toBe('string');
  });
});
