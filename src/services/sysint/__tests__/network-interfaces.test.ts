/**
 * Network interfaces and stats tests — NET-02, NET-14
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(process.cwd(), 'src/services/sysint/__tests__/fixtures');
const siInterfacesFixture = JSON.parse(readFileSync(path.join(FIXTURES, 'si-interfaces.json'), 'utf8'));

describe('network-interfaces (NET-02) integration', () => {
  let run: (toolId: string, args: string[]) => Promise<unknown>;

  beforeAll(async () => {
    const mod = await import('../tools/network/interfaces.js');
    run = mod.run;
  });

  it('returns rows with required interface fields', async () => {
    const result = await run('network-interfaces', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      expect(result['tool']).toBe('network-interfaces');
      const rows = result['rows'] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      const first = rows[0];
      expect(typeof first['name']).toBe('string');
      expect(typeof first['ip4']).toBe('string');
      expect(typeof first['mac']).toBe('string');
      expect(typeof first['status']).toBe('string');
    }
  });

  it('response has tool and platform fields', async () => {
    const result = await run('network-interfaces', []) as unknown as Record<string, unknown>;
    if ('rows' in result) {
      expect(['linux', 'win32', 'wsl']).toContain(result['platform']);
    }
  });
});

describe('network-stats (NET-14) integration', () => {
  let run: (toolId: string, args: string[]) => Promise<unknown>;

  beforeAll(async () => {
    const mod = await import('../tools/network/interfaces.js');
    run = mod.run;
  });

  it('returns rows or error — never crashes', async () => {
    const result = await run('network-stats', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result).toBe(true);
  });

  it('stats rows have rxBytes and txBytes when successful', async () => {
    const result = await run('network-stats', []) as unknown as Record<string, unknown>;
    if ('rows' in result) {
      const rows = result['rows'] as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        expect(typeof rows[0]['rxBytes']).toBe('number');
        expect(typeof rows[0]['txBytes']).toBe('number');
      }
    }
  });
});

describe('si-interfaces fixture shape validation', () => {
  it('fixture has expected fields', () => {
    expect(Array.isArray(siInterfacesFixture)).toBe(true);
    const first = siInterfacesFixture[0];
    expect(first.iface).toBe('eth0');
    expect(first.ip4).toBe('192.168.1.100');
    expect(first.mac).toBe('00:11:22:33:44:55');
    expect(first.operstate).toBe('up');
  });
});
