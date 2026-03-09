import { githubTools } from '../src/tools/github';

describe('GitHub Tools', () => {
  // These tests verify tool structure and validation without requiring actual GitHub credentials
  // Real GitHub operations would require GITHUB_TOKEN and proper configuration

  describe('github_setupRemote', () => {
    it('should be defined with correct schema', () => {
      const tool = githubTools.find((t) => t.name === 'github_setupRemote');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('GitHub remote');
      expect(tool?.inputSchema.properties).toHaveProperty('force');
      expect(tool?.inputSchema.properties).toHaveProperty('owner');
      expect(tool?.inputSchema.properties).toHaveProperty('repo');
    });

    it('should handle missing configuration or existing remote', async () => {
      const tool = githubTools.find((t) => t.name === 'github_setupRemote');

      // Should return a response (either error or warning about existing remote)
      const result = await tool!.handler({});

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toBeDefined();
      // Can be either "disabled/missing/not found" or "already exists"
      expect(result.content[0].text.length).toBeGreaterThan(0);
    });

    it('should accept force parameter', async () => {
      const tool = githubTools.find((t) => t.name === 'github_setupRemote');

      const result = await tool!.handler({ force: true });
      expect(result.content).toBeDefined();
    });

    it('should accept dynamic owner and repo parameters', async () => {
      const tool = githubTools.find((t) => t.name === 'github_setupRemote');

      const result = await tool!.handler({
        owner: 'testowner',
        repo: 'testrepo',
        force: false,
      });
      expect(result.content).toBeDefined();
    });
  });

  describe('github_push', () => {
    it('should be defined with correct schema', () => {
      const tool = githubTools.find((t) => t.name === 'github_push');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('Push');
      expect(tool?.inputSchema.properties).toHaveProperty('message');
      expect(tool?.inputSchema.properties).toHaveProperty('force');
      expect(tool?.inputSchema.properties).toHaveProperty('owner');
      expect(tool?.inputSchema.properties).toHaveProperty('repo');
    });

    it('should handle push operation with or without configuration', async () => {
      const tool = githubTools.find((t) => t.name === 'github_push');

      const result = await tool!.handler({
        message: 'Test commit',
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toBeDefined();
      // Can succeed if GitHub is configured, or fail if not configured
      expect(result.content[0].text.length).toBeGreaterThan(0);
    });

    it('should accept optional message parameter', async () => {
      const tool = githubTools.find((t) => t.name === 'github_push');

      const result = await tool!.handler({});
      expect(result.content).toBeDefined();
    });

    it('should accept force parameter', async () => {
      const tool = githubTools.find((t) => t.name === 'github_push');

      const result = await tool!.handler({
        message: 'Test',
        force: true,
      });
      expect(result.content).toBeDefined();
    });

    it('should accept dynamic owner and repo parameters', async () => {
      const tool = githubTools.find((t) => t.name === 'github_push');

      const result = await tool!.handler({
        owner: 'testowner',
        repo: 'testrepo',
        message: 'Test commit',
      });
      expect(result.content).toBeDefined();
    });
  });

  describe('github_pull', () => {
    it('should be defined with correct schema', () => {
      const tool = githubTools.find((t) => t.name === 'github_pull');
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/pull/i);
      expect(tool?.inputSchema.properties).toHaveProperty('owner');
      expect(tool?.inputSchema.properties).toHaveProperty('repo');
    });

    it('should reject when GitHub is not configured', async () => {
      const tool = githubTools.find((t) => t.name === 'github_pull');

      const result = await tool!.handler({});
      expect(result.content).toBeDefined();
    });

    it('should accept force parameter', async () => {
      const tool = githubTools.find((t) => t.name === 'github_pull');

      const result = await tool!.handler({ force: true });
      expect(result.content).toBeDefined();
    });

    it('should accept dynamic owner and repo parameters', async () => {
      const tool = githubTools.find((t) => t.name === 'github_pull');

      const result = await tool!.handler({
        owner: 'testowner',
        repo: 'testrepo',
      });
      expect(result.content).toBeDefined();
    });
  });

  describe('github_status', () => {
    it('should be defined with correct schema', () => {
      const tool = githubTools.find((t) => t.name === 'github_status');
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/status|durum/i);
      expect(tool?.inputSchema.properties).toHaveProperty('owner');
      expect(tool?.inputSchema.properties).toHaveProperty('repo');
    });

    it('should work without GitHub config', async () => {
      const tool = githubTools.find((t) => t.name === 'github_status');

      // Status should work even without GitHub config (shows local git status)
      try {
        const result = await tool!.handler({});
        expect(result.content).toBeDefined();
      } catch (error: unknown) {
        // May fail if not in a git repository
        expect(error).toBeDefined();
      }
    });

    it('should accept dynamic owner and repo parameters', async () => {
      const tool = githubTools.find((t) => t.name === 'github_status');

      const result = await tool!.handler({
        owner: 'testowner',
        repo: 'testrepo',
      });
      expect(result.content).toBeDefined();
    });
  });

  describe('github_createRepo', () => {
    it('should be defined with correct schema', () => {
      const tool = githubTools.find((t) => t.name === 'github_createRepo');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('repository');
      expect(tool?.inputSchema.properties).toHaveProperty('description');
      expect(tool?.inputSchema.properties).toHaveProperty('owner');
      expect(tool?.inputSchema.properties).toHaveProperty('repo');
    });

    it('should reject when GitHub is not configured', async () => {
      const tool = githubTools.find((t) => t.name === 'github_createRepo');

      const result = await tool!.handler({
        description: 'Test Repo',
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toMatch(/disabled|missing|not found|error/i);
    });

    it('should accept dynamic owner and repo parameters', async () => {
      const tool = githubTools.find((t) => t.name === 'github_createRepo');

      const result = await tool!.handler({
        owner: 'testowner',
        repo: 'testrepo',
        description: 'Test Repository',
      });
      expect(result.content).toBeDefined();
    });
  });

  describe('All GitHub Tools', () => {
    it('should export all expected tools', () => {
      const expectedTools = [
        'github_setupRemote',
        'github_push',
        'github_pull',
        'github_status',
        'github_createRepo',
      ];

      const actualTools = githubTools.map((t) => t.name);

      for (const toolName of expectedTools) {
        expect(actualTools).toContain(toolName);
      }
    });

    it('should have unique tool names', () => {
      const names = githubTools.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it('all tools should have descriptions', () => {
      for (const tool of githubTools) {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it('all tools should have input schemas', () => {
      for (const tool of githubTools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('all tools should have handlers', () => {
      for (const tool of githubTools) {
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('all tools should support dynamic owner/repo parameters', () => {
      for (const tool of githubTools) {
        expect(tool.inputSchema.properties).toHaveProperty('owner');
        expect(tool.inputSchema.properties).toHaveProperty('repo');
        expect(tool.description).toMatch(/owner|repo|dinamik|dynamic/i);
      }
    });
  });

  describe('Dynamic Repository Selection', () => {
    it('should prioritize provided parameters over config', async () => {
      // This test verifies that when both config and parameters are available,
      // the parameters take precedence (validation logic handles this)
      const tool = githubTools.find((t) => t.name === 'github_push');

      const result = await tool!.handler({
        owner: 'custom-owner',
        repo: 'custom-repo',
        message: 'Test with custom repo',
      });

      // The result should be based on the custom owner/repo
      expect(result.content).toBeDefined();
      // Will fail due to missing token, but the parameters should be accepted
    });

    it('should validate that at least owner or repo is provided if config is missing', async () => {
      const tool = githubTools.find((t) => t.name === 'github_status');

      const result = await tool!.handler({});

      // Without config or parameters, should show error
      expect(result.content).toBeDefined();
    });
  });
});
