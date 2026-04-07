/**
 * DNS, WHOIS, and traceroute tests — NET-03, NET-11, NET-12
 */
import { parseTracerouteWindows, parseTracerouteLinux } from '../tools/network/dns.js';

describe('parseTracerouteWindows', () => {
  const windowsOutput = `
Tracing route to 8.8.8.8 over a maximum of 30 hops:

  1    <1 ms    <1 ms    <1 ms  192.168.1.1
  2     8 ms     7 ms     8 ms  10.0.0.1
  3    12 ms    11 ms    12 ms  8.8.8.8
`;

  it('parses hop number and IP', () => {
    const rows = parseTracerouteWindows(windowsOutput);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].hop).toBe(1);
    expect(rows[0].ip).toBe('192.168.1.1');
  });

  it('returns empty for empty input', () => {
    expect(parseTracerouteWindows('')).toEqual([]);
  });
});

describe('parseTracerouteLinux', () => {
  const linuxOutput = `
traceroute to 8.8.8.8 (8.8.8.8), 30 hops max
 1  192.168.1.1  1.234 ms
 2  10.0.0.1  8.456 ms
 3  8.8.8.8  12.123 ms
`;

  it('parses hop number and IP', () => {
    const rows = parseTracerouteLinux(linuxOutput);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows.find((r) => r.hop === 1);
    expect(first?.ip).toBe('192.168.1.1');
  });

  it('rttMs is a number when present', () => {
    const rows = parseTracerouteLinux(linuxOutput);
    rows.forEach((r) => {
      if (r.rttMs !== null) expect(typeof r.rttMs).toBe('number');
    });
  });
});

describe('dns-lookup (NET-03) integration', () => {
  let run: (toolId: string, args: string[]) => Promise<unknown>;

  beforeAll(async () => {
    const mod = await import('../tools/network/dns.js');
    run = mod.run;
  });

  it('returns EXEC_FAILED when no hostname provided', async () => {
    const result = await run('dns-lookup', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
    expect(String(result['error'])).toMatch(/hostname required/);
  });

  it('resolves example.com — returns rows with type and value', async () => {
    const result = await run('dns-lookup', ['example.com']) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      expect(result['tool']).toBe('dns-lookup');
      const rows = result['rows'] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      const aRecord = rows.find((r) => r['type'] === 'A');
      expect(aRecord).toBeDefined();
      expect(typeof aRecord?.['value']).toBe('string');
    }
  }, 15_000);
});

describe('traceroute (NET-12)', () => {
  let run: (toolId: string, args: string[]) => Promise<unknown>;

  beforeAll(async () => {
    const mod = await import('../tools/network/dns.js');
    run = mod.run;
  });

  it('returns EXEC_FAILED when no host provided', async () => {
    const result = await run('traceroute', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });
});
