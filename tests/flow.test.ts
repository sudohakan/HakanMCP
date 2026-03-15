import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { flowSchema, loadFlow, runFlow } from '../src/flows/runner.js';
import { upsertConnection } from '../src/utils/connections.js';

describe('Flow runner', () => {
  const tmpFile = path.join(process.cwd(), 'recipes', 'test-flow.json');
  const connPath = path.join(process.cwd(), 'logs', 'flows', 'test-connections.json');

  afterAll(() => {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    if (fs.existsSync(connPath)) {
      fs.unlinkSync(connPath);
    }
  });

  it('validates flow schema', () => {
    const parsed = flowSchema.parse({
      name: 'sample',
      steps: [{ id: 'log', action: 'log', args: { message: 'hi' } }],
    });
    expect(parsed.steps[0].action).toBe('log');
  });

  it('runs a simple log-only flow', async () => {
    const flowObj = {
      name: 'log-only',
      steps: [{ id: 'log', action: 'log', args: { message: 'hello' } }],
    };
    fs.writeFileSync(tmpFile, JSON.stringify(flowObj, null, 2), 'utf8');

    const loaded = loadFlow(tmpFile);
    expect(loaded.name).toBe('log-only');

    const result = await runFlow(loaded);
    expect(result.success).toBe(true);
  });

  it('runs http_request step with connectionId', async () => {
    process.env.FLOW_CONNECTIONS_PATH = connPath;
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port?: number }).port;

    upsertConnection({
      id: 'conn-test',
      name: 'local-http',
      type: 'http',
      config: { url: `http://127.0.0.1:${port}/ping`, headers: { 'X-Test': '1' } },
    });

    const flowObj = {
      name: 'http-flow',
      steps: [
        {
          id: 'req',
          action: 'http_request' as const,
          args: { connectionId: 'conn-test', method: 'GET' },
        },
      ],
    };
    const res = await runFlow(flowObj as Parameters<typeof runFlow>[0]);
    server.close();
    expect(res.success).toBe(true);
    expect(res.logs[0]).toContain('http 200');
  });
});
