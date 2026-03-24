import { cacheTools } from '../src/tools/cache.js';

describe('cache tools', () => {
  const tool = cacheTools[0]!;

  it('sets, gets, deletes and clears cache entries', async () => {
    await tool.handler({ action: 'set', key: 'k1', value: '{"a":1}' });
    const getRes = await tool.handler({ action: 'get', key: 'k1' });
    const parsed = JSON.parse(getRes.content?.[0]?.text || '{}');
    expect(parsed.value).toEqual({ a: 1 });

    await tool.handler({ action: 'delete', key: 'k1' });
    const afterDelete = await tool.handler({ action: 'get', key: 'k1' });
    const parsedAfterDelete = JSON.parse(afterDelete.content?.[0]?.text || '{}');
    expect(parsedAfterDelete.value).toBeNull();

    await tool.handler({ action: 'set', key: 'k2', value: 'text' });
    const stats = await tool.handler({ action: 'stats' });
    const parsedStats = JSON.parse(stats.content?.[0]?.text || '{}');
    expect(parsedStats.items).toBeGreaterThanOrEqual(1);

    const cleared = await tool.handler({ action: 'clear' });
    expect(cleared.content?.[0]?.text).toContain('cleared');
  });
});
