import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';
import { logger } from '../utils/logger.js';
import { processRegistry } from '../utils/processRegistry.js';

type SpawnFunction = (
  command: string,
  args: readonly string[],
  options?: Record<string, unknown>,
) => ChildProcess;

export interface MCPConnection {
  id: string;
  process: ChildProcess;
  command: string;
  args: string[];
  connected: boolean;
  lastUsed: number;
  created: number;
  requestId: number;
}

interface MCPConnectionManagerOptions {
  maxConnections?: number;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  spawnFn?: SpawnFunction;
  idGenerator?: () => string;
  now?: () => number;
}

const defaultIdGenerator = () => `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const defaultNow = () => Date.now();

export class MCPConnectionManager {
  private connections = new Map<string, MCPConnection>();
  private maxConnections: number;
  private connectionTimeout: number;
  private requestTimeout: number;
  private spawnFn: SpawnFunction;
  private idGenerator: () => string;
  private now: () => number;

  constructor(options: MCPConnectionManagerOptions = {}) {
    this.maxConnections = options.maxConnections ?? 5;
    this.connectionTimeout = options.connectionTimeoutMs ?? 30000;
    this.requestTimeout = options.requestTimeoutMs ?? 60000;
    this.spawnFn = options.spawnFn ?? spawn;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? defaultNow;
  }

  /**
   * Create a new connection to an MCP server
   */
  async connect(command: string, args: string[], env?: Record<string, string>): Promise<string> {
    if (this.connections.size >= this.maxConnections) {
      throw new Error(`Maximum connections (${this.maxConnections}) reached`);
    }

    const connectionId = this.idGenerator();

    // Resolve absolute path for `npx`/`uvx` when the parent PATH puts a wrapper
    // (e.g. Bun's npx) ahead of the actual launcher. Bun's npx fails to spawn
    // stdio MCP servers with exit code 7. Fall back to /usr/local/bin or
    // /usr/bin when the wrapper is detected.
    let resolvedCommand = command;
    if (process.platform !== 'win32' && (command === 'npx' || command === 'uvx')) {
      const candidates = [`/usr/local/bin/${command}`, `/usr/bin/${command}`];
      for (const candidate of candidates) {
        try {
          if (require('fs').existsSync(candidate)) {
            resolvedCommand = candidate;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    logger.info('Creating MCP connection', { connectionId, command: resolvedCommand, args });

    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const child = processRegistry.track(
        this.spawnFn(resolvedCommand, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: isWindows,
          cwd: '/tmp',
          ...(env && { env: { ...process.env, ...env } }),
        }),
        `mcp-${command}`,
      );

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      const timeoutRef = timeout as NodeJS.Timeout & { unref?: () => void };
      if (typeof timeoutRef.unref === 'function') {
        timeoutRef.unref();
      }

      let connected = false;
      let stdoutBuffer = '';

      if (!child.stdout || !child.stdin) {
        clearTimeout(timeout);
        child.kill();
        reject(new Error('MCP server stdio not available'));
        return;
      }

      const handleResponse = (data: Buffer) => {
        stdoutBuffer += data.toString();

        const lines = stdoutBuffer.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line && line.includes('{')) {
            try {
              const json = JSON.parse(line);
              if (!connected && json.id === 0 && json.result) {
                connected = true;
                clearTimeout(timeout);

                const notification = { jsonrpc: '2.0', method: 'notifications/initialized' };
                child.stdin!.write(JSON.stringify(notification) + '\n');

                const timestamp = this.now();
                const connection: MCPConnection = {
                  id: connectionId,
                  process: child,
                  command,
                  args,
                  connected: true,
                  lastUsed: timestamp,
                  created: timestamp,
                  requestId: 1,
                };

                this.connections.set(connectionId, connection);
                child.stdout!.removeListener('data', handleResponse);
                logger.info('MCP connection established', { connectionId });
                resolve(connectionId);
              }
            } catch { /* empty */
            }
          }
        }

        stdoutBuffer = lines[lines.length - 1];
      };

      child.stdout.on('data', handleResponse);

      child.stderr?.on('data', (data) => {
        logger.debug('MCP server stderr', { connectionId, data: data.toString() });
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        logger.error('MCP connection error', error, { connectionId });
        reject(error);
      });

      child.on('exit', (code) => {
        logger.info('MCP connection closed', { connectionId, code });
        this.connections.delete(connectionId);
      });

      const initRequest = {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'HakanMCP', version: '1.0.0' },
        },
      };
      child.stdin.write(JSON.stringify(initRequest) + '\n');
    });
  }

  /**
   * Send a JSON-RPC request to an MCP server
   */
  async sendRequest(
    connectionId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected) {
      throw new Error(`Connection ${connectionId} not found or not connected`);
    }

    connection.lastUsed = this.now();
    const requestId = connection.requestId++;

    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      ...(params && { params }),
    };

    logger.debug('Sending MCP request', { connectionId, method, requestId });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, this.requestTimeout);

      const timeoutRef = timeout as NodeJS.Timeout & { unref?: () => void };
      if (typeof timeoutRef.unref === 'function') {
        timeoutRef.unref();
      }

      let responseBuffer = '';

      const onData = (data: Buffer) => {
        responseBuffer += data.toString();

        const lines = responseBuffer.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line && line.includes('{')) {
            try {
              const response = JSON.parse(line);
              if (response.id === requestId) {
                clearTimeout(timeout);
                connection.process.stdout?.removeListener('data', onData);

                if (response.error) {
                  reject(new Error(response.error.message || 'MCP request failed'));
                } else {
                  resolve(response.result);
                }
                return;
              }
            } catch { /* empty */
            }
          }
        }

        responseBuffer = lines[lines.length - 1];
      };

      if (!connection.process.stdout || !connection.process.stdin) {
        throw new Error('Process streams not available');
      }

      connection.process.stdout.on('data', onData);

      connection.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    logger.info('Disconnecting MCP connection', { connectionId });

    return new Promise((resolve) => {
      const cleanup = () => {
        this.connections.delete(connectionId);
        resolve();
      };

      const onExit = () => {
        cleanup();
        connection.process.removeListener('exit', onExit);
        if (forceKill) {
          clearTimeout(forceKill);
        }
      };

      connection.process.once('exit', onExit);
      connection.process.kill();

      const forceKill = setTimeout(() => {
        if (this.connections.has(connectionId)) {
          connection.process.kill('SIGKILL');
          cleanup();
        }
      }, 5000);

      const forceKillRef = forceKill as NodeJS.Timeout & { unref?: () => void };
      if (typeof forceKillRef.unref === 'function') {
        forceKillRef.unref();
      }
    });
  }

  /**
   * Get connection info
   */
  getConnection(connectionId: string): MCPConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * List all connections
   */
  listConnections(): Array<{
    id: string;
    command: string;
    args: string[];
    age: number;
    idle: number;
  }> {
    const now = this.now();
    return Array.from(this.connections.values()).map((conn) => ({
      id: conn.id,
      command: conn.command,
      args: conn.args,
      age: now - conn.created,
      idle: now - conn.lastUsed,
    }));
  }

  /**
   * Disconnect all connections
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map((id) => this.disconnect(id));
    await Promise.all(promises);
  }
}

export const connectionManager = new MCPConnectionManager();
