import { dbMonitoringTools } from '../src/tools/dbMonitoring';

describe('dbMonitoring tools', () => {
  const tool = dbMonitoringTools[0]!;

  afterEach(async () => {
    await tool.handler({ action: 'clear' });
  });

  it('records and reports slow queries', async () => {
    await tool.handler({ action: 'record', name: 'q1', durationMs: 600 });
    await tool.handler({ action: 'record', name: 'q2', durationMs: 100 });

    const res = await tool.handler({ action: 'slow', thresholdMs: 500 });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.slow[0].name).toBe('q1');
  });

  it('returns percentile stats', async () => {
    await tool.handler({ action: 'record', name: 'a', durationMs: 10 });
    await tool.handler({ action: 'record', name: 'b', durationMs: 20 });
    const res = await tool.handler({ action: 'stats' });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.max).toBe(20);
  });
});
