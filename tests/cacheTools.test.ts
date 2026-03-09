import { cacheTools } from '../src/tools/cache.js';

describe('cache tools', () => {
  const setTool = cacheTools.find((t) => t.name === 'cache_set')!;
  const getTool = cacheTools.find((t) => t.name === 'cache_get')!;
  const deleteTool = cacheTools.find((t) => t.name === 'cache_delete')!;
  const statsTool = cacheTools.find((t) => t.name === 'cache_stats')!;
  const clearTool = cacheTools.find((t) => t.name === 'cache_clear')!;

  it('sets, gets, deletes and clears cache entries', async () => {
    await setTool.handler({ key: 'k1', value: '{"a":1}' });
    const getRes = await getTool.handler({ key: 'k1' });
    const parsed = JSON.parse(getRes.content?.[0]?.text || '{}');
    expect(parsed.value).toEqual({ a: 1 });

    await deleteTool.handler({ key: 'k1' });
    const afterDelete = await getTool.handler({ key: 'k1' });
    const parsedAfterDelete = JSON.parse(afterDelete.content?.[0]?.text || '{}');
    expect(parsedAfterDelete.value).toBeNull();

    await setTool.handler({ key: 'k2', value: 'text' });
    const stats = await statsTool.handler({});
    const parsedStats = JSON.parse(stats.content?.[0]?.text || '{}');
    expect(parsedStats.items).toBeGreaterThanOrEqual(1);

    const cleared = await clearTool.handler({});
    expect(cleared.content?.[0]?.text).toContain('cleared');
  });
});
