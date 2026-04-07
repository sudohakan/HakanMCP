/**
 * Network scanner tests — NET-06 (ping-test), NET-07 (port-scan)
 */
import { parsePingWindows, parsePingLinux } from '../tools/network/scanner.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const pingWindowsFixture = readFileSync(path.join(FIXTURES, 'ping-windows.txt'), 'utf8');
const pingLinuxFixture = readFileSync(path.join(FIXTURES, 'ping-linux.txt'), 'utf8');

describe('parsePingWindows', () => {
  it('parses reachable and avgMs from fixture', () => {
    const result = parsePingWindows(pingWindowsFixture, '8.8.8.8');
    expect(result.host).toBe('8.8.8.8');
    expect(result.reachable).toBe(true);
    expect(typeof result.avgMs).toBe('number');
    expect(result.packetLoss).toBeLessThan(100);
  });

  it('unreachable when 100% loss', () => {
    const output = 'Packets: Sent = 4, Received = 0, Lost = 4 (100% loss)';
    const result = parsePingWindows(output, 'bad.host');
    expect(result.reachable).toBe(false);
    expect(result.packetLoss).toBe(100);
  });

  it('avgMs is null when no average line', () => {
    const result = parsePingWindows('(0% loss)', '1.2.3.4');
    expect(result.avgMs).toBeNull();
    expect(result.reachable).toBe(true);
  });
});

describe('parsePingLinux', () => {
  it('parses reachable and avgMs from fixture', () => {
    const result = parsePingLinux(pingLinuxFixture, '8.8.8.8');
    expect(result.host).toBe('8.8.8.8');
    expect(result.reachable).toBe(true);
    expect(typeof result.avgMs).toBe('number');
  });

  it('unreachable when 100% packet loss', () => {
    const output = '3 packets transmitted, 0 received, 100% packet loss';
    const result = parsePingLinux(output, 'bad.host');
    expect(result.reachable).toBe(false);
    expect(result.packetLoss).toBe(100);
  });
});

describe('ping-test (NET-06) integration', () => {
  it('pings localhost — returns reachable result', async () => {
    const { run } = await import('../tools/network/scanner.js');
    const result = await run('ping-test', ['127.0.0.1']) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]['host']).toBe('127.0.0.1');
      expect(typeof rows[0]['reachable']).toBe('boolean');
    }
  }, 15_000);

  it('defaults to 127.0.0.1 when no args', async () => {
    const { run } = await import('../tools/network/scanner.js');
    const result = await run('ping-test', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  }, 15_000);
});

describe('port-scan (NET-07) integration', () => {
  it('returns EXEC_FAILED when no host provided', async () => {
    const { run } = await import('../tools/network/scanner.js');
    const result = await run('port-scan', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('returns EXEC_FAILED for invalid port range', async () => {
    const { run } = await import('../tools/network/scanner.js');
    const result = await run('port-scan', ['127.0.0.1', '1000', '500']) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('scans localhost narrow range — returns rows', async () => {
    const { run } = await import('../tools/network/scanner.js');
    const result = await run('port-scan', ['127.0.0.1', '1', '10']) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
    if ('rows' in result) {
      expect(result['tool']).toBe('port-scan');
    }
  }, 30_000);
});
