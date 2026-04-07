/**
 * Network connections tests — NET-01 (cports)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseNetstatWindowsConnections, parseSsOutput } from '../tools/network/connections.js';

const FIXTURES = path.join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const netstatFixture = readFileSync(path.join(FIXTURES, 'netstat-windows.txt'), 'utf8');

describe('parseNetstatWindowsConnections', () => {
  it('parses TCP ESTABLISHED row with pid=7892, remotePort=443', () => {
    const rows = parseNetstatWindowsConnections(netstatFixture);
    const established = rows.find((r) => r.state === 'ESTABLISHED' && r.remotePort === 443);
    expect(established).toBeDefined();
    expect(established?.pid).toBe(7892);
    expect(established?.protocol).toBe('TCP');
  });

  it('parses LISTENING TCP rows', () => {
    const rows = parseNetstatWindowsConnections(netstatFixture);
    const listening = rows.filter((r) => r.state === 'LISTENING');
    expect(listening.length).toBeGreaterThan(0);
  });

  it('parses UDP rows — state empty, remotePort=0', () => {
    const rows = parseNetstatWindowsConnections(netstatFixture);
    const udp = rows.filter((r) => r.protocol === 'UDP');
    expect(udp.length).toBeGreaterThan(0);
    udp.forEach((r) => {
      expect(r.state).toBe('');
      expect(r.remotePort).toBe(0);
    });
  });

  it('enriches processName from pidToName map', () => {
    const pidToName = new Map([[7892, 'chrome.exe']]);
    const rows = parseNetstatWindowsConnections(netstatFixture, pidToName);
    const chrome = rows.find((r) => r.pid === 7892);
    expect(chrome?.processName).toBe('chrome.exe');
  });

  it('returns empty for blank input', () => {
    expect(parseNetstatWindowsConnections('')).toEqual([]);
  });

  it('each row has pid, protocol, localPort as expected types', () => {
    const rows = parseNetstatWindowsConnections(netstatFixture);
    rows.forEach((r) => {
      expect(typeof r.pid).toBe('number');
      expect(['TCP', 'UDP']).toContain(r.protocol);
      expect(typeof r.localPort).toBe('number');
    });
  });
});

describe('parseSsOutput', () => {
  it('returns empty rows for empty input', () => {
    expect(parseSsOutput('')).toEqual([]);
  });

  it('parses basic ss -tupn output', () => {
    const ssOutput = 'tcp   ESTAB  0  0  192.168.1.100:51234  52.96.100.1:443  users:(("node",pid=1234,fd=22))';
    const rows = parseSsOutput(ssOutput);
    expect(rows.length).toBeGreaterThan(0);
    if (rows.length > 0) {
      expect(rows[0].protocol).toBe('TCP');
      expect(rows[0].pid).toBe(1234);
      expect(rows[0].processName).toBe('node');
    }
  });
});

describe('cports integration', () => {
  it('returns rows or graceful error — never crashes', async () => {
    const { run } = await import('../tools/network/connections.js');
    const result = await run('cports', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });

  it('result tool=cports when successful', async () => {
    const { run } = await import('../tools/network/connections.js');
    const result = await run('cports', []) as unknown as Record<string, unknown>;
    if ('rows' in result) {
      expect(result['tool']).toBe('cports');
      const rows = result['rows'] as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        // Success criteria #2: rows include processName (may be empty on this OS)
        expect('processName' in rows[0]).toBe(true);
        expect('pid' in rows[0]).toBe(true);
      }
    }
  });
});
