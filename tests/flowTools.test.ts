import fs from 'node:fs';
import path from 'node:path';
import { flowTools } from '../src/tools/flow.js';

const connPath = path.join(process.cwd(), 'logs', 'flows', 'tool-connections.json');
const versionDir = path.join(process.cwd(), 'logs', 'flows', 'versions-test');
const flowPath = path.join(process.cwd(), 'recipes', 'tool-flow.json');

describe('flow tools extras', () => {
  beforeAll(() => {
    process.env.FLOW_CONNECTIONS_PATH = connPath;
    process.env.FLOW_VERSION_DIR = versionDir;
    fs.mkdirSync(path.dirname(flowPath), { recursive: true });
    fs.writeFileSync(
      flowPath,
      JSON.stringify({ name: 'tool-flow', steps: [{ id: 'log', action: 'log' }] }, null, 2),
      'utf8',
    );
  });

  afterAll(() => {
    [connPath].forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    if (fs.existsSync(versionDir)) {
      fs.rmSync(versionDir, { recursive: true, force: true });
    }
    if (fs.existsSync(flowPath)) {
      fs.unlinkSync(flowPath);
    }
  });

  it('saves and masks connections via tools', async () => {
    const saveTool = flowTools.find((t) => t.name === 'connection_save')!;
    const listTool = flowTools.find((t) => t.name === 'connection_list')!;
    const getTool = flowTools.find((t) => t.name === 'connection_get')!;

    await saveTool.handler({
      name: 'Slack webhook',
      type: 'slack_webhook',
      config: { url: 'http://example.com', token: 'secret-token' },
    });

    const listRes = await listTool.handler({});
    const parsed = JSON.parse(listRes.content?.[0]?.text || '[]');
    expect(parsed[0].config.token).toBe('***');

    const getRes = await getTool.handler({ id: parsed[0].id, includeSecrets: true });
    const parsedGet = JSON.parse(getRes.content?.[0]?.text || '{}');
    expect(parsedGet.config.token).toBe('secret-token');
  });

  it('saves and restores flow versions', async () => {
    const saveTool = flowTools.find((t) => t.name === 'flow_version_save')!;
    const listTool = flowTools.find((t) => t.name === 'flow_version_list')!;
    const restoreTool = flowTools.find((t) => t.name === 'flow_version_restore')!;

    await saveTool.handler({ path: flowPath, label: 'initial' });
    fs.writeFileSync(
      flowPath,
      JSON.stringify({ name: 'tool-flow', steps: [{ id: 'log2', action: 'log' }] }, null, 2),
      'utf8',
    );

    const listRes = await listTool.handler({ path: flowPath, limit: 5 });
    const listText = listRes.content?.[0]?.text || '';
    const versionFile = listText.split('\n')[0].replace('- ', '').trim();
    expect(versionFile).toContain('tool-flow');

    await restoreTool.handler({ path: flowPath, versionFile });
    const restored = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
    expect(restored.steps[0].id).toBe('log');
  });
});
