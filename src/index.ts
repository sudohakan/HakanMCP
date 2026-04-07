process.setMaxListeners(20);

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { ToolRegistry, FEATURE_TOOL_METADATA } from './toolRegistry.js';
import { isPackageAvailable } from './dependencyResolver.js';
import { config } from './config.js';
import { PROJECT_ROOT } from './utils/projectRoot.js';
import { logger } from './utils/logger.js';

const registry = new ToolRegistry({
  timeoutSec: config.system?.commandTimeout ?? 60,
  logger,
});

// Tool modules — loaded lazily via dynamic import after MCP handshake
const TOOL_MODULES = [
  { path: './tools/gitbook.js', export: 'gitbookTools' },
  { path: './tools/postman.js', export: 'postmanTools' },
  { path: './tools/system.js', export: 'systemTools' },
  { path: './tools/http.js', export: 'httpTools' },
  { path: './tools/env.js', export: 'envTools' },
  { path: './tools/parser.js', export: 'parserTools' },
  { path: './tools/template.js', export: 'templateTools' },
  { path: './tools/aiTools.js', export: 'aiTools' },
  { path: './tools/systemOptimization.js', export: 'systemOptimizationTools' },
  { path: './tools/backup.js', export: 'backupTools' },
  { path: './tools/mcpClient.js', export: 'mcpClientTools' },
  { path: './tools/monitoring.js', export: 'monitoringTools' },
  { path: './tools/selfImprovement.js', export: 'selfImprovementTools' },
  { path: './tools/encryption.js', export: 'encryptionTools' },
  { path: './tools/aiProviders.js', export: 'aiProviderTools' },
  { path: './tools/cache.js', export: 'cacheTools' },
  { path: './tools/dbMonitoring.js', export: 'dbMonitoringTools' },
  { path: './tools/api.js', export: 'apiTools' },
  { path: './tools/performance.js', export: 'performanceTools' },
  { path: './tools/dx.js', export: 'dxTools' },
  { path: './tools/flow.js', export: 'flowTools' },
  { path: './tools/swarm.js', export: 'swarmTools' },
  { path: './tools/consensus.js', export: 'consensusTools' },
  { path: './tools/ruvector.js', export: 'ruvectorTools' },
  { path: './tools/moeRouter.js', export: 'moeRouterTools' },
  { path: './tools/aiDefence.js', export: 'aiDefenceTools' },
  { path: './tools/guidance.js', export: 'guidanceTools' },
  { path: './tools/disk.js', export: 'diskTools' },
  { path: './tools/sysint.js', export: 'sysintTools' },
] as const;

async function loadCoreTools(): Promise<void> {
  const loadPromises = TOOL_MODULES.map(async (mod) => {
    try {
      const module = await import(mod.path);
      const tools = module[mod.export] as Array<import('./types/index.js').ToolDefinition>;
      for (const tool of tools) {
        registry.registerTool(tool as unknown as import('./types/index.js').ToolDefinition, null);
      }
    } catch (err) {
      logger.warn(`Failed to load tool module: ${mod.path}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  await Promise.all(loadPromises);
}

const featureModules: Array<{
  prefix: string;
  check: () => boolean;
  loader: () => Promise<Record<string, unknown>>;
  exportName: string;
}> = [
  {
    prefix: 'db',
    check: () =>
      isPackageAvailable('pg') ||
      isPackageAvailable('mysql2') ||
      isPackageAvailable('mssql') ||
      isPackageAvailable('sqlite3'),
    loader: () => import('./tools/db.js'),
    exportName: 'dbTools',
  },
  {
    prefix: 'mongo',
    check: () => isPackageAvailable('mongodb'),
    loader: () => import('./tools/mongodb.js'),
    exportName: 'mongoTools',
  },
  {
    prefix: 'nirsoft',
    check: () => {
      try {
        const { isSupported } = require('./services/nirsoft/platform.js');
        return isSupported();
      } catch { return false; }
    },
    loader: () => import('./tools/nirsoft.js'),
    exportName: 'nirsoftTools',
  },
];

async function registerFeatureTools(): Promise<void> {
  for (const fm of featureModules) {
    if (fm.check()) {
      try {
        const mod = await fm.loader();
        const tools = mod[fm.exportName] as Array<import('./types/index.js').ToolDefinition>;
        for (const tool of tools) {
          registry.registerTool(tool, fm.prefix);
        }
        logger.info(`Feature tools loaded eagerly: ${fm.prefix}`, { count: tools.length });
      } catch (err) {
        logger.warn(`Failed to eagerly load ${fm.prefix} tools, using placeholders`, {
          error: err instanceof Error ? err.message : String(err),
        });
        registerPlaceholdersForPrefix(fm.prefix);
      }
    } else {
      registerPlaceholdersForPrefix(fm.prefix);
      logger.info(`Feature tools registered as placeholders: ${fm.prefix}`, {
        reason: 'native dependencies not installed',
      });
    }
  }
}

function registerPlaceholdersForPrefix(prefix: string): void {
  const metadata = FEATURE_TOOL_METADATA[prefix];
  if (!metadata) return;
  for (const meta of metadata) {
    registry.registerPlaceholder(meta.name, meta.description, meta.inputSchema, prefix);
  }
}

function buildAgenticToolsRef(): Array<{
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}> {
  const tools = registry.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as { type: string; properties: Record<string, unknown>; required?: string[] },
    handler: async (args: unknown) => {
      const handler = await registry.getHandler(t.name);
      if (!handler) {
        return {
          content: [{ type: 'text', text: `Tool ${t.name} is not available` }],
          isError: true,
        };
      }
      return handler(args) as Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
    },
  }));
}

const server = new Server(
  { name: 'hakan-mcp', version: '2.2.0' },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: registry.listTools() };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = await registry.getHandler(name);

  if (!handler) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    } as unknown as Record<string, unknown>;
  }

  try {
    return await handler(args) as unknown as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Tool execution error', { tool: name, error: message });
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    } as unknown as Record<string, unknown>;
  }
});

function startGuardianLoop(role: string) {
  if (role !== 'main') return;

  const interval = config.monitoring?.checkInterval ?? 300_000;
  setInterval(async () => {
    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

      const maxHeap = (config.monitoring as Record<string, unknown>)?.maxHeapMB as number ?? 512;
      if (heapUsedMB > maxHeap) {
        logger.warn('High heap usage detected', {
          heapUsedMB: heapUsedMB.toFixed(1),
          threshold: maxHeap,
        });
        if (global.gc) {
          global.gc();
          logger.info('Manual GC triggered');
        }
      }
    } catch (err) {
      logger.error('Guardian loop error', { error: err instanceof Error ? err.message : String(err) });
    }
  }, interval);
}

async function syncOllamaModels() {
  try {
    const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name).sort();

      if (models.length > 0) {
        import('./config.js').then(({ config: cfg, updateConfig }) => {
          const current = cfg.availableModels || [];
          const modelsChanged =
            current.length !== models.length || !current.every((m, i) => m === models[i]);

          const updates: Partial<typeof cfg> = {};
          if (modelsChanged) {
            updates.availableModels = models;
          }

          const currentDefault = cfg.ollamaModel;
          const currentDefaultExists = models.some((m) => m === currentDefault || m.startsWith(`${currentDefault}:`));
          if (!currentDefaultExists) {
            const preferred = models.find((m) => m.includes('Gemma3-Instruct-Abliterated'));
            if (preferred) {
              updates.ollamaModel = preferred;
              logger.info('Auto-selected Ollama default model', { previous: currentDefault, selected: preferred });
            } else {
              logger.warn('Preferred Ollama model not found, keeping current default', { current: currentDefault, available: models });
            }
          }

          if (Object.keys(updates).length > 0) {
            updateConfig(updates);
            logger.info('Synced Ollama models to config.yaml', { count: models.length, default: updates.ollamaModel ?? currentDefault });
          }
        }).catch((err) => {
          logger.warn('Failed to apply Ollama model sync', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    }
  } catch (e) {
    logger.info('Could not sync Ollama models', { reason: 'Ollama may be unavailable', error: String(e) });
  }
}

async function main() {
  process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection', { reason });
    process.exit(1);
  });

  // Phase 1: Load all tools in parallel
  const loadStart = Date.now();
  await Promise.all([loadCoreTools(), registerFeatureTools()]);
  const { setAgenticToolsRef } = await import('./tools/aiTools.js');
  setAgenticToolsRef(buildAgenticToolsRef());
  logger.info(`ToolRegistry initialized: ${registry.getToolCount()} tools in ${Date.now() - loadStart}ms`);

  // Phase 2: Connect MCP transport (tools ready before first request)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Hakan Personal MCP Server connected');

  // Phase 3: Defer heavy services
  let stopToolHealthCheckRef: (() => void) | null = null;
  setImmediate(async () => {
    try {
    const { logActiveCooldowns } = await import('./services/aiProviderCooldown.js');
    const { conversationManager } = await import('./services/conversationHistory.js');
    const { backupService } = await import('./services/backupService.js');
    const { ConsciousnessService } = await import('./services/consciousnessService.js');
    const { scheduleDailyHealthCheck } = await import('./services/toolHealthCheck.js');

    logActiveCooldowns();
    conversationManager.loadFromDisk();

    const role = (process.env.INSTANCE_ROLE || 'main').toLowerCase();

    if (role === 'main') {
      logger.info('Auto-reload mechanism active', { version: 'v3' });
      if (config.aiProviders?.localModels && process.env.DISABLE_LOCAL_MODELS !== '1') {
        syncOllamaModels();
      }
    } else {
      logger.info('Skipping Ollama model sync', { reason: 'non-main instance role', role });
    }

    try {
      backupService.start();
      const backupStats = backupService.getStats();
      if (backupStats.enabled) {
        logger.info('Automatic backup service started', {
          intervalHours: backupStats.intervalHours,
          retentionHours: backupStats.retentionHours,
          backupDir: backupStats.backupDir,
        });
      } else {
        logger.info('Automatic backup service disabled via config');
      }
    } catch (error) {
      logger.error('Failed to start backup service', error);
    }

    startGuardianLoop(role);

    const healthCheckTools = registry.listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      handler: async (args: unknown) => {
        const h = await registry.getHandler(t.name);
        if (!h) return { content: [{ type: 'text' as const, text: 'Tool not available' }], isError: true };
        return h(args);
      },
    }));
    stopToolHealthCheckRef = scheduleDailyHealthCheck(healthCheckTools, PROJECT_ROOT);
    logger.info('Tool health check scheduler active', { frequency: 'daily' });

    if (config.consciousness?.enabled !== false) {
      const maxEntries = config.consciousness?.maxJournalEntries ?? 500;
      const consciousnessService = new ConsciousnessService(PROJECT_ROOT, maxEntries);
      consciousnessService.ensureDir();
      logger.info('Consciousness service initialized (event-driven mode)');
    }

    logger.info('Phase 3 initialization complete');
    } catch (err) {
      logger.error('Phase 3 initialization failed', { error: err instanceof Error ? err.message : String(err) });
    }
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown signal received, shutting down', { signal });
    try {
      const { conversationManager } = await import('./services/conversationHistory.js');
      const { backupService } = await import('./services/backupService.js');
      conversationManager.shutdown();
      backupService.stop();
      if (stopToolHealthCheckRef) stopToolHealthCheckRef();

      try {
        const { stopMongoCleanup } = await import('./tools/mongodb.js');
        stopMongoCleanup();
      } catch (err) {
        logger.error('MongoDB cleanup failed during shutdown', err);
      }

      const { processRegistry } = await import('./utils/processRegistry.js');
      await processRegistry.killAll(3000);

      try {
        const { dbPoolManager } = await import('./utils/dbPoolManager.js');
        await dbPoolManager.closeAll();
      } catch (err) {
        logger.error('DB pool cleanup failed during shutdown', err);
      }
    } catch (err) {
      logger.error('Cleanup error during shutdown', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal error during startup', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
