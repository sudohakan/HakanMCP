# Research: Stack & Architecture Patterns

**Domain:** Stack & Architecture Patterns
**Phase:** 0 - Foundation
**Date:** 2026-04-07

## Recommended Stack

| Layer | Package | Notes |
|-------|---------|-------|
| Runtime | Node.js 20.x | Already in HakanMCP |
| Language | TypeScript 5.x strict | Already configured |
| Validation | Zod 4.x | Already in deps |
| Build | tsc → dist/ | Existing pipeline |
| Test | Vitest | Existing test setup |

No new packages needed for Phase 0 foundation layer.

## Architecture Patterns

### Integration Pattern: Mirror NirSoft

The `sysint` tool MUST mirror the nirsoft tool's external API shape:
- Same `action` enum: `list`, `info`, `run`
- Same arg shape (`id`, `category`, `format`, `args`)
- Same `createJsonResponse` / `createErrorResponse` from `src/utils/common.ts`
- Register via `FEATURE_TOOL_MAP` with key `sysint`

Registration in `src/toolRegistry.ts`:
```typescript
sysint: {
  modulePath: './tools/sysint.js',
  exportName: 'sysintTools',
  nativeDeps: [],
  core: false,
  featureName: 'sysint'
}
```

`FEATURE_TOOL_METADATA.sysint` placeholder for lazy-load phase.

Add to `TOOL_MODULES` in `src/index.ts` for eager loading, OR use lazy pattern — recommendation: eager (same as most tools, core: false for optional).

### Abstract Platform Adapter

```
AbstractSysIntPlatform (abstract class)
├── WindowsPlatform     — PowerShell + WMI
├── LinuxPlatform       — /proc + /sys + ss/ip/lsof
└── WSLPlatform         — extends LinuxPlatform, Windows fallback
```

Singleton pattern — detect once at startup, cache:
```typescript
let _platform: AbstractSysIntPlatform | null = null;
export function getPlatform(): AbstractSysIntPlatform {
  if (!_platform) _platform = detectPlatform();
  return _platform;
}
```

Reuse existing `isWSL()` and `isSupported()` from `src/services/nirsoft/platform.ts` — do NOT duplicate.

### Directory Layout

```
src/services/sysint/
├── platforms/
│   ├── abstract.ts          — AbstractSysIntPlatform
│   ├── windows.ts           — WindowsPlatform
│   ├── linux.ts             — LinuxPlatform
│   ├── wsl.ts               — WSLPlatform
│   └── index.ts             — getPlatform() singleton factory
├── catalog/
│   ├── loader.ts            — loadSysIntCatalog()
│   └── types.ts             — SysIntTool, SysIntCatalog interfaces
├── dispatcher.ts            — unified native→nirsoft fallback logic
├── outputFormatter.ts       — format JSON/CSV/raw
├── privilegeHelper.ts       — admin/root detection + fail-fast
└── pathHelper.ts            — WSL↔Windows normalization

data/sysint/
└── catalog.json             — 250 tool definitions

src/tools/sysint.ts          — MCP dispatcher (list/info/run)
```

### Catalog Schema Extension

Extend NirsoftTool schema with sysint-specific fields:
```typescript
interface SysIntTool extends NirsoftTool {
  native: boolean;           // true = native impl available
  platforms: ('win32' | 'linux' | 'wsl')[];  // supported platforms
  privilegeRequired: boolean; // alias for adminRequired, explicit
}
```

Keep same `id` values as nirsoft catalog for correlation (e.g., `cports` in both).

## Don't Hand-Roll

- Platform detection: reuse `isWSL()`, `isSupported()` from `src/services/nirsoft/platform.ts`
- JSON/error responses: reuse `createJsonResponse`, `createErrorResponse` from `src/utils/common.ts`
- Path conversion: extend `toWindowsPath()` — add `toLinuxPath()` for reverse
- Catalog loading: model after `loadCatalog()` in `src/services/nirsoft/catalog.ts`
- Tool registration: follow exact `FEATURE_TOOL_MAP` pattern in `src/toolRegistry.ts`

## Common Pitfalls

1. **Duplicate platform detection** — `isWSL()` already memoized in nirsoft/platform.ts. Import it, don't re-implement.
2. **Missing FEATURE_TOOL_METADATA entry** — If tool is lazy-loaded, placeholder metadata is required or it won't appear in tool list before first invocation.
3. **Action parameter drift** — sysint `run` vs nirsoft `run` must have identical optional args, or agents using both get confused.
4. **Platform singleton not reset in tests** — export a `_resetPlatform()` for tests; otherwise singleton state leaks across test cases.
5. **catalog.json path resolution** — Use `PROJECT_ROOT` (already in `src/utils/projectRoot.ts`) not `__dirname` (fails in ESM).

## Sources

- `src/toolRegistry.ts` — FEATURE_TOOL_MAP registration pattern
- `src/index.ts` — TOOL_MODULES and loadCoreTools() lazy loading
- `src/tools/nirsoft.ts` — API shape reference
- `src/services/nirsoft/platform.ts` — existing reusable platform helpers
- `src/services/nirsoft/catalog.ts` — NirsoftTool/NirsoftCatalog schema
- `src/utils/common.ts` — createJsonResponse/createErrorResponse/ToolError
- `src/utils/projectRoot.ts` — PROJECT_ROOT for file resolution

## DOMAIN RESEARCH COMPLETE

Key findings:
- No new packages needed; all foundation deps already in project
- sysint tool mirrors nirsoft API shape exactly (list/info/run)
- Platform helpers (isWSL, toWindowsPath) should be imported from nirsoft, not duplicated
- FEATURE_TOOL_MAP registration + FEATURE_TOOL_METADATA placeholder required for lazy load
- SysIntTool extends NirsoftTool — adds `native` and `platforms` fields
- Singleton platform factory needed with test reset escape hatch
