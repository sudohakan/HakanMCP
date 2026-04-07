# Phase 0: Foundation - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Platform abstraction layer, tool catalog, MCP dispatcher, output formatter, privilege/path helpers, lazy loading. No actual tool implementations — only the skeleton that all 250 tools will use.

</domain>

<decisions>
## Implementation Decisions

### Output contract
- Every tool returns: `{ "rows": [...], "count": N, "timestamp": "ISO8601", "platform": "win32|linux|wsl", "tool": "tool-id" }`
- Error case: `{ "error": "message", "code": "PLATFORM_UNSUPPORTED|PRIVILEGE_REQUIRED|NOT_FOUND|EXEC_FAILED", "tool": "tool-id" }`
- Format parameter: `json` (default), `csv`, `raw` — same as existing nirsoft tool
- Schema version field not needed at v1 — add when breaking changes occur

### Tool invocation pattern
- Single MCP tool named `sysint` with actions: `list`, `info`, `run`
- Same API shape as existing `nirsoft` tool for consistency
- `sysint run --id cports` tries native first, falls back to nirsoft binary if native not yet implemented
- Fallback is transparent — caller doesn't need to know which backend served the result
- `sysint list` shows all tools with `native: true|false` field indicating implementation status

### Error reporting
- Platform-unsupported tools return error with code `PLATFORM_UNSUPPORTED`, not empty result
- Privilege-required tools detect privilege before execution, fail fast with `PRIVILEGE_REQUIRED`
- Never silent failure — if a tool can't produce output, return error with reason
- Timeout: inherit from catalog (per-tool), default 30s

### Coexistence with NirSoft wrapper
- `nirsoft` tool stays unchanged — no modifications to existing code
- `sysint` registers as separate MCP tool alongside `nirsoft`
- Shared catalog structure: `data/sysint/catalog.json` mirrors nirsoft catalog schema
- Tool IDs match nirsoft IDs where applicable (e.g., `cports` in both)
- Long-term: agents prefer `sysint`, `nirsoft` becomes legacy

### Platform adapter pattern
- Abstract class `SysIntPlatform` with methods per tool category
- `WindowsPlatform`: PowerShell + WMI + native APIs via child_process
- `LinuxPlatform`: /proc + /sys filesystem reads + ss/ip/lsof commands
- `WSLPlatform extends LinuxPlatform`: Linux-first, falls back to PowerShell for Windows-only data
- Platform singleton — detected once at startup, cached
- Platform detection: `process.platform` + `/proc/sys/fs/binfmt_misc/WSLInterop` (reuse existing `isWSL()`)

### Lazy loading
- Startup cost: only catalog.json loaded (~50KB)
- Category modules imported on first tool use from that category
- Same pattern as existing HakanMCP `FEATURE_TOOL_MAP` / `FEATURE_TOOL_METADATA`
- Register in `toolRegistry.ts` and `dependencyResolver.ts`

### Claude's Discretion
- Internal file organization within `src/services/sysint/`
- Test file structure
- Exact platform detection caching mechanism
- Utility function naming and signatures

</decisions>

<specifics>
## Specific Ideas

- API should feel identical to existing `nirsoft` tool — agents already know that interface
- Catalog schema should be compatible with nirsoft catalog (same fields + extras)
- Reuse existing helpers: `createJsonResponse`, `createErrorResponse`, `isWSL()`, `toWindowsPath()`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 00-foundation*
*Context gathered: 2026-04-07*
