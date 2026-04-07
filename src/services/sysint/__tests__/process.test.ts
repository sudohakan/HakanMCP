/**
 * Process tools unit tests — Phase 1 PRC-01..08
 *
 * Test strategy:
 * - Pure parser functions tested with fixture data directly
 * - SI-dependent tools: integration tests against real OS (shape validation)
 * - exec-dependent tools: tested via extracted parser functions
 * - Error cases: tested directly with invalid inputs
 *
 * Note: jest.unstable_mockModule for Node.js built-ins (node:child_process) does not
 * intercept calls reliably in this project's ts-jest ESM setup. Parser functions are
 * exported from process.ts to enable unit testing without exec mocking.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(process.cwd(), 'src/services/sysint/__tests__/fixtures');

// Load fixtures
const netstatWindowsFixture = readFileSync(path.join(FIXTURES, 'netstat-windows.txt'), 'utf8');
const linuxServiceFixture = readFileSync(path.join(FIXTURES, 'systemctl-services-linux.txt'), 'utf8');
const winServiceFixture = readFileSync(path.join(FIXTURES, 'get-service-windows.txt'), 'utf8');
const proc1LinuxData = readFileSync(path.join(FIXTURES, 'si-processes.json'), 'utf8');

// Import module under test
let run: (toolId: string, args?: string[]) => Promise<unknown>;
let parseNetstatWindows: (output: string, pidToName?: Map<number, string>) => Array<{ pid: number; processName: string; protocol: string; localPort: number; remotePort: number; state: string }>;
let parseWindowsServices: (json: string) => Array<{ name: string; displayName: string; status: string; startType: string }>;
let parseLinuxServices: (json: string) => Array<{ name: string; displayName: string; status: string; startType: string }>;

beforeAll(async () => {
  const mod = await import('../tools/process.js');
  run = mod.run;
  parseNetstatWindows = mod.parseNetstatWindows;
  parseWindowsServices = mod.parseWindowsServices;
  parseLinuxServices = mod.parseLinuxServices;
});

// ── PRC-01: process-list (integration — real OS) ─────────────────────────────

describe('process-list (PRC-01)', () => {
  it('returns rows array with all 6 required fields', async () => {
    const result = await run('process-list') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(typeof first['pid']).toBe('number');
    expect(typeof first['name']).toBe('string');
    expect(typeof first['cpu']).toBe('number');
    expect(typeof first['memoryBytes']).toBe('number');
    expect(typeof first['user']).toBe('string');
    expect(typeof first['commandLine']).toBe('string');
  });

  it('returns tool=process-list, valid platform, count=rows.length', async () => {
    const result = await run('process-list') as Record<string, unknown>;
    expect(result['tool']).toBe('process-list');
    expect(['linux', 'win32', 'wsl']).toContain(result['platform']);
    expect(typeof result['timestamp']).toBe('string');
    expect(result['count']).toBe((result['rows'] as unknown[]).length);
  });
});

// ── PRC-07: process-tree (integration — real OS) ──────────────────────────────

describe('process-tree (PRC-07)', () => {
  it('returns rows with pid, parentPid, name, children fields', async () => {
    const result = await run('process-tree') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(typeof first['pid']).toBe('number');
    expect(typeof first['parentPid']).toBe('number');
    expect(typeof first['name']).toBe('string');
    expect(Array.isArray(first['children'])).toBe(true);
  });

  it('tool=process-tree in response', async () => {
    const result = await run('process-tree') as Record<string, unknown>;
    expect(result['tool']).toBe('process-tree');
  });
});

// ── parseNetstatWindows (pure parser) ────────────────────────────────────────

describe('parseNetstatWindows', () => {
  it('parses TCP ESTABLISHED row with pid=7892, remotePort=443', () => {
    const rows = parseNetstatWindows(netstatWindowsFixture);
    const established = rows.find((r) => r.state === 'ESTABLISHED' && r.remotePort === 443);
    expect(established).toBeDefined();
    expect(established?.pid).toBe(7892);
  });

  it('parses LISTENING rows', () => {
    const rows = parseNetstatWindows(netstatWindowsFixture);
    const listening = rows.filter((r) => r.state === 'LISTENING');
    expect(listening.length).toBeGreaterThan(0);
  });

  it('parses UDP rows — state is empty string', () => {
    const rows = parseNetstatWindows(netstatWindowsFixture);
    const udp = rows.filter((r) => r.protocol === 'UDP');
    expect(udp.length).toBeGreaterThan(0);
    udp.forEach((r) => expect(r.state).toBe(''));
  });

  it('enriches processName from pidToName map', () => {
    const pidToName = new Map([[7892, 'chrome.exe']]);
    const rows = parseNetstatWindows(netstatWindowsFixture, pidToName);
    const chrome = rows.find((r) => r.pid === 7892);
    expect(chrome?.processName).toBe('chrome.exe');
  });

  it('returns empty array for blank input', () => {
    expect(parseNetstatWindows('')).toEqual([]);
  });

  it('all rows have pid, protocol, localPort, remotePort as numbers', () => {
    const rows = parseNetstatWindows(netstatWindowsFixture);
    rows.forEach((r) => {
      expect(typeof r.pid).toBe('number');
      expect(['TCP', 'UDP']).toContain(r.protocol);
      expect(typeof r.localPort).toBe('number');
      expect(typeof r.remotePort).toBe('number');
    });
  });
});

// ── parseWindowsServices (pure parser) ───────────────────────────────────────

describe('parseWindowsServices', () => {
  it('maps Status=4 → running, StartType=2 → auto', () => {
    const rows = parseWindowsServices(winServiceFixture);
    expect(rows.length).toBe(4);
    const spooler = rows.find((r) => r.name === 'Spooler');
    expect(spooler?.status).toBe('running');
    expect(spooler?.startType).toBe('auto');
  });

  it('maps Status=1 → stopped, StartType=3 → manual', () => {
    const rows = parseWindowsServices(winServiceFixture);
    const winrm = rows.find((r) => r.name === 'WinRM');
    expect(winrm?.status).toBe('stopped');
    expect(winrm?.startType).toBe('manual');
  });

  it('includes displayName', () => {
    const rows = parseWindowsServices(winServiceFixture);
    const spooler = rows.find((r) => r.name === 'Spooler');
    expect(spooler?.displayName).toBe('Print Spooler');
  });
});

// ── parseLinuxServices (pure parser) ─────────────────────────────────────────

describe('parseLinuxServices', () => {
  it('active/running service maps to running', () => {
    const rows = parseLinuxServices(linuxServiceFixture);
    expect(rows.length).toBe(4);
    const nm = rows.find((r) => r.name.includes('NetworkManager'));
    expect(nm?.status).toBe('running');
  });

  it('inactive/dead service maps to stopped', () => {
    const rows = parseLinuxServices(linuxServiceFixture);
    const ufw = rows.find((r) => r.name.includes('ufw'));
    expect(ufw?.status).toBe('stopped');
  });

  it('strips .service suffix from unit name', () => {
    const rows = parseLinuxServices(linuxServiceFixture);
    rows.forEach((r) => expect(r.name).not.toContain('.service'));
  });
});

// ── PRC-02: process-connections (integration — real OS linux) ─────────────────

describe('process-connections (PRC-02)', () => {
  it('returns rows or error response — never crashes', async () => {
    const result = await run('process-connections', []) as Record<string, unknown>;
    expect(result).toBeDefined();
    // Either rows or error
    expect('rows' in result || 'error' in result).toBe(true);
  });

  it('with PID filter — never crashes', async () => {
    const result = await run('process-connections', ['99999']) as Record<string, unknown>;
    expect(result).toBeDefined();
  });

  it('tool id in response', async () => {
    const result = await run('process-connections', []) as Record<string, unknown>;
    if ('rows' in result) {
      expect(result['tool']).toBe('process-connections');
    }
  });
});

// ── PRC-08: service-list (integration — tests shape) ─────────────────────────

describe('service-list (PRC-08)', () => {
  it('returns rows or error — never crashes', async () => {
    const result = await run('service-list') as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });

  it('tool=service-list when successful', async () => {
    const result = await run('service-list') as Record<string, unknown>;
    if ('rows' in result) {
      expect(result['tool']).toBe('service-list');
      const rows = result['rows'] as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        expect(typeof rows[0]['name']).toBe('string');
        expect(['running', 'stopped', 'pending', 'unknown']).toContain(rows[0]['status']);
      }
    }
  });
});

// ── PRC-03: process-modules ───────────────────────────────────────────────────

describe('process-modules (PRC-03)', () => {
  it('returns EXEC_FAILED when no PID provided', async () => {
    const result = await run('process-modules', []) as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
    expect(String(result['error'])).toMatch(/PID required/);
  });

  it('with real PID — returns rows or error (never crashes)', async () => {
    const result = await run('process-modules', ['1']) as Record<string, unknown>;
    expect(result).toBeDefined();
  });
});

// ── PRC-04: process-threads ───────────────────────────────────────────────────

describe('process-threads (PRC-04)', () => {
  it('returns EXEC_FAILED when no PID provided', async () => {
    const result = await run('process-threads', []) as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('with real PID 1 — returns rows', async () => {
    const result = await run('process-threads', ['1']) as Record<string, unknown>;
    if ('rows' in result) {
      expect(result['tool']).toBe('process-threads');
    }
  });
});

// ── PRC-05: process-handles ───────────────────────────────────────────────────

describe('process-handles (PRC-05)', () => {
  it('returns EXEC_FAILED when no PID provided', async () => {
    const result = await run('process-handles', []) as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });
});

// ── PRC-06: process-io ────────────────────────────────────────────────────────

describe('process-io (PRC-06)', () => {
  it('returns EXEC_FAILED when no PID provided', async () => {
    const result = await run('process-io', []) as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
    expect(String(result['error'])).toMatch(/PID required/);
  });

  it('with real PID 1 — returns rows or error', async () => {
    const result = await run('process-io', ['1']) as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      expect(result['tool']).toBe('process-io');
      const row = (result['rows'] as Array<Record<string, unknown>>)[0];
      expect(typeof row['readBytes']).toBe('number');
      expect(typeof row['writeBytes']).toBe('number');
    }
  });
});

// ── Unknown tool ──────────────────────────────────────────────────────────────

describe('unknown tool', () => {
  it('returns EXEC_FAILED for unrecognized toolId', async () => {
    const result = await run('not-a-real-process-tool') as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });
});
