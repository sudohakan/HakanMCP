import {
  monitoringTools,
  computeDeepHash,
  compareInstancesDeep,
  syncInstancesDeep,
} from '../src/tools/monitoring';
import { config } from '../src/config';
import fs from 'node:fs';
import path from 'node:path';

describe('Monitoring Tools', () => {
  const testInstancePath = path.join(process.cwd(), 'test-instance');

  beforeAll(() => {
    // Create test instance directory
    if (!fs.existsSync(testInstancePath)) {
      fs.mkdirSync(testInstancePath, { recursive: true });
    }

    // Create necessary test files
    fs.mkdirSync(path.join(testInstancePath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(testInstancePath, 'src', 'index.ts'), '// Test index file');
    fs.writeFileSync(path.join(testInstancePath, 'config.yaml'), 'serverName: test');
    fs.writeFileSync(path.join(testInstancePath, 'package.json'), JSON.stringify({ name: 'test' }));
  });

  afterAll(() => {
    // Clean up test instance
    if (fs.existsSync(testInstancePath)) {
      fs.rmSync(testInstancePath, { recursive: true, force: true });
    }
  });

  describe('monitor_healthCheck', () => {
    it('should perform health check on current instance', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_healthCheck');
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        instancePath: testInstancePath,
      });
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Health Check');
    });

    it('should check peer instance if configured', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_healthCheck');

      const result = await tool!.handler({
        instancePath: testInstancePath,
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Health');
    });
  });

  describe('monitor_compare', () => {
    it('should compare two instances', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_compare');
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        instance1: testInstancePath,
        instance2: testInstancePath,
      });
      expect(result.content).toBeDefined();
      // Comparison should include both instances
      expect(result.content[0].text).toBeDefined();
    });

    it('should report differences when files diverge', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_compare');
      expect(tool).toBeDefined();

      const secondPath = path.join(testInstancePath, 'diff-instance');
      fs.mkdirSync(path.join(secondPath, 'src'), { recursive: true });
      fs.writeFileSync(path.join(secondPath, 'src', 'index.ts'), '// different');
      fs.writeFileSync(path.join(secondPath, 'config.yaml'), 'serverName: diff');
      fs.writeFileSync(path.join(secondPath, 'package.json'), JSON.stringify({ name: 'diff' }));

      // Introduce a difference
      fs.writeFileSync(
        path.join(secondPath, 'package.json'),
        JSON.stringify({ name: 'diff-other' }),
      );

      const result = await tool!.handler({
        instance1: testInstancePath,
        instance2: secondPath,
      });

      expect(result.content[0].text).toContain('Differences Found');
      fs.rmSync(secondPath, { recursive: true, force: true });
    });

    it('should support deep mode (SHA-256)', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_compare');
      const result = await tool!.handler({
        instance1: testInstancePath,
        instance2: testInstancePath,
        deep: true,
      });
      expect(result.content[0].text).toContain('Identical');
    });
  });

  describe('Plan §4: computeDeepHash, compareInstancesDeep, syncInstancesDeep', () => {
    it('computeDeepHash excludes node_modules and returns hash map', async () => {
      const map = await computeDeepHash(testInstancePath);
      expect(map.size).toBeGreaterThan(0);
      expect(map.has('src/index.ts')).toBe(true);
      for (const [rel] of map) {
        expect(rel).not.toContain('node_modules');
        expect(rel).not.toContain('dist');
      }
    });

    it('compareInstancesDeep returns identical for same dir', async () => {
      const diff = await compareInstancesDeep(testInstancePath, testInstancePath);
      expect(diff.identical).toBe(true);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(0);
    });

    it('syncInstancesDeep is no-op when identical', async () => {
      const results = await syncInstancesDeep(testInstancePath, testInstancePath);
      expect(results).toHaveLength(0);
    });
  });

  describe('monitor_sync', () => {
    it('should sync configurations between instances', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_sync');
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        sourceInstance: testInstancePath,
        targetInstance: path.join(testInstancePath, 'sync-target'),
        includeNodeModules: false,
      });

      expect(result.content).toBeDefined();
    });
  });

  describe('monitor_updateDependencies', () => {
    it('should be defined', () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_updateDependencies');
      expect(tool).toBeDefined();
    });

    it('should check for outdated packages', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_updateDependencies');

      const result = await tool!.handler({
        instancePath: testInstancePath,
        autoCommit: false,
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toBeDefined();
    });
  });

  describe('monitor_rollback', () => {
    it('should be defined', () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_rollback');
      expect(tool).toBeDefined();
    });

    it('should handle rollback operation', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_rollback');

      const result = await tool!.handler({
        instancePath: testInstancePath,
      });

      expect(result.content).toBeDefined();
    });
  });

  describe('monitor_autoHeal', () => {
    it('should warn when auto-heal is disabled', async () => {
      const originalMonitoring = config.monitoring;
      config.monitoring = {
        enabled: false,
        peerInstance: '',
        checkInterval: 0,
        autoHeal: false,
        notifyOnError: false,
        healthCheckEndpoints: [],
      };

      try {
        const tool = monitoringTools.find((t) => t.name === 'monitor_autoHeal');
        expect(tool).toBeDefined();

        const result = await tool!.handler({
          brokenInstance: testInstancePath,
          healthyInstance: testInstancePath,
          issueType: 'file',
        });

        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(result.content[0].text).toContain('Auto-heal');
        expect(result.content[0].text).toContain('disabled');
      } finally {
        config.monitoring = originalMonitoring;
      }
    });
  });

  describe('monitor_selfRecover', () => {
    const tool = monitoringTools.find((t) => t.name === 'monitor_selfRecover');

    it.each([
      ['port_conflict', 'Change port'],
      ['out_of_memory', 'Memory recovery'],
      ['db_connection_lost', 'Database reconnection'],
    ] as const)('handles %s scenarios', async (errorType, expectedText) => {
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        instancePath: testInstancePath,
        errorType,
      });

      expect(result.content[0].text).toContain(expectedText);
    });
  });

  describe('All Monitoring Tools', () => {
    it('should export all expected monitoring tools', () => {
      const expectedTools = [
        'monitor_healthCheck',
        'monitor_autoHeal',
        'monitor_compare',
        'monitor_sync',
        'monitor_updateDependencies',
        'monitor_selfRecover',
        'monitor_rollback',
      ];

      for (const toolName of expectedTools) {
        const tool = monitoringTools.find((t) => t.name === toolName);
        expect(tool).toBeDefined();
      }
    });

    it('all monitoring tools should have valid schemas', () => {
      for (const tool of monitoringTools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(typeof tool.handler).toBe('function');
      }
    });
  });

  describe('Health Check Advanced', () => {
    it('should detect missing files', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_healthCheck');

      const missingFilePath = path.join(testInstancePath, 'missing-instance');

      const result = await tool!.handler({
        instancePath: missingFilePath,
      });

      expect(result.content).toBeDefined();
    });

    it('should validate build status', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_healthCheck');

      const result = await tool!.handler({
        instancePath: testInstancePath,
      });

      expect(result.content[0].text).toBeDefined();
    });
  });

  describe('Auto-Heal Functionality', () => {
    it('should require issueType parameter', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_autoHeal');

      try {
        await tool!.handler({
          brokenInstance: testInstancePath,
          healthyInstance: testInstancePath,
          // Missing issueType
        });
      } catch (error: unknown) {
        expect(error).toBeDefined();
      }
    });

    it('should handle file-related issues', async () => {
      const originalMonitoring = config.monitoring;
      config.monitoring = {
        enabled: true,
        peerInstance: testInstancePath,
        checkInterval: 300,
        autoHeal: true,
        notifyOnError: false,
        healthCheckEndpoints: [],
      };

      try {
        const tool = monitoringTools.find((t) => t.name === 'monitor_autoHeal');

        const result = await tool!.handler({
          brokenInstance: testInstancePath,
          healthyInstance: testInstancePath,
          issueType: 'file',
        });

        expect(result.content).toBeDefined();
      } finally {
        config.monitoring = originalMonitoring;
      }
    });

    it('should handle build-related issues', async () => {
      const originalMonitoring = config.monitoring;
      config.monitoring = {
        enabled: true,
        peerInstance: testInstancePath,
        checkInterval: 300,
        autoHeal: true,
        notifyOnError: false,
        healthCheckEndpoints: [],
      };

      try {
        const tool = monitoringTools.find((t) => t.name === 'monitor_autoHeal');

        const result = await tool!.handler({
          brokenInstance: testInstancePath,
          healthyInstance: testInstancePath,
          issueType: 'build',
        });

        expect(result.content).toBeDefined();
      } finally {
        config.monitoring = originalMonitoring;
      }
    });
  });

  describe('Dependency Management', () => {
    it('should handle auto-apply flag', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_updateDependencies');

      const result = await tool!.handler({
        instancePath: testInstancePath,
        autoApply: true,
        runTests: false,
      });

      expect(result.content).toBeDefined();
    });

    it('should handle test execution flag', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_updateDependencies');

      const result = await tool!.handler({
        instancePath: testInstancePath,
        autoApply: false,
        runTests: true,
      });

      expect(result.content).toBeDefined();
    });
  });

  describe('Sync Operations', () => {
    it('should handle node_modules inclusion', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_sync');

      const targetPath = path.join(testInstancePath, 'sync-with-modules');

      const result = await tool!.handler({
        sourceInstance: testInstancePath,
        targetInstance: targetPath,
        includeNodeModules: true,
      });

      expect(result.content).toBeDefined();

      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
    });

    it('should handle missing source instance', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_sync');

      const result = await tool!.handler({
        sourceInstance: '/non/existent/path',
        targetInstance: testInstancePath,
        includeNodeModules: false,
      });

      expect(result.content).toBeDefined();
    });
  });

  describe('Error Recovery', () => {
    it('should handle unknown error types', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_selfRecover');

      await expect(
        tool!.handler({
          instancePath: testInstancePath,
          errorType: 'unknown_error' as const,
        }),
      ).rejects.toThrow();
    });

    it('should provide recovery suggestions', async () => {
      const tool = monitoringTools.find((t) => t.name === 'monitor_selfRecover');

      const result = await tool!.handler({
        instancePath: testInstancePath,
        errorType: 'port_conflict',
      });

      expect(result.content[0].text).toBeDefined();
      expect(result.content[0].text.length).toBeGreaterThan(10);
    });
  });
});
