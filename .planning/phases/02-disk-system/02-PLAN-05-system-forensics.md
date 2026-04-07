---
plan: 02-05
wave: 2
title: System Forensics Tools (SYS-14..SYS-25)
phase: 2
depends_on:
  - 02-04
files_modified:
  - src/services/sysint/tools/system/forensics.ts
  - src/services/sysint/tools/system/index.ts
  - src/services/sysint/__tests__/system-forensics.test.ts
  - src/services/sysint/__tests__/fixtures/last-linux.txt
  - src/services/sysint/__tests__/fixtures/prefetch-list.txt
  - src/services/sysint/__tests__/fixtures/jump-list-files.txt
autonomous: true
requirements:
  - SYS-14
  - SYS-15
  - SYS-16
  - SYS-17
  - SYS-18
  - SYS-19
  - SYS-21
  - SYS-23
  - SYS-24
  - SYS-25
---

# Plan 02-05: System Forensics Tools

## Goal

Implement SYS-14..25 in forensics.ts. These are Windows-heavy tools (prefetch, shell extensions, jump lists, login history) with Linux equivalents where available. Update system/index.ts MODULE_MAP.

## Tasks

### Task 1: Login + Boot history (SYS-14, SYS-15)

SYS-14 `login-history`:
- Windows: `Get-WinEvent -FilterHashtable @{LogName='Security'; Id=@(4624,4634)} -MaxEvents 100 | Select-Object TimeCreated,Id,Message | ConvertTo-Json -Compress`
- Linux: `last -n 100 -F 2>/dev/null` — parse tab/space-delimited output. Export `parseLastOutput(text)`.
Row: `{ user, type, fromAddress, loginAt, logoutAt, duration }`.

SYS-15 `boot-history`:
- Windows: `Get-WinEvent -FilterHashtable @{LogName='System'; Id=@(6005,6006,6008)} -MaxEvents 50 | Select-Object TimeCreated,Id,Message | ConvertTo-Json -Compress`
- Linux: `last -n 50 -F reboot 2>/dev/null`
Export `parseBootEvents(json)`.
Row: `{ eventType: 'startup' | 'shutdown' | 'unexpected', timestamp, reason }`.

### Task 2: Prefetch + Shell Extensions (SYS-16, SYS-17)

SYS-16 `prefetch-info`:
- Windows: List `C:\Windows\Prefetch\*.pf` — return file metadata. Parse filename for app name and run count.
  Format: `APPNAME.EXE-HASH.pf` — hash is 8 hex chars.
  Enhanced: `Get-Item 'C:\Windows\Prefetch\*.pf' | Select-Object Name,LastAccessTime,Length | ConvertTo-Json -Compress`
- Linux: Check if `prelink` exists, return stub message if not. Return empty rows.
Export `parsePrefetchList(json)`.
Row: `{ appName, hash, lastRun, runCount, sizeBytes, filePath }`.

SYS-17 `shell-extensions`:
- Windows: PowerShell query of `HKCR:\*\shellex` and `HKLM:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved`.
  ```powershell
  Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved' |
    Select-Object * -ExcludeProperty PS* | ConvertTo-Json -Compress
  ```
- Linux: Return empty rows (N/A, no equivalent).
Row: `{ guid, name, approved, filePath }`.

### Task 3: Security + Environment + Hardware info (SYS-18, SYS-19, SYS-21, SYS-23)

SYS-18 `running-services`: Reuse service-list from Phase 1 PRC-08, filter to running only. Delegate via: `import('../../../tools/system/index.js').then(m => m.run('service-list', args))` then filter `status === 'running'`.

SYS-19 `security-software`:
- Windows: `Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ConvertTo-Json -Compress`
- Linux: Check running processes for known AV names (`clamav`, `sophos`, `symantec`, `avg`, etc.)
Row: `{ name, type, state, definitionsDate, provider }`.

SYS-21 `environment-vars`: `Object.entries(process.env)` — cross-platform. Args: `[filter?]` optional key substring filter.
Row: `{ name, value }`.

SYS-23 `hardware-info`: `si.system()` + `si.bios()` + `si.baseboard()`.
Row: `{ manufacturer, model, version, serial, biosVendor, biosVersion, biosDate, boardManufacturer, boardModel }`.

### Task 4: Last Activity + Jump Lists (SYS-24, SYS-25)

SYS-24 `last-activity`: Aggregate from multiple sources into timeline:
1. Recent files: Windows `%APPDATA%\Microsoft\Windows\Recent\*.lnk` — parse names and timestamps. Linux: `~/.local/share/recently-used.xbel` XML.
2. Last login from `login-history`
3. Recent app launches from prefetch (Windows) or `~/.bash_history` timestamps (Linux)
Merge and sort by timestamp desc, return last 50 events.
Row: `{ timestamp, type: 'file_open' | 'login' | 'app_launch', description, source }`.

SYS-25 `jump-lists`:
- Windows only: Scan `%APPDATA%\Microsoft\Windows\Recent\AutomaticDestinations\` for `.automaticDestinations-ms` files. Return filenames + timestamps + sizes (full parsing of binary format is out of scope — return metadata only).
- Linux: Return `PLATFORM_UNSUPPORTED` (no equivalent).
Export `parseJumpListFiles(files: string[])`.
Row: `{ appId, fileName, lastAccessTime, sizeBytes }`.

### Task 5: Update system/index.ts MODULE_MAP

Add routing for all new tool IDs:
- `login-history`, `boot-history`
- `prefetch-info`, `shell-extensions`
- `running-services`, `security-software`
- `environment-vars`, `hardware-info`
- `last-activity`, `jump-lists`

### Task 6: Tests (system-forensics.test.ts)

Parser unit tests:
- `parseLastOutput(text)` fixture → rows with user/loginAt
- `parseBootEvents(json)` fixture → rows with eventType
- `parsePrefetchList(json)` fixture → rows with appName/hash

Integration tests:
- `environment-vars`: rows has `PATH` entry, all rows have name+value
- `hardware-info`: `manufacturer` is non-empty string
- `running-services`: all rows have `status === 'running'`
- `security-software`: returns rows or empty array (no crash)
- `last-activity`: returns rows or empty array (no crash)

Platform guard tests:
- `jump-lists` on Linux returns `PLATFORM_UNSUPPORTED`
- `shell-extensions` on Linux returns empty rows

Fixtures:
- `last-linux.txt` — sample `last -F` output (5 entries)
- `prefetch-list.txt` — sample PowerShell Get-Item Prefetch JSON (3 entries)
- `jump-list-files.txt` — sample filenames from AutomaticDestinations dir

## Verification

- `environment-vars` returns PATH and HOME on any platform
- `hardware-info` returns manufacturer and bios fields
- `login-history` returns rows or empty (no crash) on Linux
- `jump-lists` on Linux returns PLATFORM_UNSUPPORTED error
- All 10 tool IDs route correctly in MODULE_MAP
