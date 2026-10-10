process.setMaxListeners(20);

// Core tool modules. The loaders are static imports, not import(variable):
// a computed specifier is unresolvable at bundle time, and esbuild would leave
// it as a runtime import that finds nothing inside the single-file bundle —
// the server would start with zero tools and only a warning. Adding a tool
// module means adding a line here.
type ToolList = Array<import('./types/index.js').ToolDefinition>;
const TOOL_MODULES: Array<{ name: string; load: () => Promise<ToolList> }> = [
  { name: 'health', load: async () => (await import('./tools/health.js')).healthTools as ToolList },
  { name: 'gitbook', load: async () => (await import('./tools/gitbook.js')).gitbookTools as ToolList },
  { name: 'http', load: async () => (await import('./tools/http.js')).httpTools as ToolList },
  { name: 'backup', load: async () => (await import('./tools/backup.js')).backupTools as ToolList },
  { name: 'mcpClient', load: async () => (await import('./tools/mcpClient.js')).mcpClientTools as ToolList },
  { name: 'disk', load: async () => (await import('./tools/disk.js')).diskTools as ToolList },
  { name: 'sysint', load: async () => (await import('./tools/sysint.js')).sysintTools as ToolList },
  { name: 'cfbypass', load: async () => (await import('./tools/cfbypass.js')).cfbypassTools as ToolList },
  { name: 'chromeDevtools', load: async () => (await import('./tools/chromeDevtools.js')).chromeDevtoolsTools as ToolList },
  { name: 'exaSearch', load: async () => (await import('./tools/exaSearch.js')).exaTools as ToolList },
  { name: 'ollamaChat', load: async () => (await import('./tools/ollamaChat.js')).ollamaChatTools as ToolList },
  { name: 'transcribeLocal', load: async () => (await import('./tools/transcribeLocal.js')).transcribeLocalTools as ToolList },
];

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
    { name: 'hakan-mcp', version: '3.0.0' },
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

  registry = new ToolRegistry({
    timeoutSec: config.system?.commandTimeout ?? 60,
    logger,
  });

  // Load core tools
  const loadStart = Date.now();
  const loadPromises = TOOL_MODULES.map(async (mod) => {
    try {
      const tools = await mod.load();
      for (const tool of tools) {
        registry.registerTool(tool as unknown as import('./types/index.js').ToolDefinition, null);
      }
    } catch (err) {
      logger.warn(`Failed to load tool module: ${mod.name}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Feature tools (db, mongo) are always registered as placeholders; the real
  // module loads on the first call through registry.getHandler(). Loading them
  // eagerly imported their native drivers at startup — mongodb alone costs ~12s
  // on NTFS and mongo is called rarely — so every session paid for a driver it
  // usually never used. tools/list stays complete because the placeholder
  // carries the metadata.
  for (const prefix of ['db', 'mongo']) {
    registerPlaceholders(FEATURE_TOOL_METADATA, prefix, registry);
  }

  await Promise.all(loadPromises);

  logger.info(`ToolRegistry initialized: ${registry.getToolCount()} tools in ${Date.now() - loadStart}ms`);
  resolveToolsReady!();

  // Phase 3: Defer heavy services
  let stopToolHealthCheckRef: (() => void) | null = null;
  setImmediate(async () => {
    try {
      const { backupService } = await import('./services/backupService.js');
      const { scheduleDailyHealthCheck } = await import('./services/toolHealthCheck.js');

      const role = (process.env.INSTANCE_ROLE || 'main').toLowerCase();

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
      const { backupService } = await import('./services/backupService.js');
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
