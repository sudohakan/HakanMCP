import { GuidanceEngine } from '../services/guidanceEngine.js';

describe('GuidanceEngine', () => {
  let engine: GuidanceEngine;

  beforeEach(() => {
    engine = new GuidanceEngine();
  });

  describe('compilePolicy', () => {
    it('should always include built-in destructive rules', () => {
      const rules = engine.compilePolicy('');
      const destructiveRules = rules.filter((r) => r.category === 'destructive');
      expect(destructiveRules.length).toBeGreaterThanOrEqual(7);
      expect(destructiveRules.some((r) => r.condition === 'rm -rf')).toBe(true);
      expect(destructiveRules.some((r) => r.condition === 'DROP TABLE')).toBe(true);
    });

    it('should generate secrets rules from content', () => {
      const rules = engine.compilePolicy('Do not expose .env or api_key values');
      const secretRules = rules.filter((r) => r.category === 'secrets');
      expect(secretRules.length).toBeGreaterThanOrEqual(2);
    });

    it('should assign unique IDs to all rules', () => {
      const rules = engine.compilePolicy('rm delete .env token secret');
      const ids = rules.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('enforce', () => {
    beforeEach(() => {
      engine.compilePolicy('standard policy');
    });

    it('should block rm -rf', () => {
      const result = engine.enforce('rm -rf /tmp');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Destructive');
    });

    it('should allow safe actions like ls', () => {
      const result = engine.enforce('ls -la');
      expect(result.allowed).toBe(true);
    });

    it('should block .env file access in context', () => {
      const result = engine.enforce('git commit', { files: ['.env', 'README.md'] });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('.env');
    });
  });

  describe('audit trail', () => {
    beforeEach(() => {
      engine.compilePolicy('standard policy');
    });

    it('should record enforcement decisions', () => {
      engine.enforce('rm -rf /');
      engine.enforce('ls -la');
      const trail = engine.getAuditTrail();
      expect(trail).toHaveLength(2);
      expect(trail[0].result).toBe('blocked');
      expect(trail[1].result).toBe('allowed');
    });

    it('should chain hashes across entries', () => {
      engine.enforce('rm -rf /');
      engine.enforce('ls -la');
      engine.enforce('cat file.txt');
      const trail = engine.getAuditTrail();
      expect(trail).toHaveLength(3);

      const hashes = trail.map((e) => e.hash);
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(3);

      for (const h of hashes) {
        expect(h).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });
});
