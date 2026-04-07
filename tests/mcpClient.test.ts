import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

class MockChildProcess extends EventEmitter {
  public stdout: (EventEmitter & NodeJS.ReadableStream) | null;
  public stderr: (EventEmitter & NodeJS.ReadableStream) | null;
  public stdin: NodeJS.WritableStream | null;
  public kill: jest.Mock;

  constructor(options: { withStdout?: boolean } = {}) {
    super();
    this.stdout =
      options.withStdout === false ? null : (new EventEmitter() as NodeJS.ReadableStream);
    this.stderr = new EventEmitter() as NodeJS.ReadableStream;
    const stdinEmitter = new EventEmitter() as NodeJS.WritableStream;
    (stdinEmitter as unknown as { write: ReturnType<typeof jest.fn> }).write = jest.fn();
    this.stdin = stdinEmitter;
    this.kill = jest.fn(() => {
      this.emit('exit', 0);
      return true;
    });
  }
}

type MCPConnectionManagerConstructor = typeof import('../src/tools/mcpClient').MCPConnectionManager;

type ManagerHarness = {
  manager: InstanceType<MCPConnectionManagerConstructor>;
  processes: MockChildProcess[];
  spawnMock: jest.Mock;
  advanceTime: (delta: number) => void;
};

const loadManagerConstructor = async (): Promise<MCPConnectionManagerConstructor> => {
  jest.resetModules();
  await jest.unstable_mockModule('../src/utils/logger.js', () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));
  const mod = await import('../src/tools/mcpClient');
  return mod.MCPConnectionManager;
};

const createManagerHarness = async (options?: {
  maxConnections?: number;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  processFactory?: () => MockChildProcess;
}): Promise<ManagerHarness> => {
  const MCPConnectionManager = await loadManagerConstructor();
  let currentTime = 1_000;
  let idCounter = 0;
  const processes: MockChildProcess[] = [];
  const spawnMock = jest.fn(() => {
    const processFactory = options?.processFactory ?? (() => new MockChildProcess());
    const proc = processFactory();
    processes.push(proc);
    return proc as unknown as ChildProcess;
  });

  const manager = new MCPConnectionManager({
    spawnFn: spawnMock,
    maxConnections: options?.maxConnections,
    connectionTimeoutMs: options?.connectionTimeoutMs,
    requestTimeoutMs: options?.requestTimeoutMs,
    idGenerator: () => {
      idCounter += 1;
      return `mcp-test-${idCounter}`;
    },
    now: () => currentTime,
  });

  return {
    manager,
    processes,
    spawnMock,
    advanceTime: (delta: number) => {
      currentTime += delta;
    },
  };
};

const emitJsonLine = (proc: MockChildProcess, payload: Record<string, unknown>) => {
  proc.stdout?.emit('data', Buffer.from(JSON.stringify(payload) + '\n'));
};

const connectAndReady = async (harness: ManagerHarness) => {
  const connectPromise = harness.manager.connect('node', ['mcp-server.js']);
  const proc = harness.processes[harness.processes.length - 1];
  emitJsonLine(proc, { jsonrpc: '2.0', id: 0, result: { ready: true } });
  const connectionId = await connectPromise;
  return { connectionId, proc };
};

describe('MCPConnectionManager', () => {
  it('establishes connections and tracks metadata', async () => {
    const harness = await createManagerHarness();
    const { connectionId } = await connectAndReady(harness);

    expect(connectionId).toBe('mcp-test-1');

    harness.advanceTime(60000);
    const connections = harness.manager.listConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0].age).toBe(60000);
    expect(connections[0].idle).toBe(60000);
  });

  it('enforces maximum concurrent connections', async () => {
    const harness = await createManagerHarness({ maxConnections: 1 });
    await connectAndReady(harness);
    await expect(harness.manager.connect('node', ['foo.mjs'])).rejects.toThrow(
      /Maximum connections/,
    );
  });

  it('sends JSON-RPC requests and returns responses', async () => {
    const harness = await createManagerHarness();
    const { connectionId, proc } = await connectAndReady(harness);

    const response = harness.manager.sendRequest(connectionId, 'tools/list', { limit: 1 });
    const stdoutWrite = (proc.stdin as unknown as { write: jest.Mock }).write;

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"method":"tools/list"'));

    emitJsonLine(proc, { jsonrpc: '2.0', id: 1, result: { ok: true } });
    await expect(response).resolves.toEqual({ ok: true });
  });

  it('rejects when remote returns an error response', async () => {
    const harness = await createManagerHarness();
    const { connectionId, proc } = await connectAndReady(harness);

    const response = harness.manager.sendRequest(connectionId, 'tools/error');
    emitJsonLine(proc, { jsonrpc: '2.0', id: 1, error: { message: 'boom' } });

    await expect(response).rejects.toThrow('boom');
  });

  it('rejects timed out requests', async () => {
    const harness = await createManagerHarness({ requestTimeoutMs: 5 });
    const { connectionId } = await connectAndReady(harness);
    await expect(harness.manager.sendRequest(connectionId, 'tools/slow')).rejects.toThrow(
      'Request timeout',
    );
  });

  it('disconnects connections and clears state', async () => {
    const harness = await createManagerHarness();
    const { connectionId, proc } = await connectAndReady(harness);

    await harness.manager.disconnect(connectionId);

    expect(proc.kill).toHaveBeenCalled();
    expect(harness.manager.listConnections()).toHaveLength(0);
  });

  it('disconnects all active connections', async () => {
    const harness = await createManagerHarness();
    const first = await connectAndReady(harness);
    const second = await connectAndReady(harness);

    await harness.manager.disconnectAll();

    expect(first.proc.kill).toHaveBeenCalled();
    expect(second.proc.kill).toHaveBeenCalled();
    expect(harness.manager.listConnections()).toHaveLength(0);
  });

  it('fails to connect when stdout is missing', async () => {
    const harness = await createManagerHarness({
      processFactory: () => new MockChildProcess({ withStdout: false }),
    });

    await expect(harness.manager.connect('node', ['broken'])).rejects.toThrow(/stdio|stdout/);
  });

  it('times out hanging connections', async () => {
    const harness = await createManagerHarness({ connectionTimeoutMs: 5 });
    const connectPromise = harness.manager.connect('node', ['never-ready']);
    const proc = harness.processes[harness.processes.length - 1];

    await expect(connectPromise).rejects.toThrow('Connection timeout');
    expect(proc.kill).toHaveBeenCalled();
  });

  it.each([
    ['missing connection', async (_h: ManagerHarness) => 'no-such-connection'],
    [
      'disconnected connection',
      async (h: ManagerHarness) => {
        const { connectionId } = await connectAndReady(h);
        const connection = h.manager.getConnection(connectionId);
        if (connection) {
          connection.connected = false;
        }
        return connectionId;
      },
    ],
  ])('sendRequest guards %s', async (_label, setup) => {
    const harness = await createManagerHarness();
    const connectionId = await setup(harness);
    await expect(harness.manager.sendRequest(connectionId, 'tools/ping')).rejects.toThrow(
      /not found or not connected/,
    );
  });

  it('throws when process streams are unavailable', async () => {
    const harness = await createManagerHarness();
    const { connectionId } = await connectAndReady(harness);
    const connection = harness.manager.getConnection(connectionId);
    if (connection) {
      (connection.process as { stdout: unknown }).stdout = null;
    }

    await expect(harness.manager.sendRequest(connectionId, 'tools/ping')).rejects.toThrow(
      'Process streams not available',
    );
  });
});

const loadMcpClientModule = async () => {
  jest.resetModules();
  await jest.unstable_mockModule('../src/utils/logger.js', () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));
  return import('../src/tools/mcpClient');
};

describe('mcp browser wrapper tools', () => {
  it('reuses cached playwright connections for identical browser options', async () => {
    const mod = await loadMcpClientModule();
    const connectSpy = jest
      .spyOn(mod.connectionManager, 'connect')
      .mockResolvedValue('browser-1');
    jest
      .spyOn(mod.connectionManager, 'getConnection')
      .mockReturnValue({ connected: true } as never);
    const sendRequestSpy = jest.spyOn(mod.connectionManager, 'sendRequest').mockResolvedValue({
      tools: [{ name: 'browser_navigate' }, { name: 'browser_snapshot' }],
    });

    const tool = mod.mcpClientTools.find((entry) => entry.name === 'mcp_browserConnect');
    expect(tool).toBeDefined();

    await tool!.handler({ browser: 'chrome', headless: true, isolated: true });
    await tool!.handler({ browser: 'chrome', headless: true, isolated: true });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(sendRequestSpy).toHaveBeenCalledWith('browser-1', 'tools/list');
  });

  it('returns a compact browser summary for navigate-extract', async () => {
    const mod = await loadMcpClientModule();
    jest.spyOn(mod.connectionManager, 'connect').mockResolvedValue('browser-2');
    const sendRequestSpy = jest.spyOn(mod.connectionManager, 'sendRequest');
    sendRequestSpy
      .mockResolvedValueOnce({
        tools: [
          { name: 'browser_navigate', inputSchema: { properties: { url: { type: 'string' } } } },
          { name: 'browser_snapshot', inputSchema: { properties: {} } },
          {
            name: 'browser_take_screenshot',
            inputSchema: { properties: { filename: { type: 'string' }, type: { type: 'string' } } },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Page URL: https://example.com\nPage Title: Example App' }],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'heading \"Example App\"\ntextbox \"Email\"\ntextbox \"Password\"\nbutton \"Sign in\"',
          },
        ],
      })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'saved screenshot' }] });

    const tool = mod.mcpClientTools.find((entry) => entry.name === 'mcp_browserNavigateExtract');
    const result = await tool!.handler({
      url: 'https://example.com',
      screenshotPath: 'proof.png',
    });
    const text = result.content[0].text ?? '';
    const parsed = JSON.parse(text) as {
      title?: string;
      screenshotSavedTo?: string;
      loginSignals?: { loginDetected?: boolean };
      snapshotSummary?: string;
    };

    expect(parsed.title).toBe('Example App');
    expect(parsed.screenshotSavedTo).toBe('proof.png');
    expect(parsed.loginSignals?.loginDetected).toBe(true);
    expect(parsed.snapshotSummary).toContain('Password');
  });

  it('supports auto-connect via CDP endpoint options on navigate-extract', async () => {
    const mod = await loadMcpClientModule();
    const connectSpy = jest.spyOn(mod.connectionManager, 'connect').mockResolvedValue('browser-2b');
    const sendRequestSpy = jest.spyOn(mod.connectionManager, 'sendRequest');
    sendRequestSpy
      .mockResolvedValueOnce({
        tools: [
          { name: 'browser_navigate', inputSchema: { properties: { url: { type: 'string' } } } },
          { name: 'browser_snapshot', inputSchema: { properties: {} } },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Page URL: https://example.com\nPage Title: Example App' }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'heading "Example App"\nbutton "Open"' }],
      });

    const tool = mod.mcpClientTools.find((entry) => entry.name === 'mcp_browserNavigateExtract');
    const result = await tool!.handler({
      url: 'https://example.com',
      cdpEndpoint: 'http://127.0.0.1:9222',
      extension: true,
      snapshotMode: 'full',
      timeoutAction: 7000,
      timeoutNavigation: 45000,
    });
    const parsed = JSON.parse(result.content[0].text ?? '') as { connectionId?: string; pageUrl?: string };

    expect(connectSpy).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining([
        '-y',
        '@playwright/mcp@latest',
        '--cdp-endpoint',
        'http://127.0.0.1:9222',
        '--extension',
        '--snapshot-mode',
        'full',
        '--timeout-action',
        '7000',
        '--timeout-navigation',
        '45000',
      ]),
    );
    expect(parsed.connectionId).toBe('browser-2b');
    expect(parsed.pageUrl).toBe('https://example.com');
  });

  it('detects login pages with focused indicators', async () => {
    const mod = await loadMcpClientModule();
    jest.spyOn(mod.connectionManager, 'connect').mockResolvedValue('browser-3');
    const sendRequestSpy = jest.spyOn(mod.connectionManager, 'sendRequest');
    sendRequestSpy
      .mockResolvedValueOnce({
        tools: [
          { name: 'browser_navigate', inputSchema: { properties: { url: { type: 'string' } } } },
          { name: 'browser_snapshot', inputSchema: { properties: {} } },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Page URL: https://auth.example.com\nPage Title: Sign in' }],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'heading \"Sign in\"\ntextbox \"Email\"\ntextbox \"Password\"\nbutton \"Continue\"',
          },
        ],
      });

    const tool = mod.mcpClientTools.find((entry) => entry.name === 'mcp_browserProbeLogin');
    const result = await tool!.handler({ url: 'https://auth.example.com' });
    const parsed = JSON.parse(result.content[0].text ?? '') as {
      loginDetected?: boolean;
      confidence?: string;
      indicators?: string[];
    };

    expect(parsed.loginDetected).toBe(true);
    expect(parsed.confidence).toBe('high');
    expect(parsed.indicators).toEqual(
      expect.arrayContaining(['password-field', 'email-field', 'sign-in-copy']),
    );
  });

  it('captures proof screenshots with wait conditions and compact summaries', async () => {
    const mod = await loadMcpClientModule();
    jest.spyOn(mod.connectionManager, 'connect').mockResolvedValue('browser-3b');
    const sendRequestSpy = jest.spyOn(mod.connectionManager, 'sendRequest');
    sendRequestSpy
      .mockResolvedValueOnce({
        tools: [
          { name: 'browser_navigate', inputSchema: { properties: { url: { type: 'string' } } } },
          { name: 'browser_wait_for', inputSchema: { properties: { text: { type: 'string' } } } },
          {
            name: 'browser_take_screenshot',
            inputSchema: { properties: { filename: { type: 'string' }, type: { type: 'string' } } },
          },
          { name: 'browser_snapshot', inputSchema: { properties: {} } },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Page URL: https://example.com/app\nPage Title: Evidence' }],
      })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'target text appeared' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'saved screenshot' }] })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'heading "Evidence"\nbutton "Export"\ntext "target text appeared"' }],
      });

    const tool = mod.mcpClientTools.find((entry) => entry.name === 'mcp_browserCaptureProof');
    const result = await tool!.handler({
      url: 'https://example.com/app',
      waitForText: 'target text appeared',
      screenshotPath: 'evidence.png',
    });
    const parsed = JSON.parse(result.content[0].text ?? '') as {
      pageUrl?: string;
      screenshotSavedTo?: string;
      summary?: string;
    };

    expect(sendRequestSpy).toHaveBeenCalledWith(
      'browser-3b',
      'tools/call',
      expect.objectContaining({
        name: 'browser_wait_for',
        arguments: { text: 'target text appeared' },
      }),
    );
    expect(parsed.pageUrl).toBe('https://example.com/app');
    expect(parsed.screenshotSavedTo).toBe('evidence.png');
    expect(parsed.summary).toContain('Evidence');
  });

  it('disconnects cached browser connections', async () => {
    const mod = await loadMcpClientModule();
    jest.spyOn(mod.connectionManager, 'connect').mockResolvedValue('browser-4');
    jest.spyOn(mod.connectionManager, 'sendRequest').mockResolvedValue({
      tools: [{ name: 'browser_navigate' }],
    });
    const disconnectSpy = jest
      .spyOn(mod.connectionManager, 'disconnect')
      .mockResolvedValue(undefined);

    const connectTool = mod.mcpClientTools.find((entry) => entry.name === 'mcp_browserConnect');
    await connectTool!.handler({ browser: 'firefox' });

    const disconnectTool = mod.mcpClientTools.find(
      (entry) => entry.name === 'mcp_browserDisconnect',
    );
    const result = await disconnectTool!.handler({});
    const parsed = JSON.parse(result.content[0].text ?? '') as { disconnected?: string[] };

    expect(disconnectSpy).toHaveBeenCalledWith('browser-4');
    expect(parsed.disconnected).toEqual(['browser-4']);
  });
});

describe('MCPConnectionManager env support', () => {
  it('passes env variables to spawn options', async () => {
    const harness = await createManagerHarness();
    const customEnv = { INFOSET_API_KEY: 'test-key-123' };
    const connectPromise = harness.manager.connect('node', ['server.js'], customEnv);
    const proc = harness.processes[0];
    emitJsonLine(proc, { jsonrpc: '2.0', id: 0, result: { ready: true } });
    await connectPromise;

    expect(harness.spawnMock).toHaveBeenCalledWith(
      'node',
      ['server.js'],
      expect.objectContaining({
        env: expect.objectContaining({ INFOSET_API_KEY: 'test-key-123' }),
      }),
    );
  });

  it('does not set env when no env provided', async () => {
    const harness = await createManagerHarness();
    const connectPromise = harness.manager.connect('node', ['server.js']);
    const proc = harness.processes[0];
    emitJsonLine(proc, { jsonrpc: '2.0', id: 0, result: { ready: true } });
    await connectPromise;

    const callOptions = harness.spawnMock.mock.calls[0][2];
    expect(callOptions.env).toBeUndefined();
  });
});
