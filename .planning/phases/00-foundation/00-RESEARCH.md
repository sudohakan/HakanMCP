# Phase 0: Foundation — Research

**Synthesized:** 2026-04-07
**Domains:** Stack & Architecture, Lazy Loading, Output Formatting, Privilege & Path Helpers

---

## User Constraints

*(from CONTEXT.md — locked decisions)*

- Every tool returns: `{ rows, count, timestamp, platform, tool }` — no schema_version in v1
- Error shape: `{ error, code, tool }` — codes: PLATFORM_UNSUPPORTED, PRIVILEGE_REQUIRED, NOT_FOUND, EXEC_FAILED
- Format parameter: `json` (default) | `csv` | `raw`
- Single MCP tool named `sysint` with actions: `list`, `info`, `run`
- Same API shape as existing `nirsoft` tool
- `sysint run --id cports` tries native first, falls back to nirsoft binary if native not yet implemented
- Platform-unsupported tools return PLATFORM_UNSUPPORTED error, never empty result
- Privilege-required tools fail fast with PRIVILEGE_REQUIRED, never mid-operation
- `nirsoft` tool stays unchanged — sysint registers alongside
- Shared catalog: `data/sysint/catalog.json` mirrors nirsoft schema
- Tool IDs match nirsoft IDs where applicable
- Platform adapter: abstract class + Windows/Linux/WSL impls, singleton
- Platform detection: reuse existing `isWSL()`
- Lazy loading: startup loads only catalog.json, category modules imported on first use
- Register in `toolRegistry.ts` and existing TOOL_MODULES

---

## Recommended Stack

| Layer | Package | Version | Role |
|-------|---------|---------|------|
| Runtime | Node.js | 20.x | Already in HakanMCP |
| Language | TypeScript | 5.x strict | Already configured |
| Validation | Zod | 4.x | Already in deps — use for input/output schema |
| Build | tsc | existing | Existing pipeline |
| Test | Vitest | existing | Existing test setup |

**No new packages needed for Phase 0.**

---

## Architecture Patterns

### Directory Layout

```
src/services/sysint/
├── platforms/
│   ├── abstract.ts          — AbstractSysIntPlatform interface
│   ├── windows.ts           — WindowsPlatform
│   ├── linux.ts             — LinuxPlatform
│   ├── wsl.ts               — WSLPlatform (extends LinuxPlatform)
│   └── index.ts             — getPlatform() singleton factory
├── catalog/
│   ├── loader.ts            — loadSysIntCatalog()
│   └── types.ts             — SysIntTool, SysIntCatalog interfaces
├── dispatcher.ts            — unified native→nirsoft fallback logic
├── outputFormatter.ts       — buildSuccess(), buildError(), toCSV()
├── privilegeHelper.ts       — getPrivilegeLevel(), requirePrivilege(), requirePlatform()
└── pathHelper.ts            — toWSLPath(), normalizePath(), re-export toWindowsPath

data/sysint/
└── catalog.json             — 250 tool definitions

src/tools/sysint.ts          — MCP dispatcher (list/info/run)
```

### Platform Adapter

```typescript
// AbstractSysIntPlatform — defined but methods added in Phase 1+ as tool categories land
export abstract class AbstractSysIntPlatform {
  abstract readonly name: 'win32' | 'linux' | 'wsl';
}

// Singleton factory
let _platform: AbstractSysIntPlatform | null = null;
export function getPlatform(): AbstractSysIntPlatform { ... }
export function _resetPlatform(): void { _platform = null; }  // test escape hatch
```

### Catalog Schema Extension

```typescript
// Extends NirsoftTool — same id values, adds native + platforms fields
interface SysIntTool {
  id: string;
  name: string;
  description: string;
  category: string;
  adminRequired: boolean;
  timeout: number;
  native: boolean;                              // true = native impl available
  platforms: ('win32' | 'linux' | 'wsl')[];   // platforms this tool supports
}
```

### Registration in toolRegistry.ts

```typescript
// FEATURE_TOOL_MAP entry
sysint: {
  modulePath: './tools/sysint.js',
  exportName: 'sysintTools',
  nativeDeps: [],
  core: false,
  featureName: 'sysint'
}

// FEATURE_TOOL_METADATA placeholder
sysint: [{
  name: 'sysint',
  description: 'Cross-platform system intelligence tools (250 tools). Actions: list, info, run.',
  inputSchema: { type: 'object', properties: { action: ..., id: ..., category: ..., format: ... }, required: ['action'] }
}]
```

### MCP API Shape (mirrors nirsoft)

```typescript
const SysIntArgsSchema = z.object({
  action: z.enum(['list', 'info', 'run']),
  id: z.string().optional(),
  tool: z.string().optional(),    // alias for id
  category: z.string().optional(),
  format: z.enum(['json', 'csv', 'raw']).default('json'),
  args: z.array(z.string()).optional(),
}).transform((data) => ({ ...data, id: data.id ?? data.tool }));
```

### Pre-Execution Guard Sequence

```
1. Parse & validate args (Zod)
2. Find tool in catalog → NOT_FOUND
3. requirePlatform() → PLATFORM_UNSUPPORTED
4. requirePrivilege() → PRIVILEGE_REQUIRED
5. Try native category module → EXEC_FAILED or success
6. If native not implemented → nirsoft binary fallback
```

---

## Don't Hand-Roll

| What | Source |
|------|--------|
| `isWSL()` | `src/services/nirsoft/platform.ts` — already memoized |
| `isSupported()` | same |
| `toWindowsPath()` | same — regex + wslpath fallback |
| `createJsonResponse()` | `src/utils/common.ts` |
| `createErrorResponse()` | same |
| `ToolError` / `ToolResponse` | `src/types/index.ts` |
| `PROJECT_ROOT` | `src/utils/projectRoot.ts` |
| `createTempFile()` | `src/services/nirsoft/tempFile.ts` |
| Catalog loader pattern | `src/services/nirsoft/catalog.ts` |
| Dynamic import pattern | `src/index.ts` loadCoreTools() |

---

## Common Pitfalls

| # | Pitfall | Fix |
|---|---------|-----|
| 1 | Duplicate `isWSL()` impl | Import from nirsoft/platform.ts, don't re-implement |
| 2 | Missing FEATURE_TOOL_METADATA | Required for lazy-loaded tools to appear before first call |
| 3 | Platform singleton state leak in tests | Export `_resetPlatform()` for test teardown |
| 4 | Catalog path using `__dirname` | Use `PROJECT_ROOT` — `__dirname` breaks in ESM |
| 5 | Category module re-imported on parallel calls | Cache the Promise (not the resolved value) to prevent race |
| 6 | ESM dynamic import with `.ts` extension | Use `.js` extension in import path even for TS source |
| 7 | CRLF in PowerShell output | `stdout.replace(/\r\n/g, '\n').trim()` immediately after exec |
| 8 | Platform returns `'linux'` in WSL | Check `isWSL()` first; return `'wsl'` not `'linux'` |
| 9 | WSL Linux-root ≠ Windows admin | PowerShell `IsInRole(Administrator)` check for Windows privilege in WSL |
| 10 | Privilege check on every invocation | Cache after first detection (singleton pattern) |

---

## Validation Architecture

### Input Validation
Zod at MCP API boundary — `SysIntArgsSchema` validates all incoming args before any processing.

### Platform + Privilege Guards
Sequential: platform check → privilege check → execute. Any guard fail returns structured error immediately.

### Output Validation
Phase 0: `SysIntSuccessSchema` and `SysIntErrorSchema` defined in outputFormatter.ts. Per-tool row schemas deferred to Phase 1+ category implementations.

---

## Open Questions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Should catalog.json be a copy of nirsoft catalog or separate? | Separate — different fields (native, platforms), different path (`data/sysint/`) |
| 2 | Does WSL platform need PowerShell admin check in Phase 0? | Yes — privilege helper must work correctly for WSL from day 1 |
| 3 | `sysint list` — should it show nirsoft tools that have no native impl yet? | Yes — `native: false` field indicates status; agents can see what's available |

---

## Phase Requirements Coverage

| Req | Domain | Key Finding |
|-----|--------|-------------|
| FND-01 | Stack & Architecture | AbstractSysIntPlatform + 3 platform impls in `src/services/sysint/platforms/` |
| FND-02 | Lazy Loading | `data/sysint/catalog.json` + `loadSysIntCatalog()` memoized singleton |
| FND-03 | Output Formatting | `outputFormatter.ts` — buildSuccess/buildError/toCSV + Zod schemas |
| FND-04 | MCP Dispatcher | `src/tools/sysint.ts` — list/info/run actions, mirrors nirsoft API |
| FND-05 | Privilege Helper | `privilegeHelper.ts` — getPrivilegeLevel() + requirePrivilege() fail-fast |
| FND-06 | Path Helper | `pathHelper.ts` — toWSLPath() new, re-export toWindowsPath, normalizePath |
| FND-07 | Lazy Loading | Promise-cached category module loader in `dispatcher.ts` |
| FND-08 | Unified Dispatcher | `dispatcher.ts` — native first, nirsoft fallback, transparent to caller |

---

## Sources

- `src/toolRegistry.ts` — FEATURE_TOOL_MAP registration pattern
- `src/index.ts` — TOOL_MODULES and loadCoreTools() lazy loading
- `src/tools/nirsoft.ts` — API shape reference (list/info/run, args schema)
- `src/services/nirsoft/platform.ts` — isWSL, isSupported, toWindowsPath
- `src/services/nirsoft/catalog.ts` — loadCatalog(), NirsoftTool/NirsoftCatalog
- `src/utils/common.ts` — createJsonResponse, createErrorResponse, ToolError
- `src/utils/projectRoot.ts` — PROJECT_ROOT
- `src/types/index.ts` — ToolResponse, ToolDefinition
- `data/nirsoft/catalog.json` — 245 tools, 10 categories, tool schema reference

---

## RESEARCH COMPLETE
