import { performanceTools } from '../src/tools/performance';

describe('performance tools', () => {
  it('runs benchmark and returns metrics', async () => {
    const tool = performanceTools.find((t) => t.name === 'perf_benchmark')!;
    const res = await tool.handler({ iterations: 1000, repeat: 1 });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.runs[0].iterations).toBe(1000);
    expect(parsed.averageOpsPerSec).toBeGreaterThan(0);
  });
});
