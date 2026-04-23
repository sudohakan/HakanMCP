import { shodanTools } from '../shodanRecon.js';

describe('shodanRecon MCP tools', () => {
  it('exports shodanTools array', () => {
    expect(Array.isArray(shodanTools)).toBe(true);
    expect(shodanTools.length).toBeGreaterThanOrEqual(3);
  });

  it('registers expected tool names', () => {
    const names = shodanTools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['shodanHostInfo', 'shodanSearch', 'shodanDnsResolve']));
  });

  it('each tool has description and handler', () => {
    for (const t of shodanTools) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.handler).toBe('function');
    }
  });

  it('handler fails gracefully without SHODAN_API_KEY', async () => {
    const prev = process.env.SHODAN_API_KEY;
    delete process.env.SHODAN_API_KEY;
    const tool = shodanTools.find((t) => t.name === 'shodanHostInfo')!;
    await expect(tool.handler({ ip: '1.2.3.4' })).rejects.toThrow(/SHODAN_API_KEY/);
    if (prev) process.env.SHODAN_API_KEY = prev;
  });
});
