import { selfImprovementTools } from '../src/tools/selfImprovement';

describe('Self Improvement Tools', () => {
  describe('self_proposeChange', () => {
    it('should be defined with correct schema', () => {
      const tool = selfImprovementTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('change');
      expect(tool?.inputSchema.properties).toHaveProperty('operation');
      expect(tool?.inputSchema.properties).toHaveProperty('files');
      expect(tool?.inputSchema.properties).toHaveProperty('changes');
    });

    it('should require action field', () => {
      const tool = selfImprovementTools[0]!;
      expect(tool?.inputSchema.required).toContain('action');
    });
  });

  describe('self_applyChange', () => {
    it('should be defined with correct schema', () => {
      const tool = selfImprovementTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('Apply');
      expect(tool?.inputSchema.properties).toHaveProperty('proposalId');
    });

    it('should have proposalId property', () => {
      const tool = selfImprovementTools[0]!;
      expect(tool?.inputSchema.properties).toHaveProperty('proposalId');
    });
  });

  describe('self_getChangeLog', () => {
    it('should be defined with correct schema', () => {
      const tool = selfImprovementTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('Lists');
      expect(tool?.inputSchema.properties).toHaveProperty('limit');
    });

    it('should return change log', async () => {
      const tool = selfImprovementTools[0]!;

      // Should work even if log file doesn't exist (returns empty message)
      const result = await tool.handler({ action: 'changelog' });
      expect(result.content).toBeDefined();
    });
  });

  describe('All Self Improvement Tools', () => {
    it('should export the self tool', () => {
      expect(selfImprovementTools.length).toBeGreaterThan(0);
      expect(selfImprovementTools[0]!.name).toBe('self');
    });
  });
});
