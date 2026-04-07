# Phase 2: Disk + System - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

39 native cross-platform tools: disk intelligence (DSK-01..14) and system telemetry (SYS-01..25). Builds on Phase 0 foundation and Phase 1 patterns (category shim, platform adapters).

</domain>

<decisions>
## Implementation Decisions

### Disk tools approach
- SMART data: `smartctl` CLI wrapper (cross-platform, pre-installed on most Linux, Windows needs smartmontools)
- Partition/volume listing: `systeminformation.diskLayout()` + `blockDevices()`
- Drive space: `systeminformation.fsSize()`
- File search: recursive `fs.readdir` with pattern/size/date filters, streaming results
- Duplicate finder: hash-based (SHA256), group by hash, configurable min-size threshold
- Large file finder: sort by size after recursive scan
- Recently modified: recursive scan with mtime filter
- ADS viewer: Windows-only, `dir /r` or PowerShell `Get-Item -Stream *`
- Drive mapping: Windows `wmic logicaldisk`, Linux `/proc/mounts`
- Disk IO counters: `systeminformation.disksIO()`
- Free space log: snapshot current free space, append to local JSON log
- Symlink/junction listing: recursive scan with `fs.lstat()` checking `isSymbolicLink()`
- File hash calculator: `crypto.createHash()` — cross-platform
- Deleted file recovery: Windows shadow copy info via `vssadmin list shadows`, Linux extundelete metadata

### System tools approach
- CPU/memory/OS: `systeminformation` package (already installed in Phase 1)
- Installed apps: Windows `Get-ItemProperty HKLM:\...\Uninstall\*`, Linux `dpkg -l` / `rpm -qa`
- Update history: Windows `Get-HotFix`, Linux `apt history` / `dnf history`
- Drivers: Windows `driverquery /FO CSV`, Linux `lsmod`
- Startup programs: Windows `Get-CimInstance Win32_StartupCommand`, Linux `systemctl list-unit-files --state=enabled`
- Scheduled tasks: Windows `schtasks /Query /FO CSV`, Linux `crontab -l` + `systemctl list-timers`
- Event log: Windows `Get-WinEvent`, Linux `journalctl --output=json`
- BSOD: Windows minidump parsing in `C:\Windows\Minidump\`, Linux `dmesg | grep -i panic`
- USB history: Windows registry `HKLM\SYSTEM\CurrentControlSet\Enum\USB`, Linux `lsusb` + `/var/log/syslog`
- Battery: `systeminformation.battery()`
- Monitor: `systeminformation.graphics()` displays array
- Login history: Windows Event ID 4624/4634, Linux `last` command
- Boot/shutdown: Windows Event IDs 6005/6006, Linux `last -x`
- Prefetch: Windows `C:\Windows\Prefetch\*.pf` metadata, Linux prelink (stub if unavailable)
- Shell extensions: Windows registry `HKCR\*\shellex`, Linux N/A (stub)
- Services: reuse Phase 1 PRC-08 service listing
- Security software: Windows Security Center WMI, Linux check common antivirus processes
- Installed packages: Windows `winget list` / `choco list`, Linux `dpkg -l` / `rpm -qa`
- Environment vars: `process.env` — cross-platform
- Timezone/locale: `Intl.DateTimeFormat().resolvedOptions()` — cross-platform
- Hardware info: `systeminformation.system()` + `bios()` + `baseboard()`
- Last activity: aggregate recent file modifications, logins, app launches into timeline
- Jump list: Windows `%APPDATA%\Microsoft\Windows\Recent\AutomaticDestinations\`, Linux N/A

### Module organization
- `tools/disk.ts` — single file if under 800 lines, otherwise split like network
- `tools/system/` — multi-file directory with sub-modules (info, apps, events, hardware, forensics) + index + shim
- Follow Phase 1 shim pattern for multi-file categories

### Claude's Discretion
- Exact sub-module split boundaries for system tools
- Test fixture data
- smartctl output parsing approach
- Whether to bundle related tools (e.g., CPU+memory+OS into single info module)

</decisions>

<specifics>
## Specific Ideas

- Duplicate file finder should stream progress (large directories can take time)
- Event log reader should support filtering by level (error, warning, info) and time range
- Hardware info should include serial numbers where available (useful for asset management)
- Last activity viewer should aggregate from multiple sources into a unified timeline

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-disk-system*
*Context gathered: 2026-04-07*
