import { selfImprovementTools } from '../src/tools/selfImprovement';

describe('Self Improvement Tools', () => {
  describe('self_proposeChange', () => {
    it('should be defined with correct schema', () => {
      const tool = selfImprovementTools.find((t) => t.name === 'self_proposeChange');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('change');
      expect(tool?.inputSchema.properties).toHaveProperty('operation');
      expect(tool?.inputSchema.properties).toHaveProperty('files');
      expect(tool?.inputSchema.properties).toHaveProperty('changes');
    });

    it('should require all fields', () => {
      const tool = selfImprovementTools.find((t) => t.name === 'self_proposeChange');
      expect(tool?.inputSchema.required).toContain('operation');
      expect(tool?.inputSchema.required).toContain('files');
      expect(tool?.inputSchema.required).toContain('description');
      expect(tool?.inputSchema.required).toContain('changes');
    });
  });

  describe('self_applyChange', () => {
    it('should be defined with correct schema', () => {
      const tool = selfImprovementTools.find((t) => t.name === 'self_applyChange');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('Apply');
      expect(tool?.inputSchema.properties).toHaveProperty('proposalId');
    });

    it('should require proposalId', () => {
      const tool = selfImprovementTools.find((t) => t.name === 'self_applyChange');
      expect(tool?.inputSchema.required).toContain('proposalId');
    });
  });

  describe('self_getChangeLog', () => {
    it('should be defined with correct schema', () => {
      const tool = selfImprovementTools.find((t) => t.name === 'self_getChangeLog');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('Lists');
      expect(tool?.inputSchema.properties).toHaveProperty('limit');
    });

    it('should return change log', async () => {
      const tool = selfImprovementTools.find((t) => t.name === 'self_getChangeLog');

      // Should work even if log file doesn't exist (returns empty message)
      const result = await tool!.handler({});
      expect(result.content).toBeDefined();
    });
  });

  describe('All Self Improvement Tools', () => {
    it('should export all expected tools', () => {
      const expectedTools = ['self_proposeChange', 'self_applyChange', 'self_getChangeLog'];
      const actualTools = selfImprovementTools.map((t) => t.name);

      for (const tool of expectedTools) {
        expect(actualTools).toContain(tool);
      }
    });
  });
});
