---
plan: 02-04
wave: 1
title: System Hardware + Telemetry Tools (SYS-06..SYS-13)
phase: 2
depends_on:
  - 02-03
files_modified:
  - src/services/sysint/tools/system/hardware.ts
  - src/services/sysint/tools/system/events.ts
  - src/services/sysint/tools/system/index.ts
  - src/services/sysint/__tests__/system-hardware.test.ts
  - src/services/sysint/__tests__/fixtures/driverquery.csv
  - src/services/sysint/__tests__/fixtures/lsmod.txt
  - src/services/sysint/__tests__/fixtures/winevent-sample.json
autonomous: true
requirements:
  - SYS-06
  - SYS-07
  - SYS-08
  - SYS-09
  - SYS-10
  - SYS-11
  - SYS-12
  - SYS-13
---

# Plan 02-04: System Hardware + Telemetry Tools

## Goal

Implement SYS-06..13 in two sub-modules: hardware.ts (drivers, startup, scheduled tasks, USB, battery, display) and events.ts (event log, BSOD/crash analysis). Update system/index.ts MODULE_MAP.

## Tasks

### Task 1: hardware.ts — drivers, startup, scheduled tasks

SYS-06 `driver-list`:
- Windows: `driverquery /FO CSV /V` — parse CSV output. Export `parseDriverQuery(csv)`.
- Linux: `lsmod` — parse columns. Export `parseLsmod(text)`.
Row: `{ name, description, type, state, startMode, driver }`.

SYS-07 `startup-programs`:
- Windows: `Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | ConvertTo-Json -Compress`
- Linux: `systemctl list-unit-files --state=enabled --type=service --no-pager 2>/dev/null` + parse
Row: `{ name, command, location, user, type }`.

SYS-08 `scheduled-tasks`:
- Windows: `schtasks /Query /FO CSV /V 2>/dev/null` — parse CSV
- Linux: `crontab -l 2>/dev/null` + `systemctl list-timers --all --no-pager 2>/dev/null`
Export `parseScheduledTasks(csv)` and `parseCrontab(text)`.
Row: `{ name, status, nextRunTime, lastRunTime, author, command }`.

### Task 2: hardware.ts — USB, battery, display

SYS-11 `usb-history`:
- Windows: `Get-PnpDevice -Class USB | Select-Object FriendlyName,Status,DeviceID | ConvertTo-Json -Compress`
- Linux: `lsusb -v 2>/dev/null | grep -E '(Bus|Device|ID|Product|Manufacturer)'` or `/var/log/syslog` USB events
Row: `{ deviceId, name, manufacturer, status, connectedAt }`.

SYS-12 `battery-info`: `si.battery()`. Guard: if `hasBattery` is false, return empty rows (not error).
Row: `{ manufacturer, model, voltageDesigned, voltageActual, percent, timeRemaining, charging, hasBattery }`.

SYS-13 `monitor-info`: `si.graphics()` → `displays` array.
Row: `{ model, main, connection, resolutionX, resolutionY, refreshRate, currentResX, currentResY }`.

### Task 3: events.ts — Event Log (SYS-09)

Tool ID: `event-log`. Args: `[level?='all', source?, hours?=24, limit?=100]`.

Windows: PowerShell `Get-WinEvent` with `-FilterHashtable`. Map level: 1=critical, 2=error, 3=warning, 4=information.
```powershell
$filter = @{LogName='System'; StartTime=(Get-Date).AddHours(-24)}
Get-WinEvent -FilterHashtable $filter -MaxEvents 100 | 
  Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,Message | 
  ConvertTo-Json -Compress
```

Linux: `journalctl -n 100 --since "24 hours ago" -o json 2>/dev/null`

Export `parseWinEvent(json)` and `parseJournalctl(json)` for fixture tests.
Row: `{ timestamp, id, level, source, message }`.

### Task 4: events.ts — BSOD/Crash Analysis (SYS-10)

Tool ID: `crash-analysis`.

Windows: Scan `C:\Windows\Minidump\` for `*.dmp` files — return metadata (filename, timestamp, size). Additionally: `Get-WinEvent -FilterHashtable @{LogName='System'; Id=@(41,1001,1002)}` for crash-related events.

Linux: `dmesg | grep -iE '(panic|oops|bug:|kernel BUG)' 2>/dev/null | tail -50`

Export `parseMinidumpList(files: string[])` for unit tests.
Row (Windows): `{ fileName, crashedAt, sizeBytes, bugCheck }`.
Row (Linux): `{ timestamp, message, severity }`.

### Task 5: Update system/index.ts MODULE_MAP

Add routing for all new tool IDs:
- `driver-list`, `startup-programs`, `scheduled-tasks`
- `usb-history`, `battery-info`, `monitor-info`
- `event-log`, `crash-analysis`

### Task 6: Tests (system-hardware.test.ts)

Parser unit tests (fixture-based):
- `parseDriverQuery(csv)` → rows with name/state
- `parseLsmod(text)` → rows with name/size
- `parseScheduledTasks(csv)` → rows with name/status
- `parseWinEvent(json)` → rows with timestamp/level
- `parseMinidumpList([])` → empty array (no crash)

Integration tests (real OS):
- `monitor-info`: returns rows or empty array (no crash on headless)
- `battery-info`: returns rows or empty with `hasBattery` field
- `event-log`: returns rows array (may be empty on Linux with no journald)
- `startup-programs`: returns at least 1 row on any system

Fixtures:
- `driverquery.csv` — sample driverquery /FO CSV output
- `lsmod.txt` — sample lsmod output
- `winevent-sample.json` — sample Get-WinEvent JSON (3-5 events)

## Verification

- `driver-list` returns rows with `name` field on current platform
- `event-log` with `hours=1` returns rows or empty array (no crash)
- `crash-analysis` returns empty array on healthy system (no crash)
- `battery-info` returns rows including `hasBattery` boolean
- All 8 tool IDs route correctly in MODULE_MAP
