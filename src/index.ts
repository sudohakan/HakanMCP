// ---- Hakan Personal MCP - GitBook + Postman Tools (Node 20, STDIO) ----
// Raise max listeners to accommodate tool module beforeExit handlers
process.setMaxListeners(20);

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

// Import Core Tools (no native dependencies — always available)
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
import { githubTools } from './tools/github.js';
import { encryptionTools } from './tools/encryption.js';
import { aiProviderTools } from './tools/aiProviders.js';
import { schedulerTools } from './tools/scheduler.js';

import { cacheTools } from './tools/cache.js';
import { dbMonitoringTools } from './tools/dbMonitoring.js';
import { apiTools } from './tools/api.js';
import { performanceTools } from './tools/performance.js';

import { dxTools } from './tools/dx.js';
import { flowTools } from './tools/flow.js';
import { knowledgeGraphTools } from './tools/knowledgeGraph.js';
import { swarmTools } from './tools/swarm.js';
import { consensusTools } from './tools/consensus.js';
import { ruvectorTools } from './tools/ruvector.js';
import { moeRouterTools } from './tools/moeRouter.js';
import { aiDefenceTools } from './tools/aiDefence.js';
import { guidanceTools } from './tools/guidance.js';

// Lazy loading infrastructure
import { ToolRegistry, FEATURE_TOOL_MAP, FEATURE_TOOL_METADATA } from './toolRegistry.js';
import { isPackageAvailable } from './dependencyResolver.js';

// Service & utility imports (no native deps)
import { config } from './config.js';
import { PROJECT_ROOT } from './utils/projectRoot.js';
import { backupService } from './services/backupService.js';
import { conversationManager } from './services/conversationHistory.js';
import { logger } from './utils/logger.js';
import { logActiveCooldowns } from './services/aiProviderCooldown.js';
import { processRegistry } from './utils/processRegistry.js';
import { schedulerManager } from './tools/scheduler.js';
// NOTE: dbPoolManager and stopMongoCleanup are imported dynamically in shutdown
// because they depend on native modules (pg, mysql2, mssql, mongodb)
import { ConsciousnessService } from './services/consciousnessService.js';
import { scheduleDailyHealthCheck } from './services/toolHealthCheck.js';

// ---------------------------------------------------------------------------
// ToolRegistry setup — core tools eager, feature tools lazy
// ---------------------------------------------------------------------------

const registry = new ToolRegistry({
  timeoutSec: config.system?.commandTimeout ?? 60,
  logger,
});

// Register all core tools (eagerly loaded, always available)
const coreToolArrays = [
  gitbookTools, postmanTools, systemTools, httpTools, envTools,
  parserTools, templateTools, aiTools, systemOptimizationTools,
  backupTools, mcpClientTools, monitoringTools, selfImprovementTools,
  githubTools, encryptionTools, aiProviderTools, schedulerTools,
  cacheTools, dbMonitoringTools, apiTools, performanceTools,
  dxTools, flowTools, knowledgeGraphTools, swarmTools, consensusTools,
  ruvectorTools, moeRouterTools, aiDefenceTools, guidanceTools,
];

for (const toolArray of coreToolArrays) {
  for (const tool of toolArray) {
    registry.registerTool(tool as unknown as import('./types/index.js').ToolDefinition, null);
  }
}

// Register feature tools — eagerly if deps available, as placeholders if not
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
    prefix: 'git',
    check: () => isPackageAvailable('simple-git'),
    loader: () => import('./tools/git.js'),
    exportName: 'gitTools',
  },
];

async function registerFeatureTools(): Promise<void> {
  for (const fm of featureModules) {
    if (fm.check()) {
      // Dependencies available — eagerly load and register with full handlers
      try {
        const mod = await fm.loader();
        const tools = mod[fm.exportName] as Array<import('./types/index.js').ToolDefinition>;
        for (const tool of tools) {
          registry.registerTool(tool, fm.prefix);
        }
        logger.info(`Feature tools loaded eagerly: ${fm.prefix}`, { count: tools.length });
      } catch (err) {
        // Import failed despite deps being detected — register placeholders
        logger.warn(`Failed to eagerly load ${fm.prefix} tools, using placeholders`, {
          error: err instanceof Error ? err.message : String(err),
        });
        registerPlaceholdersForPrefix(fm.prefix);
      }
    } else {
      // Dependencies not available — register placeholders with metadata
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

// ---------------------------------------------------------------------------
// setAgenticToolsRef — adapt registry for agentic loop
// ---------------------------------------------------------------------------

function buildAgenticToolsRef(): Array<{
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}> {
  // Return a proxy-like array that uses the registry for handler resolution.
  // For tools/list metadata, we can return all tools. For handler execution,
  // the agentic loop calls handler() which uses the registry under the hood.
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

// ---------------------------------------------------------------------------
// Utility functions (preserved from original)
// ---------------------------------------------------------------------------

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

  const healthTool = monitoringTools.find((t) => t.name === 'monitor_healthCheck');
  const healTool = monitoringTools.find((t) => t.name === 'monitor_autoHeal');

  if (!healthTool || !healTool) {
    logger.warn('Guardian loop skipped: monitoring tools unavailable');
    return;
  }

  try {
    // Use file-focused check to avoid noisy false alarms from external endpoints.
    const health = await healthTool.handler({ instancePath: peerPath, issueType: 'file' });
    const healthText = health.content?.[0]?.text || '';
    const unhealthy = healthText.includes('❌');

    if (!unhealthy) return;

    logger.warn('Guardian detected peer drift', {
      role,
      peerPath,
      cwd: PROJECT_ROOT,
    });
    const heal = await healTool.handler({
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

// ------------------------------ Server --------------------------------------
const server = new Server(
  { name: config.serverName, version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// tools/list — returns metadata from registry (never triggers module loading)
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: registry.listTools(),
}));

// tools/call — resolves handler lazily via registry
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

// ----------------------------- Bootstrap ------------------------------------
async function syncOllamaModels() {
  try {
    const url = `${config.ollamaUrl}/api/tags`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name?: string }> };
      const models = data.models?.map((m) => m.name).filter((n): n is string => n != null) ?? [];

      if (models.length > 0) {
        // Update config.yaml with fetched models ONLY if they changed
        import('./config.js').then(({ config, updateConfig }) => {
          const current = config.availableModels || [];
          const changed =
            current.length !== models.length || !current.every((m, i) => m === models[i]);
          if (changed) {
            updateConfig({ availableModels: models });
            logger.info('Synced Ollama models to config.yaml', { count: models.length });
          }
        });
      }
    }
  } catch (e) {
    logger.info('Could not sync Ollama models', { reason: 'Ollama may be unavailable', error: String(e) });
  }
}

async function main() {
  // Process-level error handlers (graceful shutdown on unexpected errors)
  process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection', { reason });
    process.exit(1);
  });

  // Register feature tools (lazy or eager depending on dependency availability)
  await registerFeatureTools();

  // Inject tool registry for agentic loop (avoids circular imports)
  setAgenticToolsRef(buildAgenticToolsRef());

  logger.info(`ToolRegistry initialized: ${registry.getToolCount()} tools registered`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Hakan Personal MCP Server started');
  logActiveCooldowns();
  conversationManager.loadFromDisk();

  const role = (process.env.INSTANCE_ROLE || 'main').toLowerCase();

  // Keep peer workspace immutable; only main updates tracked config.yaml model list.
  if (role === 'main') {
    logger.info('Auto-reload mechanism active', { version: 'v3' });
    if (config.aiProviders?.localModels && process.env.DISABLE_LOCAL_MODELS !== '1') {
      syncOllamaModels();
    }
  } else {
    logger.info('Skipping Ollama model sync', { reason: 'non-main instance role', role });
  }

  // Start automatic backup service
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

  // Always keep a lightweight guardian loop running between twin instances.
  startGuardianLoop(role);

  // Start daily MCP tool health check (uses registry listTools for tool enumeration)
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
  const stopToolHealthCheck = scheduleDailyHealthCheck(healthCheckTools, PROJECT_ROOT);
  logger.info('Tool health check scheduler active', { frequency: 'daily' });

  // Consciousness service — periodic timer removed in Journal v2.
  // Reflections are now event-driven (session start/end, errors, checkpoints, milestones).
  if (config.consciousness?.enabled !== false) {
    const maxEntries = config.consciousness?.maxJournalEntries ?? 500;
    const consciousnessService = new ConsciousnessService(PROJECT_ROOT, maxEntries);
    consciousnessService.ensureDir();
    logger.info('Consciousness service initialized (event-driven mode)');
  }

  // Graceful shutdown
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown signal received, shutting down', { signal });
    try {
      conversationManager.shutdown();
      backupService.stop();
      schedulerManager.shutdown();
      stopToolHealthCheck();

      // Dynamic imports for cleanup modules that depend on native deps
      try {
        const { stopMongoCleanup } = await import('./tools/mongodb.js');
        stopMongoCleanup();
      } catch {
        // mongodb not installed — no cleanup needed
      }

      await processRegistry.killAll(3000);

      try {
        const { dbPoolManager } = await import('./utils/dbPoolManager.js');
        await dbPoolManager.closeAll();
      } catch {
        // db deps not installed — no pools to close
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
