import { z } from 'zod';
import { loadCatalog, getCatalogServer, listCatalogServers } from '../catalog/index.js';
import { resolveEnvKeys } from '../utils/credentials.js';
import { MCPConnectionManager, connectionManager } from './mcpConnectionManager.js';
import type { MCPConnection } from './mcpConnectionManager.js';

// The connection manager lives in ./mcpConnectionManager.ts; re-exported here
// so existing importers (and tests) keep their import path.
export { MCPConnectionManager, connectionManager };
export type { MCPConnection };

const BEFORE_EXIT_FLAG = Symbol.for('mcpClient.beforeExitRegistered');
const browserConnectionCache = new Map<string, string>();

type RemoteToolDescriptor = {
  name?: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

type BrowserConnectOptions = {
  connectionId?: string;
  browser?: 'chrome' | 'firefox' | 'webkit' | 'msedge';
  headless?: boolean;
  isolated?: boolean;
  userDataDir?: string;
  profileTag?: string;
  extension?: boolean;
  cdpEndpoint?: string;
  allowedHosts?: string[];
  outputDir?: string;
  snapshotMode?: 'incremental' | 'full' | 'none';
  timeoutAction?: number;
  timeoutNavigation?: number;
};

type BrowserToolSet = {
  navigate?: RemoteToolDescriptor;
  snapshot?: RemoteToolDescriptor;
  screenshot?: RemoteToolDescriptor;
  waitFor?: RemoteToolDescriptor;
  close?: RemoteToolDescriptor;
  click?: RemoteToolDescriptor;
  fill?: RemoteToolDescriptor;
  type?: RemoteToolDescriptor;
  pressKey?: RemoteToolDescriptor;
  evaluate?: RemoteToolDescriptor;
  selectOption?: RemoteToolDescriptor;
};

const browserToolCandidates = {
  navigate: ['browser_navigate'],
  snapshot: ['browser_snapshot'],
  screenshot: ['browser_take_screenshot'],
  waitFor: ['browser_wait_for'],
  close: ['browser_close'],
  click: ['browser_click'],
  fill: ['browser_fill_form'],
  type: ['browser_type'],
  pressKey: ['browser_press_key'],
  evaluate: ['browser_evaluate'],
  selectOption: ['browser_select_option'],
} as const;

function buildBrowserCacheKey(options: Omit<BrowserConnectOptions, 'connectionId'>): string {
  return JSON.stringify({
    browser: options.browser ?? 'chrome',
    headless: options.headless ?? true,
    isolated: options.isolated ?? true,
    extension: options.extension ?? false,
    cdpEndpoint: options.cdpEndpoint ?? '',
    allowedHosts: [...(options.allowedHosts ?? [])].sort(),
    outputDir: options.outputDir ?? '',
    snapshotMode: options.snapshotMode ?? 'incremental',
    timeoutAction: options.timeoutAction ?? 5000,
    timeoutNavigation: options.timeoutNavigation ?? 60000,
    profileTag: options.profileTag ?? '',
  });
}

function buildPlaywrightArgs(options: Omit<BrowserConnectOptions, 'connectionId'>): string[] {
  const args: string[] = [];

  if (options.browser) {
    args.push('--browser', options.browser);
  }
  if (options.headless ?? true) {
    args.push('--headless');
  }
  if (options.isolated ?? false) {
    args.push('--isolated');
  }
  if (!options.isolated && !options.cdpEndpoint) {
    let dir = options.userDataDir;
    if (!dir && options.profileTag) {
      dir = `/tmp/hakanmcp-browser/${options.profileTag}`;
    }
    dir = dir ?? `${process.env.HOME || require('os').homedir()}/.playwright-mcp/browser-profile`;
    args.push('--user-data-dir', dir);
  }
  if (options.extension) {
    args.push('--extension');
  }
  if (options.cdpEndpoint) {
    args.push('--cdp-endpoint', options.cdpEndpoint);
  }
  if (options.allowedHosts && options.allowedHosts.length > 0) {
    args.push('--allowed-hosts', options.allowedHosts.join(','));
  }
  if (options.outputDir) {
    args.push('--output-dir', options.outputDir);
  }
  if (options.snapshotMode) {
    args.push('--snapshot-mode', options.snapshotMode);
  }
  if (typeof options.timeoutAction === 'number') {
    args.push('--timeout-action', String(options.timeoutAction));
  }
  if (typeof options.timeoutNavigation === 'number') {
    args.push('--timeout-navigation', String(options.timeoutNavigation));
  }

  return args;
}

async function listRemoteTools(connectionId: string): Promise<RemoteToolDescriptor[]> {
  const result = (await connectionManager.sendRequest(connectionId, 'tools/list')) as {
    tools?: RemoteToolDescriptor[];
  };
  return result.tools ?? [];
}

function resolveRemoteTool(
  tools: RemoteToolDescriptor[],
  candidates: readonly string[],
): RemoteToolDescriptor | undefined {
  return candidates
    .map((candidate) => tools.find((tool) => tool.name === candidate))
    .find((tool): tool is RemoteToolDescriptor => Boolean(tool));
}

function getBrowserToolSet(tools: RemoteToolDescriptor[]): BrowserToolSet {
  return {
    navigate: resolveRemoteTool(tools, browserToolCandidates.navigate),
    snapshot: resolveRemoteTool(tools, browserToolCandidates.snapshot),
    screenshot: resolveRemoteTool(tools, browserToolCandidates.screenshot),
    waitFor: resolveRemoteTool(tools, browserToolCandidates.waitFor),
    close: resolveRemoteTool(tools, browserToolCandidates.close),
    click: resolveRemoteTool(tools, browserToolCandidates.click),
    fill: resolveRemoteTool(tools, browserToolCandidates.fill),
    type: resolveRemoteTool(tools, browserToolCandidates.type),
    pressKey: resolveRemoteTool(tools, browserToolCandidates.pressKey),
    evaluate: resolveRemoteTool(tools, browserToolCandidates.evaluate),
    selectOption: resolveRemoteTool(tools, browserToolCandidates.selectOption),
  };
}

function schemaPropertyNames(tool?: RemoteToolDescriptor): Set<string> {
  const properties = tool?.inputSchema?.properties;
  if (!properties || typeof properties !== 'object') {
    return new Set<string>();
  }
  return new Set(Object.keys(properties));
}

// Upstream renames, mapped at the boundary instead of at each call site.
//
// @playwright/mcp renamed the element handle `ref` -> `target` and `pressEnter` -> `submit`
// (measured against the live server, v0.0.80: browser_click requires ['target'],
// browser_type requires ['target','text'], browser_fill_form requires each field to carry
// ['target','name','type','value']). Our wrappers still speak the old names.
//
// The rename was SILENT here precisely because adaptArgsForTool only ever removed keys: an
// unknown `ref` was filtered out, the now-required `target` was never added, and every call
// died with "expected string, received undefined". Renaming at 13 call sites would fix today
// and rot on the next upstream rename, so the alias lives here — one place that already holds
// the target schema. If a schema still accepts the old name, nothing is rewritten.
const REMOTE_ARG_ALIASES: Record<string, string> = {
  ref: 'target',
  pressEnter: 'submit',
};

function applyArgAliases(
  args: Record<string, unknown>,
  allowedKeys: Set<string>,
): Record<string, unknown> {
  const out = { ...args };
  for (const [from, to] of Object.entries(REMOTE_ARG_ALIASES)) {
    // Only rewrite when the schema wants the new name, rejects the old one, and the new
    // one is not already set by the caller.
    if (from in out && !allowedKeys.has(from) && allowedKeys.has(to) && out[to] === undefined) {
      out[to] = out[from];
      delete out[from];
    }
  }
  return out;
}

function fieldItemPropertyNames(tool?: RemoteToolDescriptor): Set<string> {
  const fields = tool?.inputSchema?.properties?.fields as
    | { items?: { properties?: Record<string, unknown> } }
    | undefined;
  const properties = fields?.items?.properties;
  if (!properties || typeof properties !== 'object') {
    return new Set<string>();
  }
  return new Set(Object.keys(properties));
}

function adaptArgsForTool(
  tool: RemoteToolDescriptor | undefined,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const allowedKeys = schemaPropertyNames(tool);
  if (allowedKeys.size === 0) {
    return args;
  }
  const aliased = applyArgAliases(args, allowedKeys);
  const adapted = Object.fromEntries(
    Object.entries(aliased).filter(([key]) => allowedKeys.has(key)),
  );

  // browser_fill_form carries the handle one level down, inside each fields[] entry —
  // a top-level filter never reaches it, so the same rename is applied per item.
  const itemKeys = fieldItemPropertyNames(tool);
  if (itemKeys.size > 0 && Array.isArray(adapted.fields)) {
    adapted.fields = (adapted.fields as unknown[]).map((item) =>
      item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(
              applyArgAliases(item as Record<string, unknown>, itemKeys),
            ).filter(([key]) => itemKeys.has(key)),
          )
        : item,
    );
  }
  return adapted;
}

function extractTextChunks(result: unknown): string[] {
  if (typeof result === 'string') {
    return [result];
  }
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    if (Array.isArray(content)) {
      return content
        .filter((item) => item?.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text as string);
    }
  }
  return [JSON.stringify(result, null, 2)];
}

function compactText(text: string, maxChars = 1200): string {
  const normalized = text.replace(/\r/g, '').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function summarizeSnapshot(text: string, maxChars = 1600): string {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const relevant = lines.filter((line) =>
    /(heading|textbox|button|link|password|email|username|sign in|login)/i.test(line),
  );
  const summaryLines = (relevant.length > 0 ? relevant : lines).slice(0, 18);
  return compactText(summaryLines.join('\n'), maxChars);
}

function extractPageField(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
  return match?.[1]?.trim();
}

function detectLoginSignals(text: string): {
  loginDetected: boolean;
  indicators: string[];
  confidence: 'low' | 'medium' | 'high';
} {
  const lower = text.toLowerCase();
  const indicatorChecks: Array<[string, RegExp]> = [
    ['password-field', /password/],
    ['email-field', /\bemail\b/],
    ['username-field', /username|user name/],
    ['sign-in-copy', /sign in|log in|login/],
    ['submit-control', /submit|continue|giriş yap/],
  ];

  const indicators = indicatorChecks
    .filter(([, pattern]) => pattern.test(lower))
    .map(([name]) => name);

  const score = indicators.length;
  const confidence: 'low' | 'medium' | 'high' = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

  return {
    loginDetected: score >= 2,
    indicators,
    confidence,
  };
}

async function ensurePlaywrightConnection(
  options: BrowserConnectOptions = {},
): Promise<{ connectionId: string; reused: boolean }> {
  if (options.connectionId) {
    return { connectionId: options.connectionId, reused: true };
  }

  // Default to the existing automation Chrome (CDP) when one is configured.
  // Attaching to a real, persistent profile keeps `navigator.webdriver=false`
  // and bot-score-killing fingerprint signals — the same setup makes hCaptcha
  // / Turnstile fall through silently in most cases. Caller can still pass
  // cdpEndpoint=null or isolated=true to opt out.
  const defaultCdp = process.env.HAKANMCP_DEFAULT_CDP_ENDPOINT?.trim() ||
    process.env.CHROME_DEVTOOLS_BROWSER_URL?.trim();
  const effectiveCdp = options.cdpEndpoint ?? (options.isolated ? undefined : defaultCdp || undefined);

  const browserOptions: Omit<BrowserConnectOptions, 'connectionId'> = {
    browser: options.browser,
    headless: options.headless,
    isolated: options.isolated,
    extension: options.extension,
    cdpEndpoint: effectiveCdp,
    allowedHosts: options.allowedHosts,
    outputDir: options.outputDir,
    snapshotMode: options.snapshotMode,
    timeoutAction: options.timeoutAction,
    timeoutNavigation: options.timeoutNavigation,
  };
  const cacheKey = buildBrowserCacheKey(browserOptions);
  const cachedConnectionId = browserConnectionCache.get(cacheKey);
  if (cachedConnectionId && connectionManager.getConnection(cachedConnectionId)?.connected) {
    return { connectionId: cachedConnectionId, reused: true };
  }

  const server = getCatalogServer('playwright');
  if (!server) {
    throw new Error('Playwright catalog server is not defined');
  }

  const connectionId = await connectionManager.connect(server.command, [
    ...server.args,
    ...buildPlaywrightArgs(browserOptions),
  ]);
  browserConnectionCache.set(cacheKey, connectionId);
  return { connectionId, reused: false };
}

async function callRemoteTool(
  connectionId: string,
  tool: RemoteToolDescriptor | undefined,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!tool?.name) {
    throw new Error('Required browser tool is not available on the connected MCP server');
  }
  const toolArguments = adaptArgsForTool(tool, args);
  return connectionManager.sendRequest(connectionId, 'tools/call', {
    name: tool.name,
    arguments: toolArguments,
  });
}

function removeCachedBrowserConnection(connectionId: string): void {
  for (const [cacheKey, cachedConnectionId] of browserConnectionCache.entries()) {
    if (cachedConnectionId === connectionId) {
      browserConnectionCache.delete(cacheKey);
    }
  }
}

if (!(globalThis as Record<symbol, boolean>)[BEFORE_EXIT_FLAG]) {
  process.on('beforeExit', () => {
    connectionManager.disconnectAll();
  });
  (globalThis as Record<symbol, boolean>)[BEFORE_EXIT_FLAG] = true;
}

const _mcpLegacyTools = [
  {
    name: 'mcp_connect',
    description:
      'It connects to another MCP server. You can use the Docker command for self-connection.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: "Command to start MCP server (eg: 'docker', 'node')",
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments',
        },
        env: {
          type: 'object',
          description: 'Environment variables to pass to the MCP server process',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['command', 'args'],
    },
    handler: async (args: unknown) => {
      const { command, args: cmdArgs, env } = z
        .object({
          command: z.string(),
          args: z.array(z.string()),
          env: z.record(z.string(), z.string()).optional(),
        })
        .parse(args);

      try {
        const connectionId = await connectionManager.connect(command, cmdArgs, env);

        return {
          content: [
            {
              type: 'text',
              text: `✓ MCP connection established\n\nConnection ID: ${connectionId}\n\nYou can use this ID in other MCP client tools.`,
            },
          ],
        };
      } catch (error: unknown) {
        throw new Error(
          `MCP connection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  },
  {
    name: 'mcp_listTools',
    description: 'Lists the available tools on the connected MCP server.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'connection ID received with mcp_connect',
        },
      },
      required: ['connectionId'],
    },
    handler: async (args: unknown) => {
      const { connectionId } = z
        .object({
          connectionId: z.string(),
        })
        .parse(args);

      try {
        const result = (await connectionManager.sendRequest(connectionId, 'tools/list')) as {
          tools?: Array<{ name?: string; description?: string }>;
        };
        const tools = result.tools || [];
        const toolList = tools
          .map((t: { name?: string; description?: string }) => `• ${t.name}: ${t.description}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `📋 Available Tools (${tools.length}):\n\n${toolList}`,
            },
          ],
        };
      } catch (error: unknown) {
        throw new Error(
          `Failed to get tool list: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  },
  {
    name: 'mcp_callTool',
    description: 'Runs a tool on the connected MCP server.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'connection ID received with mcp_connect',
        },
        toolName: {
          type: 'string',
          description: 'Name of the tool to run',
        },
        toolArguments: {
          type: 'object',
          description: 'Arguments to be sent to Tool (JSON object)',
        },
      },
      required: ['connectionId', 'toolName'],
    },
    handler: async (args: unknown) => {
      const { connectionId, toolName, toolArguments } = z
        .object({
          connectionId: z.string(),
          toolName: z.string(),
          toolArguments: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(args);

      try {
        const result = await connectionManager.sendRequest(connectionId, 'tools/call', {
          name: toolName,
          arguments: toolArguments || {},
        });

        return result;
      } catch (error: unknown) {
        throw new Error(
          `Failed to run tool: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  },
  {
    name: 'mcp_disconnect',
    description: 'Closes the MCP server connection.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'Connection ID to be closed',
        },
      },
      required: ['connectionId'],
    },
    handler: async (args: unknown) => {
      const { connectionId } = z
        .object({
          connectionId: z.string(),
        })
        .parse(args);

      try {
        await connectionManager.disconnect(connectionId);

        return {
          content: [
            {
              type: 'text',
              text: `✓ MCP connection closed: \${connectionId}`,
            },
          ],
        };
      } catch (error: unknown) {
        throw new Error(
          `Failed to close connection: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  },
  {
    name: 'mcp_listConnections',
    description: 'Lists active MCP connections.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const connections = connectionManager.listConnections();

      if (connections.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'There is no active MCP connection.',
            },
          ],
        };
      }

      const list = connections
        .map((conn) => {
          const ageMin = Math.floor(conn.age / 60000);
          const idleMin = Math.floor(conn.idle / 60000);
          return `• ${conn.id}\n  Command: ${conn.command} ${conn.args.join(' ')}\n  Age: ${ageMin}m, Idle: ${idleMin}m`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `🔗 Active Links (${connections.length}):\n\n${list}`,
          },
        ],
      };
    },
  },
  {
    name: 'mcp_catalog',
    description:
      'Lists available on-demand MCP servers from the built-in catalog. Servers with envKeys load credentials automatically. Connect via mcp_connectFromCatalog.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        const servers = listCatalogServers();
        const list = servers
          .map(
            (s) =>
              `• ${s.key} — ${s.name}\n  ${s.description}\n  Conditions:\n${s.conditions.map((c) => `    - ${c}`).join('\n')}`,
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `On-Demand MCP Catalog (${servers.length} servers):\n\n${list}`,
            },
          ],
        };
      } catch (error: unknown) {
        throw new Error(
          `Failed to load catalog: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  },
  {
    name: 'mcp_connectFromCatalog',
    description:
      'Connects to an MCP server from the built-in catalog by name. Servers with envKeys load credentials automatically from ~/.credentials.env. Use mcp_catalog to see available servers.',
    inputSchema: {
      type: 'object',
      properties: {
        serverKey: {
          type: 'string',
          description:
            'Server key from catalog (e.g., "fetch", "git", "sqlite", "duckdb", "graphify", "sequential-thinking", "time", "filesystem")',
        },
        extraArgs: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Additional arguments appended to the server command (e.g., db path for sqlite, allowed directories for filesystem)',
        },
      },
      required: ['serverKey'],
    },
    handler: async (args: unknown) => {
      const { serverKey, extraArgs } = z
        .object({
          serverKey: z.string(),
          extraArgs: z.array(z.string()).optional(),
        })
        .parse(args);

      const server = getCatalogServer(serverKey);
      if (!server) {
        const catalog = loadCatalog();
        const available = Object.keys(catalog.servers).join(', ');
        throw new Error(
          `Server "${serverKey}" not found in catalog. Available: ${available}`,
        );
      }

      const finalArgs = [...server.args, ...(extraArgs || [])];

      try {
        const env = server.envKeys?.length ? resolveEnvKeys(server.envKeys) : undefined;
        const connectionId = await connectionManager.connect(server.command, finalArgs, env);
        const envNote = env ? `\nCredentials: ${Object.keys(env).join(', ')} loaded from credentials.env` : '';
        return {
          content: [
            {
              type: 'text',
              text: `Connected to ${server.name} (${serverKey})\n\nConnection ID: ${connectionId}\nCommand: ${server.command} ${finalArgs.join(' ')}${envNote}\n\nUse mcp_listTools to see available tools, mcp_callTool to execute, mcp_disconnect when done.`,
            },
          ],
        };
      } catch (error: unknown) {
        throw new Error(
          `Failed to connect to ${server.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  },
  {
    name: 'mcp_browserConnect',
    description:
      'Starts or reuses a Playwright MCP connection through HakanMCP. Use this when you want browser automation behind the MCP client with reusable low-token wrappers.',
    inputSchema: {
      type: 'object',
      properties: {
        browser: {
          type: 'string',
          enum: ['chrome', 'firefox', 'webkit', 'msedge'],
          description: 'Browser channel to use. Defaults to chrome.',
        },
        headless: {
          type: 'boolean',
          description: 'Run the browser headless. Defaults to true.',
        },
        isolated: {
          type: 'boolean',
          description: 'Keep the browser profile in memory. Defaults to true.',
        },
        extension: {
          type: 'boolean',
          description: 'Connect via the Playwright MCP Bridge browser extension.',
        },
        cdpEndpoint: {
          type: 'string',
          description: 'Optional CDP endpoint to connect to instead of launching a new browser.',
        },
        allowedHosts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional allow-list of hosts the browser can serve from.',
        },
        outputDir: {
          type: 'string',
          description: 'Optional directory for browser session artifacts.',
        },
        snapshotMode: {
          type: 'string',
          enum: ['incremental', 'full', 'none'],
          description: 'Snapshot mode for browser responses. Defaults to incremental.',
        },
        timeoutAction: {
          type: 'number',
          description: 'Per-action timeout in milliseconds.',
        },
        timeoutNavigation: {
          type: 'number',
          description: 'Navigation timeout in milliseconds.',
        },
        profileTag: {
          type: 'string',
          description: 'Named profile tag for multi-session isolation. Each unique tag gets its own browser profile at /tmp/hakanmcp-browser/<tag>.',
        },
      },
    },
    handler: async (args: unknown) => {
      const options = z
        .object({
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
          profileTag: z.string().optional(),
        })
        .parse(args);

      const { connectionId, reused } = await ensurePlaywrightConnection(options);
      const tools = await listRemoteTools(connectionId);
      const browserTools = tools
        .map((tool) => tool.name)
        .filter((toolName): toolName is string => Boolean(toolName && toolName.startsWith('browser_')));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                reused,
                browserTools,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserNavigateExtract',
    description:
      'Navigate with Playwright through HakanMCP and return a compact browser summary instead of large raw snapshots.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to navigate to.',
        },
        connectionId: {
          type: 'string',
          description: 'Existing browser connection ID. If omitted, a Playwright connection is started or reused.',
        },
        browser: {
          type: 'string',
          enum: ['chrome', 'firefox', 'webkit', 'msedge'],
          description: 'Browser channel to use when auto-connecting.',
        },
        headless: {
          type: 'boolean',
          description: 'Run the browser headless when auto-connecting.',
        },
        isolated: {
          type: 'boolean',
          description: 'Keep the browser profile in memory when auto-connecting.',
        },
        extension: {
          type: 'boolean',
          description: 'Connect via the Playwright MCP browser extension when auto-connecting.',
        },
        cdpEndpoint: {
          type: 'string',
          description: 'Optional CDP endpoint to attach to instead of launching a new browser.',
        },
        allowedHosts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional allow-list of hosts the browser can serve from.',
        },
        outputDir: {
          type: 'string',
          description: 'Optional directory for browser session artifacts.',
        },
        snapshotMode: {
          type: 'string',
          enum: ['incremental', 'full', 'none'],
          description: 'Snapshot mode for browser responses when auto-connecting.',
        },
        timeoutAction: {
          type: 'number',
          description: 'Per-action timeout in milliseconds when auto-connecting.',
        },
        timeoutNavigation: {
          type: 'number',
          description: 'Navigation timeout in milliseconds when auto-connecting.',
        },
        screenshotPath: {
          type: 'string',
          description: 'Optional path or filename for a proof screenshot.',
        },
        maxSummaryChars: {
          type: 'number',
          description: 'Maximum characters for returned summaries. Defaults to 1600.',
        },
      },
      required: ['url'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          url: z.string().url(),
          connectionId: z.string().optional(),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
          screenshotPath: z.string().optional(),
          maxSummaryChars: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const navigateResult = await callRemoteTool(connectionId, browserTools.navigate, {
        url: parsed.url,
      });
      const navigateText = extractTextChunks(navigateResult).join('\n');

      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      let screenshotSavedTo: string | undefined;
      if (parsed.screenshotPath && browserTools.screenshot) {
        const screenshotArgs = adaptArgsForTool(browserTools.screenshot, {
          path: parsed.screenshotPath,
          filename: parsed.screenshotPath,
          type: 'png',
        });
        await callRemoteTool(connectionId, browserTools.screenshot, screenshotArgs);
        screenshotSavedTo = parsed.screenshotPath;
      }

      const combinedText = [navigateText, snapshotText].filter(Boolean).join('\n');
      const loginSignals = detectLoginSignals(combinedText);
      const maxChars = parsed.maxSummaryChars ?? 1600;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                url: parsed.url,
                pageUrl: extractPageField(navigateText, 'Page URL') ?? parsed.url,
                title: extractPageField(navigateText, 'Page Title'),
                loginSignals,
                navigateSummary: compactText(navigateText, maxChars),
                snapshotSummary: snapshotText ? summarizeSnapshot(snapshotText, maxChars) : undefined,
                screenshotSavedTo,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserProbeLogin',
    description:
      'Open a page through Playwright and return a compact login-form assessment with confidence and indicators.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to inspect for login controls.',
        },
        connectionId: {
          type: 'string',
          description: 'Existing browser connection ID.',
        },
        browser: {
          type: 'string',
          enum: ['chrome', 'firefox', 'webkit', 'msedge'],
          description: 'Browser channel to use when auto-connecting.',
        },
        headless: {
          type: 'boolean',
          description: 'Run the browser headless when auto-connecting.',
        },
        isolated: {
          type: 'boolean',
          description: 'Keep the browser profile in memory when auto-connecting.',
        },
        extension: {
          type: 'boolean',
          description: 'Connect via the Playwright MCP browser extension when auto-connecting.',
        },
        cdpEndpoint: {
          type: 'string',
          description: 'Optional CDP endpoint to attach to instead of launching a new browser.',
        },
        allowedHosts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional allow-list of hosts the browser can serve from.',
        },
        outputDir: {
          type: 'string',
          description: 'Optional directory for browser session artifacts.',
        },
        snapshotMode: {
          type: 'string',
          enum: ['incremental', 'full', 'none'],
          description: 'Snapshot mode for browser responses when auto-connecting.',
        },
        timeoutAction: {
          type: 'number',
          description: 'Per-action timeout in milliseconds when auto-connecting.',
        },
        timeoutNavigation: {
          type: 'number',
          description: 'Navigation timeout in milliseconds when auto-connecting.',
        },
        screenshotPath: {
          type: 'string',
          description: 'Optional path or filename for a screenshot of the login state.',
        },
      },
      required: ['url'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          url: z.string().url(),
          connectionId: z.string().optional(),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
          screenshotPath: z.string().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const navigateResult = await callRemoteTool(connectionId, browserTools.navigate, {
        url: parsed.url,
      });
      const navigateText = extractTextChunks(navigateResult).join('\n');
      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      let screenshotSavedTo: string | undefined;
      if (parsed.screenshotPath && browserTools.screenshot) {
        const screenshotArgs = adaptArgsForTool(browserTools.screenshot, {
          path: parsed.screenshotPath,
          filename: parsed.screenshotPath,
          type: 'png',
        });
        await callRemoteTool(connectionId, browserTools.screenshot, screenshotArgs);
        screenshotSavedTo = parsed.screenshotPath;
      }

      const probeText = [navigateText, snapshotText].filter(Boolean).join('\n');
      const loginSignals = detectLoginSignals(probeText);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                url: parsed.url,
                title: extractPageField(navigateText, 'Page Title'),
                pageUrl: extractPageField(navigateText, 'Page URL') ?? parsed.url,
                ...loginSignals,
                summary: snapshotText
                  ? summarizeSnapshot(snapshotText, 1200)
                  : compactText(navigateText, 1200),
                screenshotSavedTo,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserCaptureProof',
    description:
      'Capture a compact proof artifact through Playwright: optionally navigate, optionally wait for text, then save a screenshot with a short page summary.',
    inputSchema: {
      type: 'object',
      properties: {
        screenshotPath: {
          type: 'string',
          description: 'Path or filename for the screenshot artifact.',
        },
        url: {
          type: 'string',
          description: 'Optional URL to navigate to before capturing proof.',
        },
        waitForText: {
          type: 'string',
          description: 'Optional text to wait for before capturing.',
        },
        connectionId: {
          type: 'string',
          description: 'Existing browser connection ID.',
        },
        browser: {
          type: 'string',
          enum: ['chrome', 'firefox', 'webkit', 'msedge'],
          description: 'Browser channel to use when auto-connecting.',
        },
        headless: {
          type: 'boolean',
          description: 'Run the browser headless when auto-connecting.',
        },
        isolated: {
          type: 'boolean',
          description: 'Keep the browser profile in memory when auto-connecting.',
        },
        extension: {
          type: 'boolean',
          description: 'Connect via the Playwright MCP browser extension when auto-connecting.',
        },
        cdpEndpoint: {
          type: 'string',
          description: 'Optional CDP endpoint to attach to instead of launching a new browser.',
        },
        allowedHosts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional allow-list of hosts the browser can serve from.',
        },
        outputDir: {
          type: 'string',
          description: 'Optional directory for browser session artifacts.',
        },
        snapshotMode: {
          type: 'string',
          enum: ['incremental', 'full', 'none'],
          description: 'Snapshot mode for browser responses when auto-connecting.',
        },
        timeoutAction: {
          type: 'number',
          description: 'Per-action timeout in milliseconds when auto-connecting.',
        },
        timeoutNavigation: {
          type: 'number',
          description: 'Navigation timeout in milliseconds when auto-connecting.',
        },
      },
      required: ['screenshotPath'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          screenshotPath: z.string(),
          url: z.string().url().optional(),
          waitForText: z.string().optional(),
          connectionId: z.string().optional(),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      let navigateText = '';
      if (parsed.url) {
        const navigateResult = await callRemoteTool(connectionId, browserTools.navigate, {
          url: parsed.url,
        });
        navigateText = extractTextChunks(navigateResult).join('\n');
      }

      if (parsed.waitForText && browserTools.waitFor) {
        await callRemoteTool(connectionId, browserTools.waitFor, {
          text: parsed.waitForText,
        });
      }

      const screenshotArgs = adaptArgsForTool(browserTools.screenshot, {
        path: parsed.screenshotPath,
        filename: parsed.screenshotPath,
        type: 'png',
      });
      await callRemoteTool(connectionId, browserTools.screenshot, screenshotArgs);

      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                pageUrl: extractPageField(navigateText, 'Page URL') ?? parsed.url,
                title: extractPageField(navigateText, 'Page Title'),
                screenshotSavedTo: parsed.screenshotPath,
                summary: snapshotText
                  ? summarizeSnapshot(snapshotText, 1200)
                  : compactText(navigateText, 1200),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserClick',
    description: 'Click an element on the page by its ref attribute from the snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Browser connection ID.' },
        ref: { type: 'string', description: 'Element ref from snapshot (e.g. "e29").' },
        element: { type: 'string', description: 'Human-readable element description for logging.' },
      },
      required: ['ref'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          connectionId: z.string().optional(),
          ref: z.string(),
          element: z.string().optional(),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const result = await callRemoteTool(connectionId, browserTools.click, {
        ref: parsed.ref,
        element: parsed.element ?? `element ref=${parsed.ref}`,
      });
      const resultText = extractTextChunks(result).join('\n');

      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                action: 'click',
                ref: parsed.ref,
                result: compactText(resultText, 800),
                snapshot: snapshotText ? summarizeSnapshot(snapshotText, 1200) : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserFill',
    description: 'Fill a form field with a value by its ref attribute from the snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Browser connection ID.' },
        ref: { type: 'string', description: 'Element ref from snapshot (e.g. "e29").' },
        value: { type: 'string', description: 'Value to fill into the field.' },
        element: { type: 'string', description: 'Human-readable element description for logging.' },
      },
      required: ['ref', 'value'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          connectionId: z.string().optional(),
          ref: z.string(),
          value: z.string(),
          element: z.string().optional(),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const fillArgs: Record<string, unknown> = {
        ref: parsed.ref,
        value: parsed.value,
        element: parsed.element ?? `element ref=${parsed.ref}`,
        fields: [{ ref: parsed.ref, value: parsed.value, name: parsed.element ?? `field ref=${parsed.ref}`, type: 'textbox' }],
      };
      const result = await callRemoteTool(connectionId, browserTools.fill, fillArgs);
      const resultText = extractTextChunks(result).join('\n');

      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                action: 'fill',
                ref: parsed.ref,
                result: compactText(resultText, 800),
                snapshot: snapshotText ? summarizeSnapshot(snapshotText, 1200) : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserSequence',
    description:
      'Execute a sequence of browser steps in order: click, fill, type — any combination, any order. ' +
      'Snapshot is taken only after the last step. Ideal for login flows, multi-step forms, chained clicks.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Browser connection ID.' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['click', 'fill', 'type'], description: 'Step action.' },
              ref: { type: 'string', description: 'Element ref from snapshot.' },
              value: { type: 'string', description: 'Value to fill (fill action).' },
              text: { type: 'string', description: 'Text to type (type action).' },
              element: { type: 'string', description: 'Human-readable description.' },
              submit: { type: 'boolean', description: 'Press Enter after (type action).' },
            },
            required: ['action', 'ref'],
          },
          description: 'Ordered list of steps to execute.',
        },
      },
      required: ['steps'],
    },
    handler: async (args: unknown) => {
      const stepSchema = z.object({
        action: z.enum(['click', 'fill', 'type']),
        ref: z.string(),
        value: z.string().optional(),
        text: z.string().optional(),
        element: z.string().optional(),
        submit: z.boolean().optional(),
      });

      const parsed = z
        .object({
          connectionId: z.string().optional(),
          steps: z.array(stepSchema).min(1),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const results: Array<{ step: number; action: string; ref: string; ok: boolean; detail: string }> = [];

      for (let i = 0; i < parsed.steps.length; i++) {
        const step = parsed.steps[i];
        const label = step.element ?? `ref=${step.ref}`;
        try {
          let result;
          switch (step.action) {
            case 'fill': {
              const fillArgs: Record<string, unknown> = {
                ref: step.ref,
                value: step.value ?? '',
                element: label,
                fields: [{ ref: step.ref, value: step.value ?? '', name: label, type: 'textbox' }],
              };
              result = await callRemoteTool(connectionId, browserTools.fill, fillArgs);
              break;
            }
            case 'click': {
              result = await callRemoteTool(connectionId, browserTools.click, {
                ref: step.ref,
                element: label,
              });
              break;
            }
            case 'type': {
              const typeArgs: Record<string, unknown> = {
                ref: step.ref,
                text: step.text ?? step.value ?? '',
                element: label,
              };
              if (step.submit) typeArgs.pressEnter = true;
              result = await callRemoteTool(connectionId, browserTools.type ?? browserTools.fill, typeArgs);
              break;
            }
          }
          const text = extractTextChunks(result).join('\n');
          results.push({ step: i + 1, action: step.action, ref: step.ref, ok: true, detail: compactText(text, 150) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ step: i + 1, action: step.action, ref: step.ref, ok: false, detail: msg.substring(0, 150) });
        }
      }

      // Snapshot after last step
      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                action: 'sequence',
                totalSteps: parsed.steps.length,
                succeeded: results.filter((r) => r.ok).length,
                failed: results.filter((r) => !r.ok).length,
                results,
                snapshot: snapshotText ? summarizeSnapshot(snapshotText, 1200) : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserType',
    description: 'Type text into a focused element, optionally pressing keys like Enter or Tab.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Browser connection ID.' },
        text: { type: 'string', description: 'Text to type.' },
        ref: { type: 'string', description: 'Element ref to type into (optional, types into focused element if omitted).' },
        submit: { type: 'boolean', description: 'Press Enter after typing.' },
      },
      required: ['text'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          connectionId: z.string().optional(),
          text: z.string(),
          ref: z.string().optional(),
          submit: z.boolean().optional(),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const typeArgs: Record<string, unknown> = { text: parsed.text };
      if (parsed.ref) {
        typeArgs.ref = parsed.ref;
        typeArgs.element = `element ref=${parsed.ref}`;
      }
      if (parsed.submit) {
        typeArgs.submit = true;
      }

      const result = await callRemoteTool(connectionId, browserTools.type, typeArgs);
      const resultText = extractTextChunks(result).join('\n');

      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                action: 'type',
                result: compactText(resultText, 800),
                snapshot: snapshotText ? summarizeSnapshot(snapshotText, 1200) : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserPressKey',
    description: 'Press a keyboard key in the browser (Enter, ArrowDown, Escape, Tab, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Browser connection ID.' },
        key: { type: 'string', description: 'Key to press (e.g. "Enter", "ArrowDown", "Escape", "Tab").' },
      },
      required: ['key'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          connectionId: z.string().optional(),
          key: z.string(),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const result = await callRemoteTool(connectionId, browserTools.pressKey, { key: parsed.key });
      const resultText = extractTextChunks(result).join('\n');

      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                action: 'pressKey',
                key: parsed.key,
                result: compactText(resultText, 800),
                snapshot: snapshotText ? summarizeSnapshot(snapshotText, 1200) : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserEvaluate',
    description: 'Evaluate a JavaScript function in the browser page context.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Browser connection ID.' },
        function: {
          type: 'string',
          description: 'JS function string to evaluate, e.g. "() => document.title".',
        },
        element: {
          type: 'string',
          description: 'Human-readable element description (optional, for element-scoped evaluation).',
        },
        ref: {
          type: 'string',
          description: 'Element ref from snapshot (optional, for element-scoped evaluation).',
        },
      },
      required: ['function'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          connectionId: z.string().optional(),
          function: z.string(),
          element: z.string().optional(),
          ref: z.string().optional(),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const evalArgs: Record<string, unknown> = { function: parsed.function };
      if (parsed.ref) {
        evalArgs.ref = parsed.ref;
        evalArgs.element = parsed.element ?? `element ref=${parsed.ref}`;
      } else if (parsed.element) {
        evalArgs.element = parsed.element;
      }

      const result = await callRemoteTool(connectionId, browserTools.evaluate, evalArgs);
      const resultText = extractTextChunks(result).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                action: 'evaluate',
                result: compactText(resultText, 2000),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserSelectOption',
    description: 'Select one or more options in a <select> element.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Browser connection ID.' },
        ref: { type: 'string', description: 'Element ref from snapshot (required).' },
        values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Option values to select (supports multi-select).',
        },
      },
      required: ['ref', 'values'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          connectionId: z.string().optional(),
          ref: z.string(),
          values: z.array(z.string()),
          browser: z.enum(['chrome', 'firefox', 'webkit', 'msedge']).optional(),
          headless: z.boolean().optional(),
          isolated: z.boolean().optional(),
          extension: z.boolean().optional(),
          cdpEndpoint: z.string().optional(),
          allowedHosts: z.array(z.string()).optional(),
          outputDir: z.string().optional(),
          snapshotMode: z.enum(['incremental', 'full', 'none']).optional(),
          timeoutAction: z.number().int().positive().optional(),
          timeoutNavigation: z.number().int().positive().optional(),
        })
        .parse(args);

      const { connectionId } = await ensurePlaywrightConnection(parsed);
      const tools = await listRemoteTools(connectionId);
      const browserTools = getBrowserToolSet(tools);

      const selectArgs: Record<string, unknown> = {
        element: `element ref=${parsed.ref}`,
        ref: parsed.ref,
        values: parsed.values,
      };

      const result = await callRemoteTool(connectionId, browserTools.selectOption, selectArgs);
      const resultText = extractTextChunks(result).join('\n');

      let snapshotText = '';
      if (browserTools.snapshot) {
        const snapshotResult = await callRemoteTool(connectionId, browserTools.snapshot);
        snapshotText = extractTextChunks(snapshotResult).join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connectionId,
                action: 'selectOption',
                ref: parsed.ref,
                values: parsed.values,
                result: compactText(resultText, 800),
                snapshot: snapshotText ? summarizeSnapshot(snapshotText, 1200) : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: 'mcp_browserDisconnect',
    description:
      'Closes one browser MCP connection or all cached Playwright browser connections managed by HakanMCP.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'Optional browser connection ID. If omitted, all cached browser connections are closed.',
        },
      },
    },
    handler: async (args: unknown) => {
      const { connectionId } = z
        .object({
          connectionId: z.string().optional(),
        })
        .parse(args);

      if (connectionId) {
        await connectionManager.disconnect(connectionId);
        removeCachedBrowserConnection(connectionId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ disconnected: [connectionId] }, null, 2),
            },
          ],
        };
      }

      const connectionIds = [...new Set(browserConnectionCache.values())];
      await Promise.all(connectionIds.map((id) => connectionManager.disconnect(id)));
      browserConnectionCache.clear();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ disconnected: connectionIds }, null, 2),
          },
        ],
      };
    },
  },
];

// ── Consolidated action-dispatched exports ──────────────────────────────────

function _findLegacyHandler(name: string) {
  const tool = _mcpLegacyTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Internal error: legacy tool not found: ${name}`);
  return tool.handler;
}

export const mcpClientTools = [
  {
    name: 'mcp',
    description:
      'MCP client operations. Actions: connect, listTools, callTool, disconnect, listConnections, catalog, connectFromCatalog.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['connect', 'listTools', 'callTool', 'disconnect', 'listConnections', 'catalog', 'connectFromCatalog'],
          description: 'Operation to perform',
        },
        command: { type: 'string', description: "Command to start MCP server (connect action)" },
        args: { type: 'array', items: { type: 'string' }, description: 'Command arguments (connect action)' },
        env: { type: 'object', description: 'Environment variables for MCP server (connect action)', additionalProperties: { type: 'string' } },
        connectionId: { type: 'string', description: 'Connection ID (listTools/callTool/disconnect actions)' },
        toolName: { type: 'string', description: 'Name of the tool to run (callTool action)' },
        toolArguments: { type: 'object', description: 'Arguments to send to tool (callTool action)' },
        serverKey: { type: 'string', description: 'Server key from catalog (connectFromCatalog action)' },
        extraArgs: { type: 'array', items: { type: 'string' }, description: 'Additional arguments (connectFromCatalog action)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action } = z.object({ action: z.enum(['connect', 'listTools', 'callTool', 'disconnect', 'listConnections', 'catalog', 'connectFromCatalog']) }).parse(args);
      switch (action) {
        case 'connect': return _findLegacyHandler('mcp_connect')(args);
        case 'listTools': return _findLegacyHandler('mcp_listTools')(args);
        case 'callTool': return _findLegacyHandler('mcp_callTool')(args);
        case 'disconnect': return _findLegacyHandler('mcp_disconnect')(args);
        case 'listConnections': return _findLegacyHandler('mcp_listConnections')(args);
        case 'catalog': return _findLegacyHandler('mcp_catalog')(args);
        case 'connectFromCatalog': return _findLegacyHandler('mcp_connectFromCatalog')(args);
      }
    },
  },
  {
    name: 'browser',
    description:
      'Browser automation. Actions: connect, navigateExtract, click, fill, sequence, type, pressKey, evaluate, selectOption, probeLogin, captureProof, disconnect.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['connect', 'navigateExtract', 'click', 'fill', 'sequence', 'type', 'pressKey', 'evaluate', 'selectOption', 'probeLogin', 'captureProof', 'disconnect'],
          description: 'Operation to perform',
        },
        browser: { type: 'string', enum: ['chrome', 'firefox', 'webkit', 'msedge'], description: 'Browser channel' },
        headless: { type: 'boolean', description: 'Run headless' },
        isolated: { type: 'boolean', description: 'Keep profile in memory (default: false, persistent)' },
        userDataDir: { type: 'string', description: 'Path for persistent browser profile' },
        extension: { type: 'boolean', description: 'Connect via browser extension' },
        cdpEndpoint: { type: 'string', description: 'CDP endpoint to connect to' },
        allowedHosts: { type: 'array', items: { type: 'string' }, description: 'Allowed hosts' },
        outputDir: { type: 'string', description: 'Directory for session artifacts' },
        snapshotMode: { type: 'string', enum: ['incremental', 'full', 'none'], description: 'Snapshot mode' },
        timeoutAction: { type: 'number', description: 'Per-action timeout ms' },
        timeoutNavigation: { type: 'number', description: 'Navigation timeout ms' },
        connectionId: { type: 'string', description: 'Existing browser connection ID' },
        profileTag: { type: 'string', description: 'Named profile tag for multi-session isolation (connect action)' },
        url: { type: 'string', description: 'URL to navigate to (navigateExtract/probeLogin/captureProof)' },
        screenshotPath: { type: 'string', description: 'Path for screenshot (navigateExtract/captureProof)' },
        maxSummaryChars: { type: 'number', description: 'Max chars for summaries (navigateExtract)' },
        waitForText: { type: 'string', description: 'Text to wait for before capturing (captureProof)' },
        ref: { type: 'string', description: 'Element ref from snapshot (click/fill/type)' },
        value: { type: 'string', description: 'Value to fill (fill action)' },
        text: { type: 'string', description: 'Text to type (type action)' },
        element: { type: 'string', description: 'Human-readable element description (click/fill)' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['click', 'fill', 'type'] },
              ref: { type: 'string' },
              value: { type: 'string' },
              text: { type: 'string' },
              element: { type: 'string' },
              submit: { type: 'boolean' },
            },
            required: ['action', 'ref'],
          },
          description: 'Ordered steps for sequence action (e.g. fill+fill+click)',
        },
        submit: { type: 'boolean', description: 'Press Enter after typing (type action)' },
        key: { type: 'string', description: 'Key to press (Enter, ArrowDown, Escape, etc.) (pressKey action)' },
        function: { type: 'string', description: 'JS function to evaluate, e.g. "() => document.title" (evaluate action)' },
        values: { type: 'array', items: { type: 'string' }, description: 'Option values to select, supports multi-select (selectOption action)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action } = z.object({ action: z.enum(['connect', 'navigateExtract', 'click', 'fill', 'sequence', 'type', 'pressKey', 'evaluate', 'selectOption', 'probeLogin', 'captureProof', 'disconnect']) }).parse(args);
      switch (action) {
        case 'connect': return _findLegacyHandler('mcp_browserConnect')(args);
        case 'navigateExtract': return _findLegacyHandler('mcp_browserNavigateExtract')(args);
        case 'click': return _findLegacyHandler('mcp_browserClick')(args);
        case 'fill': return _findLegacyHandler('mcp_browserFill')(args);
        case 'sequence': return _findLegacyHandler('mcp_browserSequence')(args);
        case 'type': return _findLegacyHandler('mcp_browserType')(args);
        case 'pressKey': return _findLegacyHandler('mcp_browserPressKey')(args);
        case 'evaluate': return _findLegacyHandler('mcp_browserEvaluate')(args);
        case 'selectOption': return _findLegacyHandler('mcp_browserSelectOption')(args);
        case 'probeLogin': return _findLegacyHandler('mcp_browserProbeLogin')(args);
        case 'captureProof': return _findLegacyHandler('mcp_browserCaptureProof')(args);
        case 'disconnect': return _findLegacyHandler('mcp_browserDisconnect')(args);
      }
    },
  },
];
