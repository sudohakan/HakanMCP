process.setMaxListeners(20);

// Tool modules — loaded lazily via dynamic import after MCP handshake
const TOOL_MODULES = [
  { path: './tools/gitbook.js', export: 'gitbookTools' },
  { path: './tools/postman.js', export: 'postmanTools' },
  { path: './tools/http.js', export: 'httpTools' },
  { path: './tools/env.js', export: 'envTools' },
  { path: './tools/aiTools.js', export: 'aiTools' },
  { path: './tools/backup.js', export: 'backupTools' },
  { path: './tools/mcpClient.js', export: 'mcpClientTools' },
  { path: './tools/encryption.js', export: 'encryptionTools' },
  { path: './tools/aiProviders.js', export: 'aiProviderTools' },
  { path: './tools/cache.js', export: 'cacheTools' },
  { path: './tools/disk.js', export: 'diskTools' },
  { path: './tools/sysint.js', export: 'sysintTools' },
  { path: './tools/cfbypass.js', export: 'cfbypassTools' },
] as const;

async function main() {
  // Phase 0: Import MCP SDK first and connect transport immediately
  // All other imports are deferred to after connection is established
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

  // Lazy-loaded references — populated after Phase 2
  let registry: import('./toolRegistry.js').ToolRegistry;
  let config: import('./config.js').Config;
  let logger: typeof import('./utils/logger.js').logger;
  let PROJECT_ROOT: string;

  // Promise that resolves when tools are loaded — handlers wait on this
  let resolveToolsReady: () => void;
  const toolsReady = new Promise<void>((resolve) => { resolveToolsReady = resolve; });

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

  // ListTools waits until tools are loaded before responding
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await toolsReady;
    return { tools: registry.listTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    await toolsReady;

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
      logger?.error('Tool execution error', { tool: name, error: message });
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      } as unknown as Record<string, unknown>;
    }
  });

  // Phase 1: Connect MCP transport FIRST — Claude Code gets initialize response immediately
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Phase 2: Load app modules and tools (after transport is connected)
  const configMod = await import('./config.js');
  config = configMod.config;
  const loggerMod = await import('./utils/logger.js');
  logger = loggerMod.logger;
  const { PROJECT_ROOT: projRoot } = await import('./utils/projectRoot.js');
  PROJECT_ROOT = projRoot;

  logger.info('Hakan Personal MCP Server connected');

  process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection', { reason });
    process.exit(1);
  });

  const { ToolRegistry, FEATURE_TOOL_METADATA } = await import('./toolRegistry.js');
  const { isPackageAvailable } = await import('./dependencyResolver.js');

  registry = new ToolRegistry({
    timeoutSec: config.system?.commandTimeout ?? 60,
    logger,
  });

  // Load core tools
  const loadStart = Date.now();
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

  // Load feature tools (db, mongo)
  const featureModules = [
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

  const featurePromise = (async () => {
    for (const fm of featureModules) {
      if (fm.check()) {
        try {
          const mod = await fm.loader() as Record<string, unknown>;
          const tools = mod[fm.exportName] as Array<import('./types/index.js').ToolDefinition>;
          for (const tool of tools) {
            registry.registerTool(tool, fm.prefix);
          }
          logger.info(`Feature tools loaded eagerly: ${fm.prefix}`, { count: tools.length });
        } catch (err) {
          logger.warn(`Failed to eagerly load ${fm.prefix} tools, using placeholders`, {
            error: err instanceof Error ? err.message : String(err),
          });
          registerPlaceholders(FEATURE_TOOL_METADATA, fm.prefix, registry);
        }
      } else {
        registerPlaceholders(FEATURE_TOOL_METADATA, fm.prefix, registry);
        logger.info(`Feature tools registered as placeholders: ${fm.prefix}`, {
          reason: 'native dependencies not installed',
        });
      }
    }
  })();

  await Promise.all([...loadPromises, featurePromise]);

  const { setAgenticToolsRef } = await import('./tools/aiTools.js');
  setAgenticToolsRef(buildAgenticToolsRef(registry));
  logger.info(`ToolRegistry initialized: ${registry.getToolCount()} tools in ${Date.now() - loadStart}ms`);
  resolveToolsReady!();

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
          syncOllamaModels(config, logger);
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

      startGuardianLoop(role, config, logger);

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

function registerPlaceholders(
  featureToolMetadata: Record<string, Array<{ name: string; description: string; inputSchema: unknown }>>,
  prefix: string,
  registry: import('./toolRegistry.js').ToolRegistry,
): void {
  const metadata = featureToolMetadata[prefix];
  if (!metadata) return;
  for (const meta of metadata) {
    registry.registerPlaceholder(meta.name, meta.description, meta.inputSchema as import('./types/index.js').ToolDefinition['inputSchema'], prefix);
  }
}

function buildAgenticToolsRef(registry: import('./toolRegistry.js').ToolRegistry): Array<{
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

function startGuardianLoop(
  role: string,
  config: import('./config.js').Config,
  logger: typeof import('./utils/logger.js').logger,
) {
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

async function syncOllamaModels(
  config: import('./config.js').Config,
  logger: typeof import('./utils/logger.js').logger,
) {
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

main().catch((err) => {
  // Logger may not be loaded yet — use stderr directly
  process.stderr.write(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    message: 'Fatal error during startup',
    error: err instanceof Error ? err.message : String(err),
  }) + '\n');
  process.exit(1);
});
