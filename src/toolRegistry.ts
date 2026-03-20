/**
 * ToolRegistry — Two-phase tool registration with lazy loading support
 *
 * Provides:
 * - FEATURE_TOOL_MAP: Maps tool name prefixes to their source modules
 * - ToolRegistry class: Manages metadata-first, handler-lazy registration
 * - detectFeatureFromToolName: Identifies which feature module owns a tool
 * - createPlaceholderHandler: Returns instructional error for missing deps
 */

import type { ToolDefinition, ToolHandler, ToolResponse } from './types/index.js';

export interface FeatureModule {
  /** Relative path to compiled module, e.g. './tools/db.js' */
  modulePath: string;
  /** Named export from the module, e.g. 'dbTools' */
  exportName: string;
  /** Required native packages, e.g. ['pg', 'mysql2'] */
  nativeDeps: string[];
  /** true = eagerly loaded (core), false = lazy loaded (feature) */
  core: boolean;
  /** Key in FEATURE_DEPENDENCY_MAP, e.g. 'database'. Empty string for core modules. */
  featureName: string;
}

export const FEATURE_TOOL_MAP: Record<string, FeatureModule> = {
  sys: { modulePath: './tools/system.js', exportName: 'systemTools', nativeDeps: [], core: true, featureName: '' },
  http: { modulePath: './tools/http.js', exportName: 'httpTools', nativeDeps: [], core: true, featureName: '' },
  env: { modulePath: './tools/env.js', exportName: 'envTools', nativeDeps: [], core: true, featureName: '' },
  cache: { modulePath: './tools/cache.js', exportName: 'cacheTools', nativeDeps: [], core: true, featureName: '' },
  gb: { modulePath: './tools/gitbook.js', exportName: 'gitbookTools', nativeDeps: [], core: true, featureName: '' },
  pm: { modulePath: './tools/postman.js', exportName: 'postmanTools', nativeDeps: [], core: true, featureName: '' },
  parse: { modulePath: './tools/parser.js', exportName: 'parserTools', nativeDeps: [], core: true, featureName: '' },
  compile: { modulePath: './tools/template.js', exportName: 'templateTools', nativeDeps: [], core: true, featureName: '' },
  convert: { modulePath: './tools/template.js', exportName: 'templateTools', nativeDeps: [], core: true, featureName: '' },
  ai: { modulePath: './tools/aiTools.js', exportName: 'aiTools', nativeDeps: [], core: true, featureName: '' },
  sysopt: { modulePath: './tools/systemOptimization.js', exportName: 'systemOptimizationTools', nativeDeps: [], core: true, featureName: '' },
  backup: { modulePath: './tools/backup.js', exportName: 'backupTools', nativeDeps: [], core: true, featureName: '' },
  mcp: { modulePath: './tools/mcpClient.js', exportName: 'mcpClientTools', nativeDeps: [], core: true, featureName: '' },
  monitor: { modulePath: './tools/monitoring.js', exportName: 'monitoringTools', nativeDeps: [], core: true, featureName: '' },
  self: { modulePath: './tools/selfImprovement.js', exportName: 'selfImprovementTools', nativeDeps: [], core: true, featureName: '' },
  crypto: { modulePath: './tools/encryption.js', exportName: 'encryptionTools', nativeDeps: [], core: true, featureName: '' },
  scheduler: { modulePath: './tools/scheduler.js', exportName: 'schedulerTools', nativeDeps: [], core: true, featureName: '' },
  api: { modulePath: './tools/api.js', exportName: 'apiTools', nativeDeps: [], core: true, featureName: '' },
  perf: { modulePath: './tools/performance.js', exportName: 'performanceTools', nativeDeps: [], core: true, featureName: '' },
  dx: { modulePath: './tools/dx.js', exportName: 'dxTools', nativeDeps: [], core: true, featureName: '' },
  flow: { modulePath: './tools/flow.js', exportName: 'flowTools', nativeDeps: [], core: true, featureName: '' },
  swarm: { modulePath: './tools/swarm.js', exportName: 'swarmTools', nativeDeps: [], core: true, featureName: '' },
  consensus: { modulePath: './tools/consensus.js', exportName: 'consensusTools', nativeDeps: [], core: true, featureName: '' },
  ruvector: { modulePath: './tools/ruvector.js', exportName: 'ruvectorTools', nativeDeps: [], core: true, featureName: '' },
  moe: { modulePath: './tools/moeRouter.js', exportName: 'moeRouterTools', nativeDeps: [], core: true, featureName: '' },
  aidefence: { modulePath: './tools/aiDefence.js', exportName: 'aiDefenceTools', nativeDeps: [], core: true, featureName: '' },
  guidance: { modulePath: './tools/guidance.js', exportName: 'guidanceTools', nativeDeps: [], core: true, featureName: '' },

  db: { modulePath: './tools/db.js', exportName: 'dbTools', nativeDeps: ['pg', 'mysql2', 'mssql', 'sqlite3', 'sqlite'], core: false, featureName: 'database' },
  mongo: { modulePath: './tools/mongodb.js', exportName: 'mongoTools', nativeDeps: ['mongodb'], core: false, featureName: 'mongodb' },
};

interface PlaceholderToolMeta {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export const FEATURE_TOOL_METADATA: Record<string, PlaceholderToolMeta[]> = {
  db: [
    { name: 'db_query', description: 'Run SQL query against PostgreSQL, MySQL, SQLite, or MSSQL database.', inputSchema: { type: 'object', properties: { dbType: { type: 'string' }, query: { type: 'string' } }, required: ['dbType', 'query'] } },
    { name: 'db_listTables', description: 'List all tables in a database.', inputSchema: { type: 'object', properties: { dbType: { type: 'string' } }, required: ['dbType'] } },
    { name: 'db_getTableSchema', description: 'Get schema/columns of a database table.', inputSchema: { type: 'object', properties: { dbType: { type: 'string' }, tableName: { type: 'string' } }, required: ['dbType', 'tableName'] } },
    { name: 'db_backup', description: 'Backup a database to file.', inputSchema: { type: 'object', properties: { dbType: { type: 'string' } }, required: ['dbType'] } },
    { name: 'db_restore', description: 'Restore a database from backup file.', inputSchema: { type: 'object', properties: { dbType: { type: 'string' } }, required: ['dbType'] } },
    { name: 'db_closeConnections', description: 'Close all database connection pools.', inputSchema: { type: 'object', properties: {} } },
    { name: 'db_getPoolStats', description: 'Show statistics of active database connection pools.', inputSchema: { type: 'object', properties: {} } },
  ],
  mongo: [
    { name: 'mongo_connect', description: 'Connect to MongoDB database.', inputSchema: { type: 'object', properties: { connectionString: { type: 'string' } }, required: ['connectionString'] } },
    { name: 'mongo_find', description: 'Find documents from MongoDB collection.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' }, collection: { type: 'string' } }, required: ['connectionId', 'collection'] } },
    { name: 'mongo_insert', description: 'Insert documents into MongoDB collection.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' }, collection: { type: 'string' }, documents: { type: 'array' } }, required: ['connectionId', 'collection', 'documents'] } },
    { name: 'mongo_update', description: 'Update documents in MongoDB collection.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' }, collection: { type: 'string' }, filter: { type: 'object' }, update: { type: 'object' } }, required: ['connectionId', 'collection', 'filter', 'update'] } },
    { name: 'mongo_delete', description: 'Delete documents from MongoDB collection.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' }, collection: { type: 'string' }, filter: { type: 'object' } }, required: ['connectionId', 'collection', 'filter'] } },
    { name: 'mongo_countDocuments', description: 'Count documents in MongoDB collection.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' }, collection: { type: 'string' } }, required: ['connectionId', 'collection'] } },
    { name: 'mongo_aggregate', description: 'Run MongoDB aggregation pipeline.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' }, collection: { type: 'string' }, pipeline: { type: 'array' } }, required: ['connectionId', 'collection', 'pipeline'] } },
    { name: 'mongo_createIndex', description: 'Create index in MongoDB collection.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' }, collection: { type: 'string' }, keys: { type: 'object' } }, required: ['connectionId', 'collection', 'keys'] } },
    { name: 'mongo_listCollections', description: 'List collections in MongoDB database.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' } }, required: ['connectionId'] } },
    { name: 'mongo_listDatabases', description: 'List databases on MongoDB server.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' } }, required: ['connectionId'] } },
    { name: 'mongo_disconnect', description: 'Close a MongoDB connection.', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' } }, required: ['connectionId'] } },
  ],
};

/**
 * Extract the prefix from a tool name and check if it maps to a known module.
 * Returns the prefix string if found, or null if unknown.
 */
export function detectFeatureFromToolName(toolName: string): string | null {
  const underscoreIndex = toolName.indexOf('_');
  if (underscoreIndex === -1) return null;
  const prefix = toolName.substring(0, underscoreIndex);
  return FEATURE_TOOL_MAP[prefix] ? prefix : null;
}

/**
 * Creates a handler that returns an instructional error response
 * explaining which packages are missing and how to install them.
 */
export function createPlaceholderHandler(
  toolName: string,
  featureModule: FeatureModule,
): ToolHandler {
  return async (): Promise<ToolResponse> => {
    const depsListLines = featureModule.nativeDeps
      .map((dep) => `  - ${dep}: npm install ${dep}`)
      .join('\n');

    const installAllCmd = `npm install ${featureModule.nativeDeps.join(' ')}`;

    const message = [
      `Tool "${toolName}" is currently unavailable.`,
      '',
      `This tool belongs to the "${featureModule.featureName}" feature module which requires native dependencies that are not installed.`,
      '',
      'Required packages:',
      depsListLines,
      '',
      `Install all at once: ${installAllCmd}`,
      '',
      'Alternatively, enable autoInstall in your config.yaml:',
      '  dependencies:',
      '    autoInstall: true',
      '',
      'This will automatically install missing dependencies when a tool is first used.',
    ].join('\n');

    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  };
}

interface ToolEntry {
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
  /** null means handler not yet loaded (lazy feature tool) */
  handler: ToolHandler | null;
  /** null means core tool (handler always set) */
  featurePrefix: string | null;
}

export interface ToolRegistryOptions {
  /** Timeout in seconds for tool execution (applied as logging/timeout wrapper) */
  timeoutSec?: number;
  /** Logger instance with info/warn/error methods */
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, error?: unknown, meta?: Record<string, unknown>) => void;
    child: (meta: Record<string, unknown>) => {
      info: (msg: string, meta?: Record<string, unknown>) => void;
      error: (msg: string, error?: unknown, meta?: Record<string, unknown>) => void;
    };
  };
}

export class ToolRegistry {
  private tools = new Map<string, ToolEntry>();
  /** Caches module import promises to prevent concurrent double-imports */
  private loadedModules = new Map<string, Promise<ToolDefinition[]>>();
  private timeoutSec: number;
  private log: ToolRegistryOptions['logger'] | undefined;

  constructor(options?: ToolRegistryOptions) {
    this.timeoutSec = options?.timeoutSec ?? 60;
    this.log = options?.logger;
  }

  /**
   * Register a fully loaded tool (core tool with handler ready).
   */
  registerTool(tool: ToolDefinition, featurePrefix: string | null): void {
    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler: this.wrapHandler(tool.name, tool.handler),
      featurePrefix,
    });
  }

  /**
   * Register a placeholder entry for a tool whose module hasn't loaded yet.
   * Handler is null — will be lazy-loaded on first getHandler() call.
   */
  registerPlaceholder(
    name: string,
    description: string,
    inputSchema: ToolDefinition['inputSchema'],
    featurePrefix: string,
  ): void {
    this.tools.set(name, {
      name,
      description,
      inputSchema,
      handler: null,
      featurePrefix,
    });
  }

  /**
   * Return static metadata for all registered tools.
   * NEVER triggers module loading — safe for tools/list.
   */
  listTools(): Array<{ name: string; description: string; inputSchema: ToolDefinition['inputSchema'] }> {
    const result: Array<{ name: string; description: string; inputSchema: ToolDefinition['inputSchema'] }> = [];
    for (const entry of this.tools.values()) {
      result.push({
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
      });
    }
    return result;
  }

  /**
   * Get the handler for a tool, lazy-loading the module if necessary.
   *
   * For core tools, returns the handler immediately.
   * For feature tools:
   *  1. Calls ensureDependency() from dependencyResolver
   *  2. Dynamic imports the module
   *  3. Updates ALL tool handlers from that module (not just the requested one)
   *  4. Returns the handler
   *
   * If dependency resolution fails, returns a placeholder handler instead of throwing.
   */
  async getHandler(name: string): Promise<ToolHandler | null> {
    const entry = this.tools.get(name);
    if (!entry) return null;

    if (entry.handler) return entry.handler;

    const prefix = entry.featurePrefix;
    if (!prefix) return null;

    const featureModule = FEATURE_TOOL_MAP[prefix];
    if (!featureModule) return null;

    try {
      const tools = await this.loadModule(prefix, featureModule);

      for (const tool of tools) {
        const existing = this.tools.get(tool.name);
        if (existing && !existing.handler) {
          existing.handler = this.wrapHandler(tool.name, tool.handler);
        }
      }

      const updated = this.tools.get(name);
      return updated?.handler ?? null;
    } catch (error) {
      this.log?.warn('Failed to load feature module, using placeholder', {
        tool: name,
        prefix,
        featureName: featureModule.featureName,
        error: error instanceof Error ? error.message : String(error),
      });
      const placeholder = createPlaceholderHandler(name, featureModule);
      entry.handler = placeholder;
      return placeholder;
    }
  }

  /** Total number of registered tools */
  getToolCount(): number {
    return this.tools.size;
  }

  /** Check if a tool name is registered */
  isRegistered(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Load a feature module, ensuring dependencies are available first.
   * Uses loadedModules cache to prevent concurrent double-imports.
   */
  private loadModule(prefix: string, featureModule: FeatureModule): Promise<ToolDefinition[]> {
    const cacheKey = featureModule.modulePath;

    if (!this.loadedModules.has(cacheKey)) {
      const loadPromise = this.doLoadModule(featureModule);
      this.loadedModules.set(cacheKey, loadPromise);

      loadPromise.catch(() => {
        this.loadedModules.delete(cacheKey);
      });
    }

    return this.loadedModules.get(cacheKey)!;
  }

  private async doLoadModule(featureModule: FeatureModule): Promise<ToolDefinition[]> {
    const { ensureDependency } = await import('./dependencyResolver.js');
    await ensureDependency(featureModule.featureName);

    const mod = await import(featureModule.modulePath);
    const tools: ToolDefinition[] = mod[featureModule.exportName];

    if (!Array.isArray(tools)) {
      throw new Error(
        `Module ${featureModule.modulePath} does not export "${featureModule.exportName}" as an array`,
      );
    }

    this.log?.info('Lazy-loaded feature module', {
      modulePath: featureModule.modulePath,
      exportName: featureModule.exportName,
      toolCount: tools.length,
    });

    return tools;
  }

  /**
   * Wraps a handler with logging and timeout logic
   * (equivalent to withLogging in index.ts).
   */
  private wrapHandler(toolName: string, handler: ToolHandler): ToolHandler {
    const timeoutMs = this.timeoutSec * 1000;

    return async (args: unknown): Promise<ToolResponse> => {
      const toolLogger = this.log?.child({ tool: toolName, operation: 'invoke' });
      try {
        toolLogger?.info('Tool invoked', { args: args as Record<string, unknown> });
        const result = await Promise.race([
          handler(args),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Tool timeout after ${this.timeoutSec}s`)),
              timeoutMs,
            ),
          ),
        ]);
        toolLogger?.info('Tool completed successfully');
        return result;
      } catch (error) {
        toolLogger?.error('Tool execution failed', error, { args: args as Record<string, unknown> });
        throw error;
      }
    };
  }
}
