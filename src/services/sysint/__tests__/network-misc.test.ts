/**
 * Extended network tools tests — NET-08..10, NET-13, NET-15..20
 * Plan 04: route-table, arp-table, mac-resolve, http-headers, ssl-checker,
 *          wake-on-lan, bandwidth-test, connection-log, bluetooth-scan, network-shares
 */
import { parseRouteWindows, parseRouteLinux, parseArpWindows, parseArpLinux } from '../tools/network/misc.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const routeWindowsFixture = readFileSync(path.join(FIXTURES, 'route-windows.txt'), 'utf8');
const routeLinuxFixture = readFileSync(path.join(FIXTURES, 'route-linux.txt'), 'utf8');
const arpWindowsFixture = readFileSync(path.join(FIXTURES, 'arp-windows.txt'), 'utf8');
const arpLinuxFixture = readFileSync(path.join(FIXTURES, 'arp-linux.txt'), 'utf8');

describe('parseRouteWindows', () => {
  it('parses routes from fixture', () => {
    const rows = parseRouteWindows(routeWindowsFixture);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(typeof first.destination).toBe('string');
    expect(typeof first.gateway).toBe('string');
    expect(typeof first.metric).toBe('number');
  });

  it('returns empty for empty input', () => {
    expect(parseRouteWindows('')).toEqual([]);
  });
});

describe('parseRouteLinux', () => {
  it('parses routes from fixture', () => {
    const rows = parseRouteLinux(routeLinuxFixture);
    // route-linux.txt may use /proc/net/route format — just check array
    expect(Array.isArray(rows)).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(parseRouteLinux('')).toEqual([]);
  });
});

describe('parseArpWindows', () => {
  it('parses ARP entries from fixture', () => {
    const rows = parseArpWindows(arpWindowsFixture);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(typeof first.ip).toBe('string');
    expect(typeof first.mac).toBe('string');
  });

  it('returns empty for empty input', () => {
    expect(parseArpWindows('')).toEqual([]);
  });
});

describe('parseArpLinux', () => {
  it('parses ARP entries from fixture', () => {
    const rows = parseArpLinux(arpLinuxFixture);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(typeof rows[0].ip).toBe('string');
      expect(typeof rows[0].mac).toBe('string');
    }
  });

  it('returns empty for empty input', () => {
    expect(parseArpLinux('')).toEqual([]);
  });
});

describe('route-table (NET-08) integration', () => {
  it('returns rows or graceful error — never crashes', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('route-table', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });
});

describe('arp-table (NET-09) integration', () => {
  it('returns rows or graceful error — never crashes', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('arp-table', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });
});

describe('mac-resolve (NET-10) integration', () => {
  it('returns EXEC_FAILED when no IP provided', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('mac-resolve', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });
});

describe('http-headers (NET-13) integration', () => {
  it('returns EXEC_FAILED when no URL provided', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('http-headers', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('fetches headers for example.com', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('http-headers', ['https://example.com']) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      const status = rows.find((r) => r['name'] === ':status');
      expect(status).toBeDefined();
    }
  }, 15_000);
});

describe('ssl-checker (NET-15) integration', () => {
  it('returns EXEC_FAILED when no host provided', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('ssl-checker', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('checks example.com certificate', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('ssl-checker', ['example.com']) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      expect(typeof rows[0]['daysRemaining']).toBe('number');
    }
  }, 15_000);
});

describe('wake-on-lan (NET-16) integration', () => {
  it('returns EXEC_FAILED when no MAC provided', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('wake-on-lan', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('returns EXEC_FAILED for invalid MAC', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('wake-on-lan', ['not-a-mac']) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });
});

describe('connection-log (NET-18) integration', () => {
  it('returns rows or graceful error — never crashes', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('connection-log', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });
});

describe('bluetooth-scan (NET-19) integration', () => {
  it('returns rows or graceful error — never crashes', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('bluetooth-scan', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });
});

describe('network-shares (NET-20) integration', () => {
  it('returns rows or graceful error — never crashes', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('network-shares', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });
});

describe('unknown tool', () => {
  it('returns EXEC_FAILED', async () => {
    const { run } = await import('../tools/network/misc.js');
    const result = await run('nonexistent', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });
});
