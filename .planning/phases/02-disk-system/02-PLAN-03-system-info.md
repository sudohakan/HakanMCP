---
plan: 02-03
wave: 1
title: System Core Info Tools (SYS-01..SYS-05)
phase: 2
depends_on:
  - 02-01
files_modified:
  - src/services/sysint/tools/system.ts
  - src/services/sysint/tools/system/index.ts
  - src/services/sysint/tools/system/info.ts
  - src/services/sysint/tools/system/apps.ts
  - src/services/sysint/__tests__/system-info.test.ts
  - src/services/sysint/__tests__/fixtures/dpkg-list.txt
  - src/services/sysint/__tests__/fixtures/winget-list.json
  - src/services/sysint/__tests__/fixtures/get-hotfix.json
autonomous: true
requirements:
  - SYS-01
  - SYS-02
  - SYS-03
  - SYS-04
  - SYS-05
---

# Plan 02-03: System Core Info Tools

## Goal

Implement SYS-01..05 as the system category module. Create the shim + multi-file structure (mirrors network). Tools use systeminformation heavily — no exec needed for basic hardware.

## Structure

```
src/services/sysint/tools/system.ts        # shim — re-exports from ./system/index.js
src/services/sysint/tools/system/
  index.ts  # dispatcher (MODULE_MAP), run() export
  info.ts   # SYS-01: cpu-info, SYS-02: memory-info, SYS-03: os-info, SYS-22: timezone-info
  apps.ts   # SYS-04: installed-apps, SYS-05: update-history, SYS-20: installed-packages
```

## Tasks

### Task 1: Create shim + index.ts

`system.ts`: `export { run } from './system/index.js';`

`system/index.ts`: MODULE_MAP routing SYS-01..05 tool IDs to sub-module runners. Lazy-load `hardware.ts`, `events.ts`, `forensics.ts` for tools added in Plans 04-06.

### Task 2: SYS-01..03 + SYS-22 — info.ts

SYS-01 `cpu-info`: `si.cpu()`. Row: `{ manufacturer, brand, cores, physicalCores, processors, speed, speedMax, governor, temperature }`. Temperature from `si.cpuTemperature()` if available.

SYS-02 `memory-info`: `si.mem()`. Row: `{ totalBytes, freeBytes, usedBytes, swapTotalBytes, swapFreeBytes, swapUsedBytes }`.

SYS-03 `os-info`: `si.osInfo()` + `si.time()`. Row: `{ platform, distro, release, codename, kernel, arch, hostname, uptime, bootTime }`.

SYS-22 `timezone-info`: `Intl.DateTimeFormat().resolvedOptions()` + `si.time()`. Row: `{ timezone, locale, utcOffset, currentTime }`.

Export `parseCpuInfo(siData)`, `parseMemInfo(siData)`, `parseOsInfo(siData)` for testing.

### Task 3: SYS-04 — apps.ts (Installed Applications)

Tool ID: `installed-apps`. Args: `[filter?]` (optional substring filter on name).

Windows:
```powershell
Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* |
  Select-Object DisplayName,Publisher,DisplayVersion,InstallDate |
  Where-Object {$_.DisplayName} | ConvertTo-Json -Compress
```
Also query `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` and merge.

Linux: `dpkg-query -W -f='${Package}\t${Version}\t${Installed-Size}\n' 2>/dev/null` or `rpm -qa --queryformat '%{NAME}\t%{VERSION}\t%{SIZE}\n' 2>/dev/null`.

Row: `{ name, publisher, version, installDate, sizeBytes }`.

Export `parseInstalledAppsWindows(json)` and `parseInstalledAppsLinux(text)` for fixture tests.

### Task 4: SYS-05 — update history + SYS-20 installed packages in apps.ts

SYS-05 `update-history`: 
- Windows: `Get-HotFix | Select-Object HotFixID,Description,InstalledOn | ConvertTo-Json -Compress`
- Linux: `cat /var/log/dpkg.log | grep ' install ' | tail -100` or `dnf history list --reverse 2>/dev/null | tail -50`

Row: `{ id, description, installedAt, source }`.

SYS-20 `installed-packages`:
- Windows: Try `winget list --source winget 2>/dev/null` then `choco list --local-only 2>/dev/null`
- Linux: same as installed-apps but return package manager format

Row: `{ name, version, source, sizeBytes }`.

Export `parseHotFix(json)` and `parseDpkgLog(text)` for tests.

### Task 5: Tests (system-info.test.ts)

Integration tests (real OS, shape validation):
- `cpu-info`: rows[0] has `cores > 0`, `brand` is string
- `memory-info`: `totalBytes > 0`, `freeBytes <= totalBytes`
- `os-info`: `platform` is 'win32' or 'linux', `uptime` is number

Parser unit tests (fixture-based):
- `parseInstalledAppsWindows(wingetJson)` → array with name/version
- `parseInstalledAppsLinux(dpkgText)` → array with name/version
- `parseHotFix(hotfixJson)` → array with id/installedAt

Fixtures:
- `dpkg-list.txt` — `dpkg-query -W` output sample
- `winget-list.json` — PowerShell Get-ItemProperty JSON sample
- `get-hotfix.json` — Get-HotFix JSON sample

## Verification

- `cpu-info` returns `cores > 0` on current machine
- `memory-info` `freeBytes + usedBytes ≈ totalBytes` (within 5%)
- `installed-apps` returns at least 1 row on any system
- `update-history` returns rows or empty array (no crash)
- All tools in MODULE_MAP, reachable via `run(toolId)`
