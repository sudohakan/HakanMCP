import { dbMonitoringTools } from '../src/tools/dbMonitoring';

describe('dbMonitoring tools', () => {
  const record = dbMonitoringTools.find((t: { name: string }) => t.name === 'db_recordQuery')!;
  const slow = dbMonitoringTools.find((t: { name: string }) => t.name === 'db_slowQueries')!;
  const stats = dbMonitoringTools.find((t: { name: string }) => t.name === 'db_queryStats')!;
  const clear = dbMonitoringTools.find((t: { name: string }) => t.name === 'db_clearStats')!;

  afterEach(async () => {
    await clear.handler({});
  });

  it('records and reports slow queries', async () => {
    await record.handler({ name: 'q1', durationMs: 600 });
    await record.handler({ name: 'q2', durationMs: 100 });

    const res = await slow.handler({ thresholdMs: 500 });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.slow[0].name).toBe('q1');
  });

  it('returns percentile stats', async () => {
    await record.handler({ name: 'a', durationMs: 10 });
    await record.handler({ name: 'b', durationMs: 20 });
    const res = await stats.handler({});
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.max).toBe(20);
  });
});
