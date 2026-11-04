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
});
