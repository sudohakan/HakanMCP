import { academicTools } from '../academicSearch.js';

describe('academicSearch MCP tools', () => {
  it('exports academicTools array', () => {
    expect(Array.isArray(academicTools)).toBe(true);
    expect(academicTools.length).toBeGreaterThanOrEqual(3);
  });

  it('registers expected tool names', () => {
    const names = academicTools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['arxivSearch', 'semanticScholarSearch', 'paperDetails']));
  });

  it('each tool has description and handler', () => {
    for (const t of academicTools) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.handler).toBe('function');
    }
  });
});
