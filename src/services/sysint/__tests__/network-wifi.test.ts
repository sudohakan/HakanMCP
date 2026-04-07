/**
 * Wi-Fi tools tests — NET-04 (wifi-scan), NET-05 (wifi-history)
 */
import { parseNetshNetworks, parseNmcliWifi, parseNetshProfiles } from '../tools/network/wifi.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const netshFixture = readFileSync(path.join(FIXTURES, 'netsh-wifi-networks.txt'), 'utf8');
const nmcliFixture = readFileSync(path.join(FIXTURES, 'nmcli-wifi.txt'), 'utf8');
const netshProfilesFixture = readFileSync(path.join(FIXTURES, 'netsh-wifi-profiles.txt'), 'utf8');

describe('parseNetshNetworks', () => {
  it('parses SSID and signal from fixture', () => {
    const rows = parseNetshNetworks(netshFixture);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(typeof first.ssid).toBe('string');
    expect(typeof first.signalPercent).toBe('number');
  });

  it('returns empty for empty input', () => {
    expect(parseNetshNetworks('')).toEqual([]);
  });

  it('signalPercent is between 0 and 100', () => {
    const rows = parseNetshNetworks(netshFixture);
    rows.forEach((r) => {
      expect(r.signalPercent).toBeGreaterThanOrEqual(0);
      expect(r.signalPercent).toBeLessThanOrEqual(100);
    });
  });
});

describe('parseNmcliWifi', () => {
  it('parses SSID and signal from fixture', () => {
    const rows = parseNmcliWifi(nmcliFixture);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(typeof first.ssid).toBe('string');
  });

  it('returns empty for empty input', () => {
    expect(parseNmcliWifi('')).toEqual([]);
  });
});

describe('parseNetshProfiles', () => {
  it('parses profile ssids from fixture', () => {
    const profiles = parseNetshProfiles(netshProfilesFixture);
    expect(profiles.length).toBeGreaterThan(0);
    expect(typeof profiles[0].ssid).toBe('string');
  });

  it('returns empty for empty input', () => {
    expect(parseNetshProfiles('')).toEqual([]);
  });
});

describe('wifi-scan (NET-04) integration', () => {
  it('returns rows or graceful error — never crashes', async () => {
    const { run } = await import('../tools/network/wifi.js');
    const result = await run('wifi-scan', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });
});

describe('wifi-history (NET-05) integration', () => {
  it('returns rows or graceful error — never crashes', async () => {
    const { run } = await import('../tools/network/wifi.js');
    const result = await run('wifi-history', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });
});
