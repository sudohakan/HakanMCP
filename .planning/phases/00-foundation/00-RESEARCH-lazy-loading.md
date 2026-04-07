# Research: Lazy Loading & Module System

**Domain:** Lazy Loading & Module System
**Phase:** 0 - Foundation
**Date:** 2026-04-07

## Architecture Patterns

### Three-Phase Startup Model

```
Phase 1 — Startup (sync, fast)
  Load catalog.json → parse → cache SysIntCatalog
  Cost: ~5ms, ~50KB JSON parse
  NO module imports

Phase 2 — First Tool Use (async, per-category)
  import('./services/sysint/tools/network.js')
  Category module cached in Map<string, CategoryModule>
  Cost: one-time per category

Phase 3 — Handler Invocation
  Get platform singleton → run tool handler → return JSON
```

### Category Module Cache

```typescript
// In dispatcher.ts
const _categoryModules = new Map<string, CategoryModule>();

async function getCategoryModule(category: string): Promise<CategoryModule> {
  if (_categoryModules.has(category)) return _categoryModules.get(category)!;
  const mod = await import(`./tools/${category}.js`);
  _categoryModules.set(category, mod);
  return mod;
}
```

This is the same pattern HakanMCP already uses — `loadCoreTools()` in `src/index.ts` does dynamic import via `TOOL_MODULES` array. Phase 0 only needs the catalog loader; category modules are Phase 1+.

### Existing Pattern Reference

HakanMCP's lazy loading in `src/index.ts`:
```typescript
const TOOL_MODULES = [
  { path: './tools/nirsoft.js', export: 'nirsoftTools' },
  ...
]
async function loadCoreTools() {
  for (const mod of TOOL_MODULES) {
    const module = await import(mod.path);
    registry.registerTool(module[mod.export]);
  }
}
```

SysInt Phase 0 should register `sysint.ts` in TOOL_MODULES and let the existing infrastructure handle lazy loading. The catalog load happens inside `sysint.ts` on first call.

### Catalog Load Optimization

Catalog is read synchronously at first `getCatalog()` call (same as NirSoft pattern):
```typescript
let _catalog: SysIntCatalog | null = null;

export function getCatalog(): SysIntCatalog {
  if (_catalog) return _catalog;
  _catalog = loadSysIntCatalog(CATALOG_PATH);
  return _catalog;
}
```

`CATALOG_PATH = path.join(PROJECT_ROOT, 'data', 'sysint', 'catalog.json')`

### Phase 0 Stub Tools

For Phase 0, category modules don't exist yet. The `sysint run` action should:
1. Look up tool in catalog
2. Check if native category module exists
3. If not: fall back to NirSoft binary
4. If NirSoft also unavailable: return structured error

```typescript
async function handleRun(parsed: SysIntArgs): Promise<unknown> {
  const tool = findTool(parsed.id);
  // Try native first
  try {
    const category = await getCategoryModule(tool.category);
    return await category.run(tool, parsed);
  } catch (nativeErr) {
    // Fall back to nirsoft binary
    return await nirsoftFallback(tool, parsed);
  }
}
```

### Module Resolution Notes

- HakanMCP uses ESM (`"type": "module"` in package.json expected)
- Dynamic imports require `.js` extension even for `.ts` source files
- `PROJECT_ROOT` from `src/utils/projectRoot.ts` is the correct anchor for catalog path
- No `__dirname` — use `import.meta.url` or `PROJECT_ROOT`

## Don't Hand-Roll

- Dynamic import pattern: already proven in `src/index.ts` loadCoreTools()
- Memoized singleton: same as nirsoft's `_catalog` and `_isWSL` patterns
- Project root resolution: `PROJECT_ROOT` from `src/utils/projectRoot.ts`

## Common Pitfalls

1. **Eagerly importing category modules** — defeats the whole lazy-load purpose; startup cost balloons
2. **Not handling missing category module gracefully** — throw → crash vs. fall back to nirsoft binary
3. **Forgetting to cache the loaded category module** — re-imports on every tool call
4. **ESM dynamic import path** — must be `./tools/${category}.js` not `.ts`
5. **Race condition in parallel tool calls** — two concurrent calls for same category both trigger import; use Promise caching:
   ```typescript
   const _pending = new Map<string, Promise<CategoryModule>>();
   // Store the Promise, not the resolved value, so concurrent callers await the same promise
   ```

## Sources

- `src/index.ts` — loadCoreTools() dynamic import pattern
- `src/tools/nirsoft.ts` — getCatalog() memoized singleton pattern
- `src/services/nirsoft/catalog.ts` — loadCatalog() sync read pattern
- `src/utils/projectRoot.ts` — PROJECT_ROOT constant

## DOMAIN RESEARCH COMPLETE

Key findings:
- Phase 0 lazy loading = catalog-only at startup, same memoized singleton pattern as nirsoft
- Category modules loaded on demand — Phase 0 stubs return nirsoft fallback until native impls exist
- Use Promise caching (not value caching) to prevent parallel import race condition
- Dynamic import path must use `.js` extension (ESM)
- No new infrastructure needed — piggyback on existing TOOL_MODULES pattern
