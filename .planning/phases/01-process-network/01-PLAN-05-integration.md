---
plan: "05"
wave: 2
depends_on: ["02", "03", "04"]
files_modified:
  - src/services/sysint/__tests__/sysint-phase1.test.ts
  - data/sysint/catalog.json
autonomous: true
requirements:
  - PRC-01
  - PRC-02
  - PRC-03
  - PRC-04
  - PRC-05
  - PRC-06
  - PRC-07
  - PRC-08
  - NET-01
  - NET-02
  - NET-03
  - NET-04
  - NET-05
  - NET-06
  - NET-07
  - NET-08
  - NET-09
  - NET-10
  - NET-11
  - NET-12
  - NET-13
  - NET-14
  - NET-15
  - NET-16
  - NET-17
  - NET-18
  - NET-19
  - NET-20
---

# Plan 05: Integration, E2E Flow, and Phase Completion

**Goal:** End-to-end flow verification through dispatcher — all 28 tools reachable via `runTool()`. TypeScript compilation clean. Full test suite green. Phase 1 success criteria verified.

**Wave 2** — runs after Plans 02, 03, 04 are all complete.

---

## Context

- Plans 02-04 have implemented all tools with unit tests
- This plan verifies the full stack: MCP tool → dispatcher → category module → tool handler → SysIntResult
- Also catches any catalog/dispatcher integration gaps

---

## Tasks

<task id="1-05-01" title="TypeScript compile check and type cleanup">

**What:** Run `npx tsc --noEmit` and fix any type errors across all Phase 1 files.

Common issues to fix:
- Missing `import type` on interfaces used only as types
- `systeminformation` type inference for `.processes()` return shape
- `dns.RecordType` enum usage
- Return type annotations on all exported functions

```bash
cd /mnt/c/dev/HakanMCP
npx tsc --noEmit 2>&1 | head -50
```

Fix all errors. Re-run until clean.

<automated>npx tsc --noEmit 2>&1 | grep "error TS" | wc -l</automated>

</task>

<task id="1-05-02" title="Create integration test: all 28 tools via dispatcher">

**What:** Write `src/services/sysint/__tests__/sysint-phase1.test.ts` — integration tests that exercise the full dispatch chain for all 28 tools.

**Test pattern** (mocks all external calls, tests dispatch routing):

```typescript
import { jest } from '@jest/globals';

// Mock both category modules
jest.unstable_mockModule('../tools/process.js', () => ({
  run: jest.fn().mockImplementation(async (toolId: string) => ({
    rows: [{ toolId, mocked: true }],
    count: 1,
    timestamp: new Date().toISOString(),
    platform: 'linux',
    tool: toolId,
  })),
}));

jest.unstable_mockModule('../tools/network/index.js', () => ({
  run: jest.fn().mockImplementation(async (toolId: string) => ({
    rows: [{ toolId, mocked: true }],
    count: 1,
    timestamp: new Date().toISOString(),
    platform: 'linux',
    tool: toolId,
  })),
}));

describe('Phase 1 Integration — all 28 tools dispatch correctly', () => {
  const PROCESS_TOOLS = [
    'process-list', 'process-connections', 'process-modules',
    'process-threads', 'process-handles', 'process-io',
    'process-tree', 'service-list'
  ];

  const NETWORK_TOOLS = [
    'cports', 'network-interfaces', 'dns-lookup', 'wifi-scan', 'wifi-history',
    'ping-test', 'port-scan', 'route-table', 'arp-table', 'mac-resolve',
    'whois-lookup', 'traceroute', 'http-headers', 'network-stats',
    'wake-on-lan', 'bandwidth-test', 'connection-log', 'ssl-checker',
    'bluetooth-scan', 'network-shares'
  ];

  for (const toolId of [...PROCESS_TOOLS, ...NETWORK_TOOLS]) {
    it(`${toolId} dispatches without NOT_FOUND error`, async () => {
      const result = await runTool(toolId);
      // Should NOT return NOT_FOUND — tool must be in catalog
      if ('code' in result) {
        expect(result.code).not.toBe('NOT_FOUND');
      }
    });
  }
});
```

<automated>npx jest --testPathPattern="sysint-phase1" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-05-03" title="Full test suite run and fix any regressions">

**What:** Run the complete test suite and fix any regressions introduced by Phase 1 code.

```bash
cd /mnt/c/dev/HakanMCP
npx jest --testPathPattern="sysint" 2>&1 | tail -30
```

Expected: All Phase 0 tests still pass (63 tests), all Phase 1 tests pass. Total ~120+ tests.

Fix any failures before proceeding. Common regression causes:
- Circular imports (process.ts imports something that imports dispatcher)
- catalog.json syntax errors from new entries
- Module mock paths in existing tests broken by new file structure

<automated>npx jest --testPathPattern="sysint" 2>&1 | grep -E "(Tests:|Test Suites:)" | tail -5</automated>

</task>

<task id="1-05-04" title="Verify Phase 1 success criteria">

**What:** Manual verification checklist against Phase 1 success criteria.

Run each check and document the result:

**Criterion 1:** Process list includes PID, name, CPU%, memory, user, command line — works on Windows and Linux
```bash
# On current system (Linux/WSL):
node -e "
const { runTool } = await import('./dist/services/sysint/dispatcher.js');
const r = await runTool('process-list');
console.log(JSON.stringify(r.rows[0], null, 2));
"
# Verify: all 6 fields present
```

**Criterion 2:** Each TCP/UDP connection row includes pid and processName
```bash
node -e "
const r = await runTool('cports');
console.log(JSON.stringify(r.rows[0], null, 2));
# Verify: pid + processName both present
"
```

**Criterion 3:** Wi-Fi listing returns SSID, signal, channel, security
- Verify on real hardware OR verify via unit test that row schema includes all 4 fields

**Criterion 4:** DNS lookup returns structured JSON rows
```bash
node -e "
const r = await runTool('dns-lookup', ['example.com']);
console.log(JSON.stringify(r.rows.slice(0, 3), null, 2));
# Verify: rows with type and value fields
"
```

**Criterion 5:** Port scanner and ping run in parallel
- Verified via unit tests (Promise.all/Promise.allSettled pattern)
- Manual: `runTool('ping-test', ['8.8.8.8', '1.1.1.1'])` returns 2 rows

Document results in a comment block at bottom of this plan.

<automated>npx jest --testPathPattern="sysint" 2>&1 | grep "Tests:" | tail -3</automated>

</task>

<task id="1-05-05" title="Commit Phase 1 implementation">

**What:** Stage and commit all Phase 1 implementation files.

Files to commit:
- `package.json` + `package-lock.json` (systeminformation added)
- `data/sysint/catalog.json` (28 new entries)
- `src/services/sysint/tools/process.ts`
- `src/services/sysint/tools/network/` (all files)
- `src/services/sysint/__tests__/process.test.ts`
- `src/services/sysint/__tests__/network-*.test.ts`
- `src/services/sysint/__tests__/sysint-phase1.test.ts`
- `src/services/sysint/__tests__/fixtures/` (all fixture files)

Commit message:
```
feat(sysint): Phase 1 — 28 process + network native tools

Process tools (PRC-01..08): process list, connections, modules, threads,
handles, IO, tree, service listing. Network tools (NET-01..20): TCP/UDP
connections with PID correlation, interfaces, DNS, Wi-Fi scan/history,
parallel ping and port scan, routing, ARP, MAC lookup, WHOIS, traceroute,
HTTP headers, network stats, WOL, bandwidth test, SSL checker,
Bluetooth scan, network shares.

All tools: JSON output, cross-platform (Windows/Linux/WSL), zero binary deps.
Tests: 120+ passing, tsc clean.
```

<automated>npx jest --testPathPattern="sysint" 2>&1 | grep "Tests:" | tail -3</automated>

</task>

---

## Verification Criteria

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx jest --testPathPattern="sysint"` — all tests GREEN (120+ tests)
- [ ] All 28 tools in catalog with `"native": true`
- [ ] `runTool('process-list')` returns `SysIntSuccess` (not error) with rows containing 6 required fields
- [ ] `runTool('cports')` returns rows with `pid` AND `processName`
- [ ] No existing Phase 0 tests broken
- [ ] Phase committed

## Must-Haves (Phase 1 goal: "AI agents can query live process state and network activity")

- All 5 Phase 1 success criteria met (see task 1-05-04)
- MCP `sysint` tool `list` action returns all 28 Phase 1 tools
- MCP `sysint` tool `run` action for any Phase 1 tool returns valid JSON (not NOT_FOUND)
