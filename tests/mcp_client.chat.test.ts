import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const SERVER_PATH = path.resolve('dist/src/index.js');
const TIMEOUT = 15_000;

function sendJsonRpc(proc: ChildProcess, obj: Record<string, unknown>): void {
  proc.stdin!.write(JSON.stringify(obj) + '\n');
}

function collectLines(proc: ChildProcess): string[] {
  const lines: string[] = [];
  proc.stdout!.on('data', (chunk: Buffer) => {
    const raw = chunk.toString();
    for (const line of raw.split('\n').filter(Boolean)) {
      lines.push(line);
    }
  });
  return lines;
}

function findJsonRpcResponse(lines: string[], id: number): Record<string, unknown> | undefined {
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.jsonrpc === '2.0' && obj.id === id) return obj;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

function waitFor(
  lines: string[],
  predicate: (lines: string[]) => boolean,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate(lines)) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(check, 100);
    };
    check();
  });
}

const serverBuilt = fs.existsSync(SERVER_PATH);

const describeIf = serverBuilt ? describe : describe.skip;

describeIf('MCP-First JSON-RPC chain', () => {
  let proc: ChildProcess;
  let lines: string[];

  beforeAll(async () => {
    proc = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        SCHEDULER_DISABLED_FOR_TESTS: '1',
        AUTONOMY_ENABLED: 'false',
        SELF_IMPROVEMENT_ENABLED: 'false',
      },
    });
    lines = collectLines(proc);

    sendJsonRpc(proc, {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    await waitFor(lines, (l) => l.some((x) => x.includes('"id":0')), 10_000);

    sendJsonRpc(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
  }, TIMEOUT);

  afterAll(() => {
    proc?.kill();
  });

  it(
    'initialize handshake returns server capabilities',
    () => {
      const resp = findJsonRpcResponse(lines, 0);
      expect(resp).toBeTruthy();
      expect(resp.result).toBeDefined();
      expect(resp.result.serverInfo).toBeDefined();
      expect(resp.result.capabilities).toBeDefined();
    },
    TIMEOUT,
  );

  it(
    'tools/list returns tool array',
    async () => {
      sendJsonRpc(proc, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      await waitFor(lines, (l) => !!findJsonRpcResponse(l, 1), 10_000);
      const resp = findJsonRpcResponse(lines, 1);
      expect(resp.result.tools).toBeDefined();
      expect(Array.isArray(resp.result.tools)).toBe(true);
      expect(resp.result.tools.length).toBeGreaterThan(50);

      const toolNames = resp.result.tools.map((t: { name?: string }) => t.name);
      expect(toolNames).toContain('ai_chat');
      expect(toolNames).toContain('orchestrate_agents');
    },
    TIMEOUT,
  );

  it(
    'tools/call with encrypt_value returns encrypted output',
    async () => {
      sendJsonRpc(proc, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'encrypt_value',
          arguments: { value: 'test-secret', password: 'test-password-long-enough' },
        },
      });
      await waitFor(lines, (l) => !!findJsonRpcResponse(l, 2), 10_000);
      const resp = findJsonRpcResponse(lines, 2);
      expect(resp.result).toBeDefined();
      expect(resp.result.content).toBeDefined();
      const text = resp.result.content[0]?.text || '';
      expect(text).toContain('Encrypted');
    },
    TIMEOUT,
  );
});
