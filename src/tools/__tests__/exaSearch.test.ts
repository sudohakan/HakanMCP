import { exaTools } from '../exaSearch.js';

describe('exaSearch MCP tools', () => {
  it('exports exaTools array', () => {
    expect(Array.isArray(exaTools)).toBe(true);
    expect(exaTools.length).toBeGreaterThanOrEqual(3);
  });

  it('registers expected tool names', () => {
    const names = exaTools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['exaSearch', 'exaFindSimilar', 'exaGetContents']));
  });

  it('each tool has description and handler', () => {
    for (const t of exaTools) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.handler).toBe('function');
    }
  });

  it('handler fails gracefully without EXA_API_KEY', async () => {
    const prev = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
    const tool = exaTools.find((t) => t.name === 'exaSearch')!;
    await expect(tool.handler({ query: 'test', numResults: 5 })).rejects.toThrow(/EXA_API_KEY/);
    if (prev) process.env.EXA_API_KEY = prev;
  });
});
