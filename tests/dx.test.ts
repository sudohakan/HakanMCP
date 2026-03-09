import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dxTools } from '../src/tools/dx';

describe('dx tools', () => {
  const scaffold = dxTools.find((t: { name: string }) => t.name === 'dx_toolScaffold')!;
  const tip = dxTools.find((t: { name: string }) => t.name === 'dx_hotReloadTip')!;

  it('generates a tool scaffold and writes file when requested', async () => {
    const out = path.join(os.tmpdir(), 'dx-tool.ts');
    if (fs.existsSync(out)) fs.unlinkSync(out);
    const res = await scaffold.handler({
      name: 'sampleTool',
      description: 'desc',
      outputPath: out,
    });
    expect(res.content[0].text).toContain('sampleTool');
    expect(fs.existsSync(out)).toBe(true);
  });

  it('returns hot reload tips', async () => {
    const res = await tip.handler({});
    expect(res.content[0].text).toContain('npm run dev');
  });
});
