process.setMaxListeners(20);

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

import { gitbookTools } from './tools/gitbook.js';
import { postmanTools } from './tools/postman.js';
import { systemTools } from './tools/system.js';
import { httpTools } from './tools/http.js';
import { envTools } from './tools/env.js';
import { parserTools } from './tools/parser.js';
import { templateTools } from './tools/template.js';
import { aiTools, setAgenticToolsRef } from './tools/aiTools.js';
import { systemOptimizationTools } from './tools/systemOptimization.js';
import { backupTools } from './tools/backup.js';
import { mcpClientTools } from './tools/mcpClient.js';

import { monitoringTools } from './tools/monitoring.js';
import { selfImprovementTools } from './tools/selfImprovement.js';
import { encryptionTools } from './tools/encryption.js';
import { aiProviderTools } from './tools/aiProviders.js';
import { cacheTools } from './tools/cache.js';
import { dbMonitoringTools } from './tools/dbMonitoring.js';
import { apiTools } from './tools/api.js';
import { performanceTools } from './tools/performance.js';

import { dxTools } from './tools/dx.js';
import { flowTools } from './tools/flow.js';
import { swarmTools } from './tools/swarm.js';
import { consensusTools } from './tools/consensus.js';
import { ruvectorTools } from './tools/ruvector.js';
import { moeRouterTools } from './tools/moeRouter.js';
import { aiDefenceTools } from './tools/aiDefence.js';
import { guidanceTools } from './tools/guidance.js';
import { diskTools } from './tools/disk.js';

import { ToolRegistry, FEATURE_TOOL_METADATA } from './toolRegistry.js';
import { isPackageAvailable } from './dependencyResolver.js';

import { config } from './config.js';
import { PROJECT_ROOT } from './utils/projectRoot.js';
import { backupService } from './services/backupService.js';
import { conversationManager } from './services/conversationHistory.js';
import { logger } from './utils/logger.js';
import { logActiveCooldowns } from './services/aiProviderCooldown.js';
import { processRegistry } from './utils/processRegistry.js';
import { ConsciousnessService } from './services/consciousnessService.js';
import { scheduleDailyHealthCheck } from './services/toolHealthCheck.js';

const registry = new ToolRegistry({
  timeoutSec: config.system?.commandTimeout ?? 60,
  logger,
});

const coreToolArrays = [
  gitbookTools, postmanTools, systemTools, httpTools, envTools,
  parserTools, templateTools, aiTools, systemOptimizationTools,
  backupTools, mcpClientTools, monitoringTools, selfImprovementTools,
  encryptionTools, aiProviderTools,
  cacheTools, dbMonitoringTools, apiTools, performanceTools,
  dxTools, flowTools, swarmTools, consensusTools,
  ruvectorTools, moeRouterTools, aiDefenceTools, guidanceTools,
  diskTools,
];

for (const toolArray of coreToolArrays) {
  for (const tool of toolArray) {
    registry.registerTool(tool as unknown as import('./types/index.js').ToolDefinition, null);
  }
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
          content: [{ type: 'text', text: `Tool not available: ${t.name}` }],
          isError: true,
        };
      }
      return handler(args) as Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
    },
  }));
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) || ''
  );
}

async function runGuardianPeerCheck(role: string): Promise<void> {
  const peerPath = config.monitoring?.peerInstance;
  if (!peerPath) return;

  const monitorTool = monitoringTools.find((t) => t.name === 'monitor');

  if (!monitorTool) {
    logger.warn('Guardian loop skipped: monitor tool unavailable');
    return;
  }

  try {
    const health = await monitorTool.handler({ action: 'healthCheck', instancePath: peerPath, issueType: 'file' });
    const healthText = health.content?.[0]?.text || '';
    const unhealthy = healthText.includes('❌');

    if (!unhealthy) return;

    logger.warn('Guardian detected peer drift', {
      role,
      peerPath,
      cwd: PROJECT_ROOT,
    });
    const heal = await monitorTool.handler({
      action: 'autoHeal',
      brokenInstance: peerPath,
      healthyInstance: PROJECT_ROOT,
      issueType: 'file',
    });
    const healText = heal.content?.[0]?.text || '';
    logger.info('Guardian auto-heal result', { role, result: firstNonEmptyLine(healText) });
  } catch (error: unknown) {
    logger.warn('Guardian check failed', { role, error: error instanceof Error ? error.message : String(error) });
  }
}

function startGuardianLoop(role: string): void {
  if (config.monitoring?.enabled === false) {
    logger.info('Guardian loop disabled', { reason: 'monitoring disabled' });
    return;
  }

  const peerPath = config.monitoring?.peerInstance;
  if (!peerPath) {
    logger.info('Guardian loop skipped', { reason: 'peer path not configured' });
    return;
  }

  if (
    process.env.GUARDIAN_LOOP_ENABLED !== undefined &&
    !isTruthy(process.env.GUARDIAN_LOOP_ENABLED)
  ) {
    logger.info('Guardian loop disabled', { reason: 'GUARDIAN_LOOP_ENABLED env var' });
    return;
  }

  const envInterval = Number.parseInt(process.env.GUARDIAN_INTERVAL_SEC || '', 10);
  const configuredIntervalSec =
    Number.isFinite(envInterval) && envInterval > 0
      ? envInterval
      : config.monitoring?.checkInterval || 300;
  const intervalSec = Math.max(30, configuredIntervalSec);
  logger.info('Guardian loop enabled', { role, target: peerPath, interval: intervalSec, mode: 'file' });

  setTimeout(() => {
    void runGuardianPeerCheck(role);
  }, 8000);

  setInterval(() => {
    void runGuardianPeerCheck(role);
  }, intervalSec * 1000);
}

const server = new Server(
  { name: config.serverName, version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: registry.listTools(),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params as {
    name: string;
    arguments?: Record<string, unknown>;
  };

  const handler = await registry.getHandler(name);
  if (!handler) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = (await handler(args)) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    return result;
  } catch (error: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function syncOllamaModels() {
  try {
    const url = `${config.ollamaUrl}/api/tags`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name?: string }> };
      const models = data.models?.map((m) => m.name).filter((n): n is string => n != null) ?? [];

      if (models.length > 0) {
        import('./config.js').then(({ config, updateConfig }) => {
          const current = config.availableModels || [];
          const modelsChanged =
            current.length !== models.length || !current.every((m, i) => m === models[i]);

          const updates: Partial<typeof config> = {};
          if (modelsChanged) {
            updates.availableModels = models;
          }

          const currentDefault = config.ollamaModel;
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

  await registerFeatureTools();

  setAgenticToolsRef(buildAgenticToolsRef());

  logger.info(`ToolRegistry initialized: ${registry.getToolCount()} tools registered`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Hakan Personal MCP Server started');

  // Defer heavy services — run after MCP handshake so connection doesn't timeout
  setImmediate(() => {
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
  });

  let stopToolHealthCheckRef: (() => void) | null = null;
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown signal received, shutting down', { signal });
    try {
      conversationManager.shutdown();
      backupService.stop();
      if (stopToolHealthCheckRef) stopToolHealthCheckRef();

      try {
        const { stopMongoCleanup } = await import('./tools/mongodb.js');
        stopMongoCleanup();
      } catch (err) {
        logger.error('MongoDB cleanup failed during shutdown', err);
      }

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

  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
}

main().catch(err => logger.error('Fatal startup error', err));
