# Research: Output Formatting & Validation

**Domain:** Output Formatting & Validation
**Phase:** 0 - Foundation
**Date:** 2026-04-07

## Output Contract (from CONTEXT.md — locked)

```typescript
// Success
{
  rows: unknown[],
  count: number,
  timestamp: string,  // ISO8601
  platform: 'win32' | 'linux' | 'wsl',
  tool: string        // tool-id
}

// Error
{
  error: string,
  code: 'PLATFORM_UNSUPPORTED' | 'PRIVILEGE_REQUIRED' | 'NOT_FOUND' | 'EXEC_FAILED',
  tool: string
}
```

Note: `schema_version` field deferred to v2 (CONTEXT.md decision). Research summary has it in the schema — CONTEXT.md takes precedence, skip it for Phase 0.

## Zod Schema Design

```typescript
// src/services/sysint/outputFormatter.ts

import { z } from 'zod';

export const SysIntSuccessSchema = z.object({
  rows: z.array(z.unknown()),
  count: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  platform: z.enum(['win32', 'linux', 'wsl']),
  tool: z.string(),
});

export const SysIntErrorSchema = z.object({
  error: z.string(),
  code: z.enum(['PLATFORM_UNSUPPORTED', 'PRIVILEGE_REQUIRED', 'NOT_FOUND', 'EXEC_FAILED']),
  tool: z.string(),
});

export type SysIntSuccess = z.infer<typeof SysIntSuccessSchema>;
export type SysIntError = z.infer<typeof SysIntErrorSchema>;
```

### Format Enum

```typescript
export type OutputFormat = 'json' | 'csv' | 'raw';
```

### Output Builder Functions

```typescript
export function buildSuccess(
  rows: unknown[],
  toolId: string,
  platform: 'win32' | 'linux' | 'wsl',
): SysIntSuccess {
  return {
    rows,
    count: rows.length,
    timestamp: new Date().toISOString(),
    platform,
    tool: toolId,
  };
}

export function buildError(
  message: string,
  code: SysIntError['code'],
  toolId: string,
): SysIntError {
  return { error: message, code, tool: toolId };
}
```

### CSV Formatting

For CSV output (rows must be flat objects):
```typescript
export function toCSV(rows: unknown[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map((h) => {
      const v = (row as Record<string, unknown>)[h];
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    });
    lines.push(values.join(','));
  }
  return lines.join('\n');
}
```

### Integration with MCP Response

The outputFormatter returns the raw data object. The sysint.ts MCP dispatcher wraps it in `createJsonResponse()`:

```typescript
// In sysint.ts
const result = buildSuccess(rows, toolId, getPlatformName());
return createJsonResponse(result);  // from src/utils/common.ts
```

For CSV format:
```typescript
const csv = toCSV(rows);
return createTextResponse(csv);  // if this helper exists, or createJsonResponse({ csv })
```

## Validation Architecture

### Input Validation (Zod at API boundary)

```typescript
const SysIntArgsSchema = z.object({
  action: z.enum(['list', 'info', 'run']),
  id: z.string().optional(),
  tool: z.string().optional(),  // alias for id
  category: z.string().optional(),
  format: z.enum(['json', 'csv', 'raw']).default('json'),
  args: z.array(z.string()).optional(),
}).transform((data) => ({
  ...data,
  id: data.id ?? data.tool,  // normalize alias
}));
```

### Per-Tool Output Schema (v1 approach)

Phase 0 does not implement per-tool Zod schemas (deferred to individual category phases). Phase 0 uses `z.array(z.unknown())` for rows — structure is tool-specific.

Phase 1+ category modules will export their own row schemas:
```typescript
// Future: src/services/sysint/tools/network.ts
export const CportsRowSchema = z.object({
  pid: z.number(), name: z.string(), localAddress: z.string(), ...
});
```

## Don't Hand-Roll

- JSON serialization: native `JSON.stringify` (no extra deps)
- ISO timestamp: `new Date().toISOString()` (native)
- Zod already in project — use it for all input/output schema validation
- CSV quoting: simple custom function is fine (no csv-parse needed for output-only)
- `createJsonResponse` / `createTextResponse` from `src/utils/common.ts` — wrap results in MCP format

## Common Pitfalls

1. **CRLF in rows from PowerShell** — `stdout.trim()` and `stdout.replace(/\r\n/g, '\n')` before parsing
2. **count mismatch** — always derive `count` from `rows.length`, never pass separately
3. **CSV injection** — values starting with `=`, `+`, `-`, `@` can trigger spreadsheet formula execution; not a security concern for AI agents but worth noting
4. **Empty rows vs error** — tool that runs but finds nothing returns `{ rows: [], count: 0, ... }` NOT an error; only fail if tool itself cannot run
5. **Platform enum for WSL** — `process.platform` returns `'linux'` in WSL; must check `isWSL()` first and return `'wsl'` not `'linux'`

## Sources

- `src/utils/common.ts` — createJsonResponse, createErrorResponse, createTextResponse, ToolResponse type
- `src/types/index.ts` — ToolResponse interface
- `src/services/nirsoft/csvParser.ts` — existing CSV parsing reference (for format parity)
- CONTEXT.md — locked output contract

## DOMAIN RESEARCH COMPLETE

Key findings:
- Success shape: `{ rows, count, timestamp, platform, tool }` — no schema_version in v1
- Error codes: 4 distinct codes — PLATFORM_UNSUPPORTED, PRIVILEGE_REQUIRED, NOT_FOUND, EXEC_FAILED
- Platform value for WSL must be `'wsl'` not `'linux'` (requires isWSL() check before process.platform)
- Per-tool row schemas deferred — Phase 0 uses `z.array(z.unknown())`
- CSV output requires CRLF normalization from PowerShell stdout
- Zod input validation schema mirrors nirsoft args shape exactly
