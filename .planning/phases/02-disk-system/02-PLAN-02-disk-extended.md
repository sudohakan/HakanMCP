---
plan: 02-02
wave: 0
title: Disk Extended Tools (DSK-08..14)
phase: 2
depends_on:
  - 02-01
files_modified:
  - src/services/sysint/tools/disk/ads.ts
  - src/services/sysint/tools/disk/io.ts
  - src/services/sysint/tools/disk/links.ts
  - src/services/sysint/tools/disk/hash.ts
  - src/services/sysint/tools/disk/recovery.ts
  - src/services/sysint/tools/disk/index.ts
  - src/services/sysint/__tests__/disk-extended.test.ts
  - src/services/sysint/__tests__/fixtures/vssadmin-shadows.txt
autonomous: true
requirements:
  - DSK-08
  - DSK-09
  - DSK-10
  - DSK-11
  - DSK-12
  - DSK-13
  - DSK-14
---

# Plan 02-02: Disk Extended Tools

## Goal

Complete DSK-08..14. These include Windows-only tools (ADS, shadow copy), cross-platform IO counters, symlink listing, file hash, and free space log. Update disk/index.ts MODULE_MAP to route new tool IDs.

## Tasks

### Task 1: DSK-08 — ads.ts (Alternate Data Streams, Windows-only)

Tool ID: `disk-ads`. Args: `[path]`.

Platform check: return `PLATFORM_UNSUPPORTED` on Linux.

Windows: `Get-Item -Path <path> -Stream * | Where-Object {$_.Stream -ne ':$DATA'} | Select-Object FileName,Stream,Length | ConvertTo-Json -Compress`

Export `parseAdsOutput(json: string)` for unit tests.

Row: `{ filePath, streamName, sizeBytes }`.

### Task 2: DSK-10 — io.ts (Disk IO Counters)

Tool ID: `disk-io`. Args: none.

Use `si.disksIO()`. Returns cumulative read/write bytes and IOPS per disk.

Row: `{ name, readBytes, writeBytes, readIOPS, writeIOPS }`.

### Task 3: DSK-11 — freespace-log.ts in io.ts

Tool ID: `disk-freespace-log`. Args: `[action?='snapshot']` (snapshot | list).

Snapshot: read current `si.fsSize()`, append to `~/.cache/sysint/freespace-log.json` (create dir if missing).
List: return last 100 snapshots.

Row: `{ timestamp, mountPoint, sizeBytes, freeBytes, usePercent }`.

### Task 4: DSK-12 — links.ts (NTFS Junctions + Symlinks)

Tool ID: `disk-links`. Args: `[rootDir, maxDepth?=3]`.

Cross-platform: `fs.lstat()` checking `isSymbolicLink()`. Read link target via `fs.readlink()`.

Windows additionally: detect junctions via `(Get-Item <path>).Attributes` containing `ReparsePoint`.

Row: `{ path, type: 'symlink' | 'junction', target, exists: boolean }`.

### Task 5: DSK-13 — hash.ts (File Hash Calculator)

Tool ID: `file-hash`. Args: `[filePath, algorithm?='sha256']`.

Supported algorithms: `md5`, `sha1`, `sha256`, `sha512`.

Use `crypto.createHash()` with streaming via `fs.createReadStream()`. No size limit.

Export `computeFileHash(filePath, algorithm)` for unit tests.

Row: `{ path, algorithm, hash, sizeBytes }`.

### Task 6: DSK-14 — recovery.ts (Deleted File Recovery Metadata)

Tool ID: `disk-recovery`. Args: `[drive?]`.

Windows: `vssadmin list shadows /For=<drive> 2>&1` — parse shadow copy info.
Export `parseShadowCopies(output: string)` for unit tests.

Linux: check for `extundelete` — if present, note filesystem type and available recovery options. Otherwise return info about journal-based recovery options.

Row (Windows): `{ id, createdAt, volumeName, originatingMachine, forVolume }`.
Row (Linux): `{ filesystem, journalPresent, recoveryTool, notes }`.

### Task 7: Update disk/index.ts MODULE_MAP

Add all new tool IDs: `disk-ads`, `disk-io`, `disk-freespace-log`, `disk-links`, `file-hash`, `disk-recovery`.

Also add `drive-map` from Plan 01 if not already present.

### Task 8: Tests (disk-extended.test.ts)

- `file-hash`: integration test — hash this file itself (`src/services/sysint/tools/disk/hash.ts`), verify SHA256 is a 64-char hex string
- `disk-ads`: on Linux, verify returns PLATFORM_UNSUPPORTED
- `disk-links`: scan `src/services/sysint/tools/` — verify returns rows with `path` and `type` fields
- `disk-io`: verify returns rows with `readBytes` and `writeBytes` as numbers
- `parseShadowCopies`: fixture test with `vssadmin-shadows.txt`

Fixture: `vssadmin-shadows.txt` — sample vssadmin list shadows output (2-3 shadow copies).

## Verification

- `file-hash` of a known file matches expected hash
- `disk-links` on src dir finds at least 0 rows (no crash on no symlinks)
- `disk-io` returns rows array with number fields
- `disk-ads` on Linux returns error with code `PLATFORM_UNSUPPORTED`
- All new tools registered in MODULE_MAP and reachable via `run(toolId)`
