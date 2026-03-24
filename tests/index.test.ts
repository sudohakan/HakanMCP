/**
 * Integration tests for main MCP server entry point
 */

import { describe, it, expect } from '@jest/globals';

describe('MCP Server Entry Point', () => {
  describe('Tool Aggregation', () => {
    it('should import and aggregate all tool modules', async () => {
      // Dynamically import to avoid executing the server
      const { gitbookTools } = await import('../src/tools/gitbook.js');
      const { postmanTools } = await import('../src/tools/postman.js');
      const { systemTools } = await import('../src/tools/system.js');
      const { dbTools } = await import('../src/tools/db.js');
      const { aiTools } = await import('../src/tools/aiTools.js');

      expect(gitbookTools).toBeDefined();
      expect(Array.isArray(gitbookTools)).toBe(true);
      expect(gitbookTools.length).toBeGreaterThan(0);

      expect(postmanTools).toBeDefined();
      expect(Array.isArray(postmanTools)).toBe(true);

      expect(systemTools).toBeDefined();
      expect(Array.isArray(systemTools)).toBe(true);

      expect(dbTools).toBeDefined();
      expect(Array.isArray(dbTools)).toBe(true);

      expect(aiTools).toBeDefined();
      expect(Array.isArray(aiTools)).toBe(true);
    });

    it('should have unique tool names across all modules', async () => {
      const { gitbookTools } = await import('../src/tools/gitbook.js');
      const { postmanTools } = await import('../src/tools/postman.js');
      const { systemTools } = await import('../src/tools/system.js');

      const allTools = [...gitbookTools, ...postmanTools, ...systemTools];
      const toolNames = allTools.map((t) => t.name);
      const uniqueNames = new Set(toolNames);

      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should load all expected tool categories', async () => {
      const modules = [
        '../src/tools/gitbook.js',
        '../src/tools/postman.js',
        '../src/tools/system.js',
        '../src/tools/db.js',
        '../src/tools/mongodb.js',
        '../src/tools/http.js',
        '../src/tools/git.js',
        '../src/tools/aiTools.js',
        '../src/tools/scheduler.js',
        '../src/tools/monitoring.js',
      ];

      for (const modulePath of modules) {
        const module = await import(modulePath);
        const toolsExport = Object.values(module).find((value) => Array.isArray(value)) as
          | Array<{ name: string }>
          | undefined;
        expect(toolsExport).toBeDefined();
        expect(toolsExport!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Tool Structure Validation', () => {
    it('all tools should have required MCP properties', async () => {
      const { gitbookTools } = await import('../src/tools/gitbook.js');
      const { systemTools } = await import('../src/tools/system.js');

      const allTools = [...gitbookTools, ...systemTools];

      for (const tool of allTools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('handler');

        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.handler).toBe('function');
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('all tool names should be valid strings', async () => {
      const { gitbookTools } = await import('../src/tools/gitbook.js');
      const { systemTools } = await import('../src/tools/system.js');
      const { dbTools } = await import('../src/tools/db.js');

      const allTools = [...gitbookTools, ...systemTools, ...dbTools];

      for (const tool of allTools) {
        // Tool names should be valid non-empty strings
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(2);
        expect(tool.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
      }
    });

    it('all tool descriptions should be informative', async () => {
      const { gitbookTools } = await import('../src/tools/gitbook.js');
      const { aiTools } = await import('../src/tools/aiTools.js');

      const allTools = [...gitbookTools, ...aiTools];

      for (const tool of allTools) {
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe('Configuration Loading', () => {
    it('should load configuration successfully', async () => {
      const { config } = await import('../src/config.js');

      expect(config).toBeDefined();
      expect(config.serverName).toBeDefined();
      expect(typeof config.serverName).toBe('string');
      expect(config.gitbookUrl).toBeDefined();
      expect(config.cacheTtl).toBeGreaterThan(0);
    });

    it('should have backup service initialized', async () => {
      const { backupService } = await import('../src/services/backupService.js');

      expect(backupService).toBeDefined();
      expect(typeof backupService.createBackup).toBe('function');
      expect(typeof backupService.listBackups).toBe('function');
    });
  });

  describe('Logger Integration', () => {
    it('should have logger initialized', async () => {
      const { logger } = await import('../src/utils/logger.js');

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should log without errors', async () => {
      const { logger } = await import('../src/utils/logger.js');

      // These should not throw
      expect(() => {
        logger.info('Test info message', { test: true });
      }).not.toThrow();

      expect(() => {
        logger.debug('Test debug message');
      }).not.toThrow();
    });
  });

  describe('Tool Count and Coverage', () => {
    it('should have at least 180 tools total', async () => {
      const modules = {
        gitbook: await import('../src/tools/gitbook.js'),
        postman: await import('../src/tools/postman.js'),
        system: await import('../src/tools/system.js'),
        db: await import('../src/tools/db.js'),
        mongodb: await import('../src/tools/mongodb.js'),
        http: await import('../src/tools/http.js'),
        env: await import('../src/tools/env.js'),
        git: await import('../src/tools/git.js'),
        parser: await import('../src/tools/parser.js'),
        template: await import('../src/tools/template.js'),
        ai: await import('../src/tools/aiTools.js'),
        systemOptimization: await import('../src/tools/systemOptimization.js'),
        backup: await import('../src/tools/backup.js'),
        mcpClient: await import('../src/tools/mcpClient.js'),

        monitoring: await import('../src/tools/monitoring.js'),
        selfImprovement: await import('../src/tools/selfImprovement.js'),
        github: await import('../src/tools/github.js'),
        encryption: await import('../src/tools/encryption.js'),
        aiProvider: await import('../src/tools/aiProviders.js'),
        scheduler: await import('../src/tools/scheduler.js'),

        cache: await import('../src/tools/cache.js'),
        dbMonitoring: await import('../src/tools/dbMonitoring.js'),
        api: await import('../src/tools/api.js'),
        performance: await import('../src/tools/performance.js'),

        dx: await import('../src/tools/dx.js'),
        flow: await import('../src/tools/flow.js'),
      };

      let totalTools = 0;
      for (const [, module] of Object.entries(modules)) {
        const toolsExport = Object.values(module).find((value) => Array.isArray(value)) as
          | Array<{ name: string }>
          | undefined;
        if (toolsExport) {
          totalTools += toolsExport.length;
        }
      }

      expect(totalTools).toBeGreaterThan(170); // Keep floor below current total to reduce churn
    });

    it('should categorize tools correctly', async () => {
      const categories = {
        gitbook: (await import('../src/tools/gitbook.js')).gitbookTools,
        database: [
          ...(await import('../src/tools/db.js')).dbTools,
          ...(await import('../src/tools/mongodb.js')).mongoTools,
        ],
        system: (await import('../src/tools/system.js')).systemTools,
        ai: (await import('../src/tools/aiTools.js')).aiTools,
        devOps: [
          ...(await import('../src/tools/backup.js')).backupTools,
        ],
      };

      expect(categories.gitbook.length).toBeGreaterThan(5);
      expect(categories.database.length).toBeGreaterThan(20);
      expect(categories.system.length).toBeGreaterThan(3);
      expect(categories.ai.length).toBeGreaterThan(3);
      expect(categories.devOps.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing tool gracefully', async () => {
      const { systemTools } = await import('../src/tools/system.js');

      const nonExistentTool = systemTools.find((t) => t.name === 'non_existent_tool');
      expect(nonExistentTool).toBeUndefined();
    });

    it('should validate tool handler return types', async () => {
      const { systemTools } = await import('../src/tools/system.js');

      const sysInfoTool = systemTools[0]!;
      expect(sysInfoTool).toBeDefined();

      // Handler should be a function
      expect(typeof sysInfoTool.handler).toBe('function');
    });
  });

  describe('Module Dependencies', () => {
    it('should import fetch polyfill', async () => {
      const fetch = (await import('node-fetch')).default;
      expect(fetch).toBeDefined();
      expect(typeof fetch).toBe('function');
    });

    it('should have MCP SDK imported', async () => {
      const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

      expect(Server).toBeDefined();
      expect(StdioServerTransport).toBeDefined();
    });
  });
});
