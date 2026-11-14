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
import { recordCall, recordError } from './utils/toolMetrics.js';
import { annotationsFor, type ToolAnnotationHints } from './toolAnnotations.js';

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
  http: { modulePath: './tools/http.js', exportName: 'httpTools', nativeDeps: [], core: true, featureName: '' },
  health: { modulePath: './tools/health.js', exportName: 'healthTools', nativeDeps: [], core: true, featureName: '' },
  gb: { modulePath: './tools/gitbook.js', exportName: 'gitbookTools', nativeDeps: [], core: true, featureName: '' },
  backup: { modulePath: './tools/backup.js', exportName: 'backupTools', nativeDeps: [], core: true, featureName: '' },
  mcp: { modulePath: './tools/mcpClient.js', exportName: 'mcpClientTools', nativeDeps: [], core: true, featureName: '' },
  disk: { modulePath: './tools/disk.js', exportName: 'diskTools', nativeDeps: [], core: true, featureName: '' },
  sysint: { modulePath: './tools/sysint.js', exportName: 'sysintTools', nativeDeps: [], core: true, featureName: '' },

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
    { name: 'db', description: 'Database operations (query, listTables, getTableSchema, backup, restore, closeConnections, getPoolStats). Requires action parameter.', inputSchema: { type: 'object', properties: { action: { type: 'string' }, dbType: { type: 'string' } }, required: ['action'] } },
  ],
  mongo: [
    { name: 'mongo', description: 'MongoDB operations (connect, find, insert, update, delete, countDocuments, aggregate, createIndex, listCollections, listDatabases, disconnect). Requires action parameter.', inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } },
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
  loadError?: string,
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
      ...(loadError ? ['', `Load error: ${loadError}`] : []),
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
  /** Module loaders by placeholder prefix; take precedence over FEATURE_TOOL_MAP modulePath */
  private loaders = new Map<string, () => Promise<ToolDefinition[]>>();
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
   * Set the loader for placeholders registered under `prefix`. It runs once, on
   * the first getHandler() call for any of them, and fills every tool it returns.
   */
  registerLoader(prefix: string, load: () => Promise<ToolDefinition[]>): void {
    this.loaders.set(prefix, load);
  }

  /**
   * Return static metadata for all registered tools.
   * NEVER triggers module loading — safe for tools/list.
   */
  listTools(): Array<{ name: string; description: string; inputSchema: ToolDefinition['inputSchema']; annotations: ToolAnnotationHints }> {
    const result: Array<{ name: string; description: string; inputSchema: ToolDefinition['inputSchema']; annotations: ToolAnnotationHints }> = [];
    for (const entry of this.tools.values()) {
      result.push({
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
        annotations: annotationsFor(entry.name),
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
    const loader = this.loaders.get(prefix);
    if (!featureModule && !loader) return null;

    try {
      const tools = await this.loadModule(prefix, featureModule, loader);

      for (const tool of tools) {
        const existing = this.tools.get(tool.name);
        if (existing && !existing.handler) {
          existing.handler = this.wrapHandler(tool.name, tool.handler);
        }
      }

      const updated = this.tools.get(name);
      return updated?.handler ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A build prunes chunks unused for two weeks; a process older than that asks for one by its old hash.
      const isStaleChunk = /ERR_MODULE_NOT_FOUND|Cannot find module/.test(message) && /[/\\]chunks[/\\]/.test(message);
      if (isStaleChunk || !featureModule || featureModule.core) {
        // Not cached: the module cache dropped the rejected load, so the next call retries.
        this.log?.warn('Failed to load tool module', { tool: name, prefix, error: message });
        const text = isStaleChunk
          ? `Tool "${name}" is unavailable: HakanMCP was rebuilt and this process's code chunk was pruned. Restart the session (or reconnect the MCP server). ${message}`
          : `Tool "${name}" failed to load: ${message}`;
        return async (): Promise<ToolResponse> => ({
          content: [{ type: 'text', text }],
          isError: true,
        });
      }
      this.log?.warn('Failed to load feature module, using placeholder', {
        tool: name,
        prefix,
        featureName: featureModule.featureName,
        error: message,
      });
      const placeholder = createPlaceholderHandler(name, featureModule, message);
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
  private loadModule(
    prefix: string,
    featureModule: FeatureModule | undefined,
    loader: (() => Promise<ToolDefinition[]>) | undefined,
  ): Promise<ToolDefinition[]> {
    const cacheKey = prefix;

    if (!this.loadedModules.has(cacheKey)) {
      const loadPromise = this.doLoadModule(prefix, featureModule, loader);
      this.loadedModules.set(cacheKey, loadPromise);

      loadPromise.catch(() => {
        this.loadedModules.delete(cacheKey);
      });
    }

    return this.loadedModules.get(cacheKey)!;
  }

  private async doLoadModule(
    prefix: string,
    featureModule: FeatureModule | undefined,
    loader: (() => Promise<ToolDefinition[]>) | undefined,
  ): Promise<ToolDefinition[]> {
    if (featureModule && !featureModule.core) {
      const { ensureDependency } = await import('./dependencyResolver.js');
      await ensureDependency(featureModule.featureName);
    }

    const tools: ToolDefinition[] = loader
      ? await loader()
      : (await import(featureModule!.modulePath))[featureModule!.exportName];

    if (!Array.isArray(tools)) {
      throw new Error(`Module for "${prefix}" did not return a tool array`);
    }

    this.log?.info('Lazy-loaded tool module', { prefix, toolCount: tools.length });

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
      recordCall(toolName);
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
        const message = error instanceof Error ? error.message : String(error);
        recordError(toolName, message);
        toolLogger?.error('Tool execution failed', error, { args: args as Record<string, unknown> });
        throw error;
      }
    };
  }
}
