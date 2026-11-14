import { FEATURE_TOOL_MAP, FEATURE_TOOL_METADATA, ToolRegistry } from '../src/toolRegistry';
import { FEATURE_DEPENDENCY_MAP } from '../src/dependencyResolver';

describe('ToolRegistry feature modules', () => {
  it('every lazy feature module names a known dependency feature with the same packages', () => {
    for (const [prefix, mod] of Object.entries(FEATURE_TOOL_MAP)) {
      if (mod.core) continue;
      const feature = FEATURE_DEPENDENCY_MAP[mod.featureName];
      expect({ prefix, known: Boolean(feature) }).toEqual({ prefix, known: true });
      expect([...feature.packages].sort()).toEqual([...mod.nativeDeps].sort());
    }
  });

  it('loads the real db handler instead of the missing-dependency placeholder', async () => {
    const registry = new ToolRegistry();
    for (const meta of FEATURE_TOOL_METADATA.db) {
      registry.registerPlaceholder(meta.name, meta.description, meta.inputSchema, 'db');
    }
    const handler = await registry.getHandler('db');
    expect(handler).not.toBeNull();
    const result = await handler!({ action: 'getPoolStats' });
    expect(result.content[0].text).not.toContain('currently unavailable');
  }, 60_000);

  it('fills placeholders from a registered loader once, and retries a failed core load', async () => {
    const registry = new ToolRegistry();
    const schema = { type: 'object' as const, properties: {} };
    registry.registerPlaceholder('lazy_a', 'a', schema, 'lazyMod');
    registry.registerPlaceholder('lazy_b', 'b', schema, 'lazyMod');
    let calls = 0;
    let fail = true;
    registry.registerLoader('lazyMod', async () => {
      calls++;
      if (fail) throw new Error('boom');
      return ['lazy_a', 'lazy_b'].map((name) => ({
        name, description: name, inputSchema: schema,
        handler: async () => ({ content: [{ type: 'text' as const, text: `ran ${name}` }] }),
      }));
    });

    const broken = await registry.getHandler('lazy_a');
    expect((await broken!({})).content[0].text).toContain('failed to load: boom');

    fail = false;
    const [a, b] = await Promise.all([registry.getHandler('lazy_a'), registry.getHandler('lazy_b')]);
    expect((await a!({})).content[0].text).toBe('ran lazy_a');
    expect((await b!({})).content[0].text).toBe('ran lazy_b');
    expect(calls).toBe(2);
    expect(registry.listTools().map((t) => t.name)).toEqual(['lazy_a', 'lazy_b']);
  });
});
