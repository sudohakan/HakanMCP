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

    await expect(harness.manager.connect('node', ['broken'])).rejects.toThrow('stdout');
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
