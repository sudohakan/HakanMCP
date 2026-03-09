import { gitbookTools } from '../src/tools/gitbook';

describe('GitBook Tools', () => {
  const testPath = ''; // Root path for testing

  describe('getPage', () => {
    it('should fetch GitBook page content', async () => {
      const tool = gitbookTools.find((t) => t.name === 'getPage');
      expect(tool).toBeDefined();

      const result = await tool!.handler({ path: testPath });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text.length).toBeGreaterThan(0);
      // meta is optional, check if exists
      if ((result as { meta?: { url?: string } }).meta) {
        expect((result as { meta?: { url?: string } }).meta?.url).toBeDefined();
      }
    }, 30000);

    it('should handle full URL', async () => {
      const tool = gitbookTools.find((t) => t.name === 'getPage');

      const result = await tool!.handler({
        path: 'https://finekra.gitbook.io/finekra-api',
      });

      expect(result.content[0].text).toBeDefined();
    }, 30000);
  });

  describe('listLinks', () => {
    it('should list internal links', async () => {
      const tool = gitbookTools.find((t) => t.name === 'listLinks');

      const result = await tool!.handler({ path: testPath });

      const response = JSON.parse(result.content[0].text);
      expect(response.base).toBeDefined();
      expect(response.links).toBeInstanceOf(Array);
    }, 30000);

    it('should deduplicate links', async () => {
      const tool = gitbookTools.find((t) => t.name === 'listLinks');

      const result = await tool!.handler({ path: testPath });

      const response = JSON.parse(result.content[0].text);
      const hrefs = response.links.map((l: { href?: string }) => l.href);
      const uniqueHrefs = [...new Set(hrefs)];

      // Should have same length if properly deduplicated
      expect(hrefs.length).toBe(uniqueHrefs.length);
    }, 30000);
  });

  describe('find', () => {
    it('should search for text pattern', async () => {
      const tool = gitbookTools.find((t) => t.name === 'find');

      const result = await tool!.handler({
        path: testPath,
        pattern: 'API',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.url).toBeDefined();
      expect(response.matches).toBeInstanceOf(Array);
    }, 30000);

    it('should support regex patterns', async () => {
      const tool = gitbookTools.find((t) => t.name === 'find');

      const result = await tool!.handler({
        path: testPath,
        pattern: '\\d+', // Find numbers
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.matches).toBeInstanceOf(Array);
    }, 30000);

    it('should limit results to 50', async () => {
      const tool = gitbookTools.find((t) => t.name === 'find');

      const result = await tool!.handler({
        path: testPath,
        pattern: '.', // Match everything
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.matches.length).toBeLessThanOrEqual(50);
    }, 30000);
  });

  describe('gb_headings', () => {
    it('should extract H1-H3 headings', async () => {
      const tool = gitbookTools.find((t) => t.name === 'gb_headings');

      const result = await tool!.handler({ path: testPath });

      const headings = JSON.parse(result.content[0].text);
      expect(headings).toBeInstanceOf(Array);

      headings.forEach((h: { level?: number; text?: string }) => {
        expect(h.level).toBeGreaterThanOrEqual(1);
        expect(h.level).toBeLessThanOrEqual(3);
        expect(h.text).toBeDefined();
      });
    }, 30000);
  });

  describe('gb_outline', () => {
    it('should extract headings with IDs', async () => {
      const tool = gitbookTools.find((t) => t.name === 'gb_outline');

      const result = await tool!.handler({ path: testPath });

      const outline = JSON.parse(result.content[0].text);
      expect(outline).toBeInstanceOf(Array);

      outline.forEach((h: { level?: number; text?: string }) => {
        expect(h.level).toBeDefined();
        expect(h.text).toBeDefined();
        expect(h).toHaveProperty('id');
      });
    }, 30000);
  });

  describe('gb_getMetadata', () => {
    it('should extract page metadata', async () => {
      const tool = gitbookTools.find((t) => t.name === 'gb_getMetadata');

      const result = await tool!.handler({ path: testPath });

      const response = JSON.parse(result.content[0].text);
      expect(response.url).toBeDefined();
      expect(response.metadata).toBeDefined();
      expect(response.metadata).toHaveProperty('title');
      expect(response.metadata).toHaveProperty('description');
      expect(response.metadata).toHaveProperty('keywords');
      expect(response.metadata).toHaveProperty('author');
      expect(response.metadata).toHaveProperty('ogTitle');
      expect(response.metadata).toHaveProperty('ogDescription');
      expect(response.metadata).toHaveProperty('ogImage');
    }, 30000);

    it('should handle pages without all metadata', async () => {
      const tool = gitbookTools.find((t) => t.name === 'gb_getMetadata');

      const result = await tool!.handler({ path: testPath });

      const response = JSON.parse(result.content[0].text);
      // Should not throw, just return empty strings
      expect(response.metadata).toBeDefined();
    }, 30000);
  });

  describe('gb_searchContent', () => {
    it('should search content with context', async () => {
      const tool = gitbookTools.find((t) => t.name === 'gb_searchContent');

      const result = await tool!.handler({
        path: testPath,
        searchTerm: 'API',
        contextLines: 2,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.url).toBeDefined();
      expect(response.searchTerm).toBe('API');
      expect(response.matchCount).toBeGreaterThanOrEqual(0);
      expect(response.matches).toBeInstanceOf(Array);
    }, 30000);

    it('should include context lines', async () => {
      const tool = gitbookTools.find((t) => t.name === 'gb_searchContent');

      const result = await tool!.handler({
        path: testPath,
        searchTerm: 'API',
        contextLines: 3,
      });

      const response = JSON.parse(result.content[0].text);

      if (response.matches.length > 0) {
        const firstMatch = response.matches[0];
        expect(firstMatch.lineNumber).toBeDefined();
        expect(firstMatch.matchedLine).toBeDefined();
        expect(firstMatch.context).toBeInstanceOf(Array);
        expect(firstMatch.contextRange).toBeDefined();
      }
    }, 30000);

    it('should limit results to 20 matches', async () => {
      const tool = gitbookTools.find((t) => t.name === 'gb_searchContent');

      const result = await tool!.handler({
        path: testPath,
        searchTerm: 'a', // Common letter
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.matches.length).toBeLessThanOrEqual(20);
    }, 30000);

    it('should be case insensitive', async () => {
      const tool = gitbookTools.find((t) => t.name === 'gb_searchContent');

      const result1 = await tool!.handler({
        path: testPath,
        searchTerm: 'API',
      });

      const result2 = await tool!.handler({
        path: testPath,
        searchTerm: 'api',
      });

      const response1 = JSON.parse(result1.content[0].text);
      const response2 = JSON.parse(result2.content[0].text);

      expect(response1.matchCount).toBe(response2.matchCount);
    }, 30000);
  });

  describe('caching', () => {
    it('should cache repeated requests', async () => {
      const tool = gitbookTools.find((t) => t.name === 'getPage');

      // First request - cache miss
      const result1 = await tool!.handler({ path: testPath });

      // Second request - should hit cache
      const result2 = await tool!.handler({ path: testPath });

      expect(result1.content[0].text).toBe(result2.content[0].text);
    }, 30000);
  });
});
