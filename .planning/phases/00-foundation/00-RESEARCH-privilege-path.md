# Research: Privilege & Path Helpers

**Domain:** Privilege & Path Helpers
**Phase:** 0 - Foundation
**Date:** 2026-04-07

## Architecture Patterns

### Privilege Helper

Cross-platform admin/root detection with fail-fast behavior:

```typescript
// src/services/sysint/privilegeHelper.ts

export type PrivilegeLevel = 'admin' | 'user' | 'unknown';

let _privilegeLevel: PrivilegeLevel | null = null;

export async function getPrivilegeLevel(): Promise<PrivilegeLevel> {
  if (_privilegeLevel !== null) return _privilegeLevel;
  _privilegeLevel = await detectPrivilege();
  return _privilegeLevel;
}

async function detectPrivilege(): Promise<PrivilegeLevel> {
  if (process.platform === 'win32') {
    return detectWindowsAdmin();
  }
  // Linux or WSL
  return process.getuid?.() === 0 ? 'admin' : 'user';
}

async function detectWindowsAdmin(): Promise<PrivilegeLevel> {
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"'
    );
    return stdout.trim().toLowerCase() === 'true' ? 'admin' : 'user';
  } catch {
    return 'unknown';
  }
}
```

### Fail-Fast Guard

```typescript
export async function requirePrivilege(
  tool: SysIntTool,
  toolId: string,
): Promise<SysIntError | null> {
  if (!tool.adminRequired) return null;
  const level = await getPrivilegeLevel();
  if (level === 'admin') return null;
  return buildError(
    `Tool '${toolId}' requires administrator/root privileges`,
    'PRIVILEGE_REQUIRED',
    toolId,
  );
}
```

Called BEFORE tool execution — never fail mid-operation.

### Platform Guard

```typescript
export function requirePlatform(
  tool: SysIntTool,
  toolId: string,
  currentPlatform: 'win32' | 'linux' | 'wsl',
): SysIntError | null {
  if (!tool.platforms || tool.platforms.includes(currentPlatform)) return null;
  // WSL can use Windows-only tools if they're available via PowerShell
  if (currentPlatform === 'wsl' && tool.platforms.includes('win32')) return null;
  return buildError(
    `Tool '${toolId}' is not supported on platform '${currentPlatform}'`,
    'PLATFORM_UNSUPPORTED',
    toolId,
  );
}
```

## Path Helper

### Requirements

1. `/mnt/c/Users/Hakan` → `C:\Users\Hakan` (WSL to Windows)
2. `C:\Users\Hakan` → `/mnt/c/Users/Hakan` (Windows to WSL)
3. Handle drive letter case normalization
4. Handle UNC paths (`\\server\share` → `/mnt/share` not required in v1)

### Implementation

```typescript
// src/services/sysint/pathHelper.ts

import { isWSL } from '../nirsoft/platform.js';  // reuse existing

/** WSL path to Windows path. Already in nirsoft/platform.ts — re-export. */
export { toWindowsPath } from '../nirsoft/platform.js';

/** Windows path to WSL path (reverse direction — new for sysint). */
export function toWSLPath(windowsPath: string): string {
  // C:\Users\Hakan → /mnt/c/Users/Hakan
  const match = windowsPath.match(/^([A-Za-z]):\\(.*)/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  // Already a Unix path or UNC — return as-is
  return windowsPath;
}

/** Normalize path separators for current OS without conversion. */
export function normalizePath(p: string): string {
  if (process.platform === 'win32') {
    return p.replace(/\//g, '\\');
  }
  return p.replace(/\\/g, '/');
}

/** Get user home directory cross-platform. */
export function getHomedir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/';
}

/** Get temp directory cross-platform. */
export function getTempdir(): string {
  return process.env.TEMP ?? process.env.TMP ?? '/tmp';
}
```

### WSL Path Context

When running in WSL:
- `process.platform === 'linux'` (not 'win32')
- `/mnt/c/` maps to `C:\` on the Windows host
- PowerShell commands receive Windows paths (`C:\...`)
- `wslpath -w` converts any Linux path to Windows path (available in WSL)
- `wslpath -u` converts any Windows path to Linux path

The existing `toWindowsPath()` in `src/services/nirsoft/platform.ts` handles the regex conversion AND falls back to `wslpath -w`. SysInt should re-export it (not duplicate).

## Validation Architecture

### Pre-Execution Checklist

Every `sysint run` invocation goes through this guard sequence:
```
1. Parse & validate args (Zod)
2. Find tool in catalog → NOT_FOUND if missing
3. requirePlatform() → PLATFORM_UNSUPPORTED if wrong OS
4. requirePrivilege() → PRIVILEGE_REQUIRED if insufficient
5. Execute tool
6. Return success or EXEC_FAILED
```

This sequential fail-fast guarantees no silent errors.

## Don't Hand-Roll

- `isWSL()`: import from `src/services/nirsoft/platform.ts` — already memoized
- `toWindowsPath()`: same import — regex + wslpath fallback already there
- `process.getuid()`: native Node.js (UID 0 = root on Linux)
- Windows admin check: PowerShell one-liner (no native module needed)
- Temp file creation: import `createTempFile` from `src/services/nirsoft/tempFile.ts` if needed for sensitive data passthrough

## Common Pitfalls

1. **Windows admin check in WSL** — `process.getuid() === 0` only works for Linux side; WSL process is NOT Windows admin even if root on Linux side. Use PowerShell check for Windows privilege in WSL context.
2. **Privilege check race** — cache after first call; don't re-check on every tool invocation (slow PowerShell call)
3. **Path with spaces** — `toWindowsPath` regex handles spaces correctly but ensure PowerShell args are quoted: `-LiteralPath 'C:\path with spaces'`
4. **Relative paths** — always `path.resolve()` before converting; relative paths break the regex match
5. **Symlinks in WSL paths** — `/mnt/c` could technically be remapped; `wslpath` respects the actual WSL mount config while regex assumes standard `/mnt/<drive>` layout. Prefer `wslpath -w` for accuracy in edge cases.

## Sources

- `src/services/nirsoft/platform.ts` — existing isWSL(), isSupported(), toWindowsPath()
- `src/services/nirsoft/tempFile.ts` — createTempFile() for sensitive data passthrough
- Node.js docs — process.getuid(), process.platform
- Microsoft WSL docs — wslpath utility, /proc/sys/fs/binfmt_misc/WSLInterop

## DOMAIN RESEARCH COMPLETE

Key findings:
- Privilege detection: `process.getuid() === 0` for Linux/WSL-Linux-side; PowerShell `IsInRole(Administrator)` for Windows privilege
- Path helper: re-export `toWindowsPath` from nirsoft, add new `toWSLPath()` for reverse direction
- Fail-fast guard: platform check → privilege check → execute (never fail mid-operation)
- WSL running as Linux root ≠ Windows admin; need separate PowerShell check for Windows-side admin
- `wslpath` utility preferred over regex for edge cases; regex is acceptable fallback
