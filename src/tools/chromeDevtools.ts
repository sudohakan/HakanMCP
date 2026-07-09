/**
 * Chrome DevTools MCP proxy
 *
 * Wraps chrome-devtools-mcp@latest as a lazy-spawned stdio child process.
 * Tools are exposed under the `chrome_*` prefix on HakanMCP's surface.
 *
 * Lifecycle:
 *  - Child spawned on first chrome_* call (npx -y chrome-devtools-mcp@latest)
 *  - JSON-RPC initialize handshake, persistent across calls (page state preserved)
 *  - Idle disconnect after 5 minutes of no activity
 *
 * Configuration (env):
 *  - CHROME_DEVTOOLS_BROWSER_URL — attach to existing CDP endpoint (e.g. http://127.0.0.1:9222)
 *    When unset, chrome-devtools-mcp launches a fresh Chrome instance.
 */
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { processRegistry } from '../utils/processRegistry.js';
import { logger } from '../utils/logger.js';
import type { ToolDefinition, ToolResponse } from '../types/index.js';
import upstreamCatalog from './chromeDevtools.tools.json' with { type: 'json' };

const PREFIX = 'chrome';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
// Per-tool request timeout. chrome-devtools-mcp processes requests serially over
// stdio, so a single wedged request (CDP call on a busy/recompiling page) blocks
// every subsequent call — a cascade of client timeouts. Interactive tools get a
// short ceiling so a wedge is detected fast and the child is reset (see callTool);
// genuinely slow tools (lighthouse, perf traces, navigation/waits) keep a long one.
const REQUEST_TIMEOUT_MS = 25 * 1000; // fast/interactive default
const SLOW_REQUEST_TIMEOUT_MS = 120 * 1000; // page-load + audit + trace tools
const SLOW_TOOLS = new Set<string>([
  'navigate_page',
  'new_page',
  'wait_for',
  'performance_start_trace',
  'performance_stop_trace',
  'performance_analyze_insight',
  'lighthouse_audit',
  'take_memory_snapshot',
]);
const SPAWN_TIMEOUT_MS = 60 * 1000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

class ChromeDevtoolsClient {
  private child: ChildProcess | null = null;
  private connected = false;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuffer = '';
  private connectPromise: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  async callTool(upstreamName: string, args: unknown): Promise<ToolResponse> {
    await this.ensureConnected();
    if (!this.child || !this.connected) {
      throw new Error('chrome-devtools-mcp not connected after init');
    }
    this.touchIdle();

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: upstreamName, arguments: args ?? {} },
    };

    const timeoutMs = SLOW_TOOLS.has(upstreamName) ? SLOW_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;

    return new Promise<ToolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`chrome_${upstreamName} timeout (${timeoutMs}ms)`));
        // Serial-stdio child is now wedged on this request; leaving it alive makes
        // every subsequent call queue behind the stuck one (cascade timeout). Reset
        // so the next callTool respawns a fresh child. In attach mode the persistent
        // Chrome is untouched (we only kill the proxy child, not the browser).
        this.resetChild(new Error(`chrome_${upstreamName} timed out — resetting proxy child`));
      }, timeoutMs);
      const timerRef = timer as NodeJS.Timeout & { unref?: () => void };
      timerRef.unref?.();

      this.pending.set(id, {
        resolve: (value: unknown) => resolve(value as ToolResponse),
        reject,
        timer,
      });

      try {
        this.child!.stdin!.write(JSON.stringify(request) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected && this.child) return;
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    this.connectPromise = this.spawnAndInit();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private spawnAndInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['-y', 'chrome-devtools-mcp@latest'];
      const browserUrl = process.env.CHROME_DEVTOOLS_BROWSER_URL?.trim();
      const persistProfile = process.env.CHROME_DEVTOOLS_PERSIST_PROFILE === '1';
      if (browserUrl) {
        args.push('--browser-url', browserUrl);
      } else if (!persistProfile) {
        args.push('--isolated');
      }

      logger.info('Spawning chrome-devtools-mcp', {
        mode: browserUrl ? 'attach' : persistProfile ? 'persistent-profile' : 'isolated',
        browserUrl: browserUrl ?? null,
      });

      // Resolve absolute npx path. When HakanMCP runs under a parent process
      // whose PATH puts Bun first (~/.bun/bin), bare `npx` is Bun's wrapper
      // which fails to launch chrome-devtools-mcp's stdio MCP server (exit
      // code 7). Fall back to /usr/local/bin/npx (npm's npx) when present;
      // otherwise let the OS resolve `npx` from PATH.
      const npxCommand = existsSync('/usr/local/bin/npx') ? '/usr/local/bin/npx' : 'npx';

      let child: ChildProcess;
      try {
        // cwd: '/tmp' — HakanMCP may be invoked with an inherited cwd that no
        // longer exists (deleted dir, symlink rotated). The child throws
        // ENOENT in uv_cwd at startup, exits before initialize, looks like a
        // 60s timeout. Pinning to /tmp guarantees a valid working dir.
        child = processRegistry.track(
          spawn(npxCommand, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            cwd: '/tmp',
          }),
          'chrome-devtools-mcp',
        );
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.child = child;

      const spawnTimer = setTimeout(() => {
        logger.warn('chrome-devtools-mcp init timeout', { ms: SPAWN_TIMEOUT_MS });
        this.cleanup(new Error(`chrome-devtools-mcp init timeout (${SPAWN_TIMEOUT_MS}ms)`));
        reject(new Error(`chrome-devtools-mcp init timeout (${SPAWN_TIMEOUT_MS}ms)`));
      }, SPAWN_TIMEOUT_MS);
      const spawnTimerRef = spawnTimer as NodeJS.Timeout & { unref?: () => void };
      spawnTimerRef.unref?.();

      if (!child.stdout || !child.stdin) {
        clearTimeout(spawnTimer);
        this.cleanup(new Error('chrome-devtools-mcp stdio not available'));
        reject(new Error('chrome-devtools-mcp stdio not available'));
        return;
      }

      child.stdout.on('data', (data: Buffer) => this.handleStdout(data, spawnTimer, resolve));
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        if (text.trim()) {
          logger.debug('chrome-devtools-mcp stderr', { data: text.slice(0, 500) });
        }
      });
      child.on('error', (err: Error) => {
        clearTimeout(spawnTimer);
        logger.error('chrome-devtools-mcp spawn error', err);
        this.cleanup(err);
        reject(err);
      });
      child.on('exit', (code) => {
        logger.info('chrome-devtools-mcp exited', { code });
        this.cleanup(new Error(`chrome-devtools-mcp exited with code ${code}`));
      });

      const initRequest = {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hakanmcp-chrome-proxy', version: '1.0' },
        },
      };
      try {
        child.stdin.write(JSON.stringify(initRequest) + '\n');
      } catch (err) {
        clearTimeout(spawnTimer);
        const error = err instanceof Error ? err : new Error(String(err));
        this.cleanup(error);
        reject(error);
      }
    });
  }

  private handleStdout(
    data: Buffer,
    spawnTimer: NodeJS.Timeout,
    resolveInit: () => void,
  ): void {
    this.stdoutBuffer += data.toString();
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;

      let json: JsonRpcMessage;
      try {
        json = JSON.parse(trimmed) as JsonRpcMessage;
      } catch {
        continue;
      }

      if (!this.connected && json.id === 0 && json.result !== undefined) {
        this.connected = true;
        clearTimeout(spawnTimer);
        try {
          this.child?.stdin?.write(
            JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
          );
        } catch (err) {
          logger.warn('chrome-devtools-mcp notifications/initialized write failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        this.touchIdle();
        logger.info('chrome-devtools-mcp connected');
        resolveInit();
        continue;
      }

      if (typeof json.id === 'number' && this.pending.has(json.id)) {
        const entry = this.pending.get(json.id)!;
        this.pending.delete(json.id);
        clearTimeout(entry.timer);
        if (json.error) {
          entry.reject(new Error(json.error.message || 'chrome-devtools-mcp error'));
        } else {
          entry.resolve(json.result);
        }
      }
    }
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      logger.info('chrome-devtools-mcp idle disconnect');
      this.disconnect();
    }, IDLE_TIMEOUT_MS);
    const idleRef = this.idleTimer as NodeJS.Timeout & { unref?: () => void };
    idleRef.unref?.();
  }

  private disconnect(): void {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {
      // already gone
    }
    this.cleanup(new Error('chrome-devtools-mcp disconnected (idle)'));
    killOrphanChromeProfile();
  }

  // Force-reset the wedged proxy child after a request timeout. Kills the child
  // (respawned lazily on the next callTool) and rejects any still-pending requests
  // so a single stuck CDP call cannot cascade into serial-queue timeouts. Attach
  // mode: only the chrome-devtools-mcp child dies, the persistent Chrome survives.
  private resetChild(reason: Error): void {
    const stuck = this.child;
    if (stuck) {
      try {
        stuck.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    logger.warn('chrome-devtools-mcp proxy child reset after timeout', { reason: reason.message });
    this.cleanup(reason);
    killOrphanChromeProfile();
  }

  private cleanup(reason: Error): void {
    this.connected = false;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
    this.stdoutBuffer = '';
    this.child = null;
  }
}

function killOrphanChromeProfile(): void {
  if (process.platform === 'win32') return;
  try {
    spawnSync('pkill', ['-f', 'chrome-devtools-mcp/chrome-profile'], {
      stdio: 'ignore',
      timeout: 3000,
    });
  } catch {
    // best-effort cleanup; ignore failures
  }
}

const client = new ChromeDevtoolsClient();

interface UpstreamTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const upstreamTools = upstreamCatalog as unknown as UpstreamTool[];

export const chromeDevtoolsTools: ToolDefinition[] = upstreamTools.map((upstream) => ({
  name: `${PREFIX}_${upstream.name}`,
  description:
    (upstream.description?.trim() || `chrome-devtools-mcp ${upstream.name}`) +
    ' [proxy: chrome-devtools-mcp; lazy-spawn via npx; CHROME_DEVTOOLS_BROWSER_URL env attaches to existing CDP]',
  inputSchema:
    upstream.inputSchema && upstream.inputSchema.type === 'object'
      ? upstream.inputSchema
      : { type: 'object' as const, properties: {} },
  handler: async (args: unknown): Promise<ToolResponse> =>
    client.callTool(upstream.name, args),
}));
