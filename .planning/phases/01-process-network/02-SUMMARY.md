---
phase: 01-process-network
plan: 02
subsystem: process
tags: [systeminformation, process, exec, powershell, proc]

requires:
  - phase: 00-foundation
    provides: buildSuccess, buildError, getPlatformName, dispatcher
  - phase: 01-process-network-plan01
    provides: systeminformation dependency, test fixtures, catalog entries

provides:
  - src/services/sysint/tools/process.ts with 8 tool handlers
  - parseNetstatWindows(), parseWindowsServices(), parseLinuxServices() exported pure parsers
  - 29 unit tests in process.test.ts (all green)

affects: network-tools, dispatcher-integration, phase1-integration-tests

tech-stack:
  added: []
  patterns:
    - "systeminformation static import (not dynamic) for jest compatibility"
    - "Export pure parser functions for testability when exec cannot be mocked in ESM"
    - "Integration-style tests for si-dependent functions (real OS calls)"

key-files:
  created:
    - src/services/sysint/tools/process.ts
    - src/services/sysint/__tests__/process.test.ts

key-decisions:
  - "jest.unstable_mockModule does NOT intercept Node.js built-ins (node:child_process) in this project's ts-jest/ESM setup — use exported pure parsers instead"
  - "systeminformation must be imported statically (import si from 'si') for jest mock compatibility"
  - "process-io on Windows returns WorkingSet64/PagedMemorySize64 (real IO counters need admin)"
  - "UDP regex uses separate match branch from TCP (UDP has no state column)"

patterns-established:
  - "Export pure parser functions (parseXxx) alongside tool handlers for unit testing without exec mocks"
  - "Integration tests for OS-call-dependent tools validate shape, not exact values"

requirements-completed: [PRC-01, PRC-02, PRC-03, PRC-04, PRC-05, PRC-06, PRC-07, PRC-08]

duration: 45min
completed: 2026-04-07
---

# Plan 02: Process Tools Summary

**8 process tools implemented: process-list, connections, modules, threads, handles, IO, tree, service-list — all cross-platform (win32/linux/wsl)**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-04-07T09:52:00Z
- **Completed:** 2026-04-07T10:37:00Z
- **Tasks:** 5
- **Files modified:** 2

## Accomplishments

- All 8 PRC-* tools implemented in single module `process.ts`
- Pure parsers exported: `parseNetstatWindows`, `parseWindowsServices`, `parseLinuxServices`
- 29 tests passing: parser unit tests + integration shape tests for real-OS calls

## Task Commits

1. **All tasks** — `e6795de` (feat)

## Files Created/Modified

- `src/services/sysint/tools/process.ts` — 8 tool handlers + exported parsers (~460 lines)
- `src/services/sysint/__tests__/process.test.ts` — 29 tests

## Decisions Made

- `jest.unstable_mockModule('node:child_process')` does NOT work in this project — extraction to pure parsers solves testability
- UDP netstat parsing requires separate regex from TCP (no state column)
- `process-io` on Windows returns WorkingSet64/PagedMemorySize64 (true IO byte counters require admin)

## Deviations from Plan

### Auto-fixed Issues

**1. UDP regex — missing TCP/UDP split**
- **Found during:** Task 1-02-03 testing
- **Issue:** Single regex pattern didn't handle UDP rows (no state column)
- **Fix:** Separate TCP and UDP regex branches
- **Committed in:** e6795de

**2. jest.unstable_mockModule for built-ins**
- **Found during:** All exec-dependent tests
- **Issue:** Node.js built-in modules cannot be mocked via jest.unstable_mockModule in this ESM setup
- **Fix:** Export pure parser functions; use integration-style tests for OS-dependent code
- **Committed in:** e6795de

## Issues Encountered

None beyond the mocking discovery (fixed by design change).

## Next Phase Readiness

- Dispatcher can now load `tools/process.js` for PRC-* tools
- Plan 03 (network core) can proceed in parallel — no dependencies on process.ts

---
*Phase: 01-process-network*
*Completed: 2026-04-07*
