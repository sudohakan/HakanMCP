---
plan: 02-06
wave: 2
title: Catalog Integration + Phase 2 Verification
phase: 2
depends_on:
  - 02-02
  - 02-05
files_modified:
  - data/sysint/catalog.json
  - src/services/sysint/__tests__/disk-system-phase2.test.ts
autonomous: true
requirements:
  - DSK-01
  - DSK-02
  - DSK-03
  - DSK-04
  - DSK-05
  - DSK-06
  - DSK-07
  - DSK-08
  - DSK-09
  - DSK-10
  - DSK-11
  - DSK-12
  - DSK-13
  - DSK-14
  - SYS-01
  - SYS-02
  - SYS-03
  - SYS-04
  - SYS-05
  - SYS-06
  - SYS-07
  - SYS-08
  - SYS-09
  - SYS-10
  - SYS-11
  - SYS-12
  - SYS-13
  - SYS-14
  - SYS-15
  - SYS-16
  - SYS-17
  - SYS-18
  - SYS-19
  - SYS-21
  - SYS-22
  - SYS-23
  - SYS-24
  - SYS-25
---

# Plan 02-06: Catalog Integration + Verification

## Goal

Register all 39 Phase 2 tools in `data/sysint/catalog.json` with correct metadata. Write the phase-level integration test that verifies every tool is reachable via the dispatcher. Run the full sysint test suite.

## Tasks

### Task 1: Update catalog.json — Disk tools (DSK-01..14)

Add 14 entries to the `tools` array under category `"disk"`. Each entry:
```json
{
  "id": "<tool-id>",
  "name": "<human name>",
  "description": "<short description>",
  "category": "disk",
  "adminRequired": false,
  "timeout": 30000,
  "native": true,
  "platforms": ["win32", "linux", "wsl"]
}
```

Tool ID mapping:
| Req | Tool ID | Admin | Platforms |
|-----|---------|-------|-----------|
| DSK-01 | disk-smart | false | win32, linux, wsl |
| DSK-02 | disk-partitions | false | win32, linux, wsl |
| DSK-03 | disk-space | false | win32, linux, wsl |
| DSK-04 | file-search | false | win32, linux, wsl |
| DSK-05 | duplicate-finder | false | win32, linux, wsl |
| DSK-06 | large-files | false | win32, linux, wsl |
| DSK-07 | recent-files | false | win32, linux, wsl |
| DSK-08 | disk-ads | false | win32, wsl |
| DSK-09 | drive-map | false | win32, linux, wsl |
| DSK-10 | disk-io | false | win32, linux, wsl |
| DSK-11 | disk-freespace-log | false | win32, linux, wsl |
| DSK-12 | disk-links | false | win32, linux, wsl |
| DSK-13 | file-hash | false | win32, linux, wsl |
| DSK-14 | disk-recovery | false | win32, linux, wsl |

### Task 2: Update catalog.json — System tools (SYS-01..25)

Add 25 entries under category `"system"`:

| Req | Tool ID | Admin | Platforms |
|-----|---------|-------|-----------|
| SYS-01 | cpu-info | false | win32, linux, wsl |
| SYS-02 | memory-info | false | win32, linux, wsl |
| SYS-03 | os-info | false | win32, linux, wsl |
| SYS-04 | installed-apps | false | win32, linux, wsl |
| SYS-05 | update-history | false | win32, linux, wsl |
| SYS-06 | driver-list | false | win32, linux, wsl |
| SYS-07 | startup-programs | false | win32, linux, wsl |
| SYS-08 | scheduled-tasks | false | win32, linux, wsl |
| SYS-09 | event-log | false | win32, linux, wsl |
| SYS-10 | crash-analysis | false | win32, linux, wsl |
| SYS-11 | usb-history | false | win32, linux, wsl |
| SYS-12 | battery-info | false | win32, linux, wsl |
| SYS-13 | monitor-info | false | win32, linux, wsl |
| SYS-14 | login-history | false | win32, linux, wsl |
| SYS-15 | boot-history | false | win32, linux, wsl |
| SYS-16 | prefetch-info | false | win32, wsl |
| SYS-17 | shell-extensions | false | win32, wsl |
| SYS-18 | running-services | false | win32, linux, wsl |
| SYS-19 | security-software | false | win32, linux, wsl |
| SYS-20 | installed-packages | false | win32, linux, wsl |
| SYS-21 | environment-vars | false | win32, linux, wsl |
| SYS-22 | timezone-info | false | win32, linux, wsl |
| SYS-23 | hardware-info | false | win32, linux, wsl |
| SYS-24 | last-activity | false | win32, linux, wsl |
| SYS-25 | jump-lists | false | win32, wsl |

Also add `"disk"` and `"system"` to the `categories` array if not present.

### Task 3: Phase 2 integration test (disk-system-phase2.test.ts)

Test file that verifies the full Phase 2 dispatch chain. Every tool must be reachable via `runTool(id)` without crashing (errors like PLATFORM_UNSUPPORTED are acceptable; crashes are not).

```typescript
// Test pattern: call each tool, expect SysIntResult shape
const ALL_DISK_TOOLS = ['disk-smart', 'disk-partitions', 'disk-space', 'file-search',
  'duplicate-finder', 'large-files', 'recent-files', 'disk-ads', 'drive-map',
  'disk-io', 'disk-freespace-log', 'disk-links', 'file-hash', 'disk-recovery'];

const ALL_SYSTEM_TOOLS = ['cpu-info', 'memory-info', 'os-info', 'installed-apps',
  'update-history', 'driver-list', 'startup-programs', 'scheduled-tasks',
  'event-log', 'crash-analysis', 'usb-history', 'battery-info', 'monitor-info',
  'login-history', 'boot-history', 'prefetch-info', 'shell-extensions',
  'running-services', 'security-software', 'installed-packages', 'environment-vars',
  'timezone-info', 'hardware-info', 'last-activity', 'jump-lists'];

// For each tool: expect result to have (rows + count) OR (error + code)
// Never: throw, undefined, null
```

Also test:
- `disk-ads` on Linux returns code `PLATFORM_UNSUPPORTED`
- `jump-lists` on Linux returns code `PLATFORM_UNSUPPORTED`
- `file-hash` with args `['<path-to-existing-file>']` returns a hex hash
- `cpu-info` rows[0].cores > 0
- `memory-info` rows[0].totalBytes > 0

### Task 4: Run full sysint test suite

```bash
cd /mnt/c/dev/HakanMCP
npx jest --testPathPatterns='sysint' --no-coverage 2>&1
```

Fix any failures before reporting.

### Task 5: Create SUMMARY.md

Write `/mnt/c/dev/HakanMCP/.planning/phases/02-disk-system/02-SUMMARY.md`:
- Tool count: 39 implemented
- Test count from jest output
- Any known limitations (e.g., smartctl requires external tool)
- Platform notes (which tools are Windows-only)

## Verification

- `catalog.json` contains exactly 39 new entries (14 disk + 25 system)
- `sysint list --category disk` returns 14 native tools
- `sysint list --category system` returns 25 native tools
- Phase 2 integration test: 39/39 tools reachable (some may return PLATFORM_UNSUPPORTED on Linux — that's valid)
- Full sysint test suite passes with 0 failures
