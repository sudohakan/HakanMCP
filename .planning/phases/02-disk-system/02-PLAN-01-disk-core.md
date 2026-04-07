---
plan: 02-01
wave: 0
title: Disk Core Tools (DSK-01..07)
phase: 2
depends_on: []
files_modified:
  - src/services/sysint/tools/disk.ts
  - src/services/sysint/tools/disk/index.ts
  - src/services/sysint/tools/disk/smart.ts
  - src/services/sysint/tools/disk/space.ts
  - src/services/sysint/tools/disk/search.ts
  - src/services/sysint/__tests__/disk-core.test.ts
  - src/services/sysint/__tests__/fixtures/disk-smart-windows.txt
  - src/services/sysint/__tests__/fixtures/disk-smart-linux.txt
  - src/services/sysint/__tests__/fixtures/disk-space.json
autonomous: true
requirements:
  - DSK-01
  - DSK-02
  - DSK-03
  - DSK-04
  - DSK-05
  - DSK-06
  - DSK-07
---

# Plan 02-01: Disk Core Tools

## Goal

Implement DSK-01..07 as a multi-file disk category module. Follow the same shim pattern as network.ts → network/index.ts.

## Structure

```
src/services/sysint/tools/disk.ts          # shim — re-exports from ./disk/index.js
src/services/sysint/tools/disk/
  index.ts    # dispatcher (MODULE_MAP), run() export
  smart.ts    # DSK-01: disk-smart
  space.ts    # DSK-02: disk-partitions, DSK-03: disk-space, DSK-09: drive-map
  search.ts   # DSK-04: file-search, DSK-05: duplicate-finder, DSK-06: large-files, DSK-07: recent-files
```

## Tasks

### Task 1: Create shim and directory structure

Create `src/services/sysint/tools/disk.ts`:
```typescript
export { run } from './disk/index.js';
```

Create `src/services/sysint/tools/disk/index.ts` with MODULE_MAP routing all 7 tool IDs to sub-module runners.

### Task 2: DSK-01 — disk-smart (smart.ts)

Tool ID: `disk-smart`. Args: `[devicePath?]` (optional, lists all if omitted).

Windows: `Get-PhysicalDisk | Select-Object DeviceId,MediaType,Size,HealthStatus,OperationalStatus | ConvertTo-Json -Compress` via PowerShell. Add SMART attributes via `Get-StorageReliabilityCounter` if available.

Linux: `smartctl -A -j <device>` or `smartctl --scan -j` to get device list then iterate. Fall back to `lsblk -o NAME,SIZE,TYPE,MODEL -J` if smartctl not installed.

Output row shape:
```typescript
interface SmartRow {
  device: string;
  model: string;
  serialNumber: string;
  health: string;
  temperature: number;
  powerOnHours: number;
  reallocatedSectors: number;
  mediaType: string;
  sizeBytes: number;
}
```

### Task 3: DSK-02 + DSK-03 + DSK-09 — space.ts

DSK-02 `disk-partitions`: `si.diskLayout()` + `si.blockDevices()`. Row: `{ device, name, fsType, mountPoint, sizeBytes, type }`.

DSK-03 `disk-space`: `si.fsSize()`. Row: `{ fs, type, sizeBytes, usedBytes, availableBytes, usePercent, mountPoint }`.

DSK-09 `drive-map`:
- Windows: `Get-PSDrive -PSProvider FileSystem | ConvertTo-Json -Compress`
- Linux: parse `/proc/mounts`, filter real filesystems

Row: `{ drive, name, freeBytes, usedBytes, root }`.

### Task 4: DSK-04..07 — search.ts

DSK-04 `file-search`: Args `[rootDir, pattern?, maxDepth?, minSizeBytes?, maxSizeBytes?, modifiedAfter?]`. Recursive `fs.readdir` with `{ withFileTypes: true }`. Stream results, cap at 10000. Apply filters.

Row: `{ path, name, sizeBytes, modifiedAt, createdAt }`.

DSK-05 `duplicate-finder`: Args `[rootDir, minSizeBytes?=1024]`. Two-pass: first group by size, then hash (SHA256 first 64KB for speed) only files with matching sizes. Return groups with 2+ files.

Row: `{ hash, count, sizeBytes, paths: string[] }`.

DSK-06 `large-files`: Args `[rootDir, limit?=50, minSizeBytes?=10485760]`. Recursive scan sorted by size desc.

Row: `{ path, sizeBytes, modifiedAt }`.

DSK-07 `recent-files`: Args `[rootDir, limit?=50, modifiedAfterIso?]`. Recursive scan, sort by mtime desc.

Row: `{ path, sizeBytes, modifiedAt }`.

### Task 5: Tests (disk-core.test.ts)

Test patterns (follow process.test.ts):
- Export `parseDiskSmartWindows(json)` and `parseDiskSmartLinux(json)` from smart.ts for fixture-based unit tests
- Integration tests for disk-space and disk-partitions (real OS, validate row shape)
- Unit test for duplicate-finder logic using in-memory temp dir
- Error case: file-search on non-existent root returns EXEC_FAILED

Fixtures to create:
- `disk-smart-windows.txt` — sample PowerShell Get-PhysicalDisk JSON output
- `disk-smart-linux.txt` — sample smartctl -A -j output
- `disk-space.json` — sample si.fsSize() output

## Verification

- `disk-smart` returns rows with `health` and `sizeBytes` fields on current platform
- `disk-space` rows have `sizeBytes > 0` and `usePercent` between 0-100
- `duplicate-finder` on a dir with known duplicates returns correct groups
- `file-search` with pattern `*.ts` on the src dir returns TypeScript files
- All tools return `{ tool, platform, timestamp, rows, count }` envelope
