# Phase 2: Disk + System — Summary

**Completed:** 2026-04-07
**Tools Implemented:** 39 (14 disk + 25 system)
**Tests:** 315 passing / 0 failing across 21 test suites

## What Was Built

### Disk Tools (DSK-01..14)

| Tool ID | Requirement | Approach |
|---------|-------------|----------|
| disk-smart | DSK-01 | Windows: Get-PhysicalDisk PS. Linux: smartctl -j / lsblk -J fallback |
| disk-partitions | DSK-02 | si.diskLayout() + si.blockDevices() |
| disk-space | DSK-03 | si.fsSize() |
| file-search | DSK-04 | Recursive fs.readdir with pattern/size/date filters, cap 10k |
| duplicate-finder | DSK-05 | Two-pass: group by size → hash first 64KB (SHA256) |
| large-files | DSK-06 | Recursive scan sorted by size desc |
| recent-files | DSK-07 | Recursive scan filtered by mtime |
| disk-ads | DSK-08 | Windows-only: Get-Item -Stream *. PLATFORM_UNSUPPORTED on Linux |
| drive-map | DSK-09 | Windows: Get-PSDrive. Linux: /proc/mounts |
| disk-io | DSK-10 | si.disksIO() aggregate counters |
| disk-freespace-log | DSK-11 | si.fsSize() snapshot → ~/.cache/sysint/freespace-log.json |
| disk-links | DSK-12 | fs.lstat() isSymbolicLink() recursive walk |
| file-hash | DSK-13 | crypto.createHash() streaming (MD5/SHA1/SHA256/SHA512) |
| disk-recovery | DSK-14 | Windows: vssadmin list shadows. Linux: extundelete/testdisk detection |

### System Tools (SYS-01..25)

| Tool ID | Requirement | Approach |
|---------|-------------|----------|
| cpu-info | SYS-01 | si.cpu() + si.cpuTemperature() |
| memory-info | SYS-02 | si.mem() |
| os-info | SYS-03 | si.osInfo() + si.time() |
| installed-apps | SYS-04 | Windows: registry HKLM+HKCU Uninstall. Linux: dpkg/rpm |
| update-history | SYS-05 | Windows: Get-HotFix. Linux: /var/log/dpkg.log / dnf history |
| driver-list | SYS-06 | Windows: driverquery /FO CSV. Linux: lsmod |
| startup-programs | SYS-07 | Windows: Win32_StartupCommand. Linux: systemctl list-unit-files |
| scheduled-tasks | SYS-08 | Windows: schtasks /FO CSV. Linux: crontab + systemctl list-timers |
| event-log | SYS-09 | Windows: Get-WinEvent. Linux: journalctl --output=json |
| crash-analysis | SYS-10 | Windows: Minidump dir + WER events. Linux: dmesg grep panic |
| usb-history | SYS-11 | Windows: Get-PnpDevice -Class USB. Linux: lsusb |
| battery-info | SYS-12 | si.battery() |
| monitor-info | SYS-13 | si.graphics() displays array |
| login-history | SYS-14 | Windows: Event ID 4624/4634. Linux: last -F |
| boot-history | SYS-15 | Windows: Event ID 6005/6006/6008. Linux: last reboot |
| prefetch-info | SYS-16 | Windows: Get-Item C:\Windows\Prefetch\*.pf. Linux: empty rows |
| shell-extensions | SYS-17 | Windows: HKLM Shell Extensions Approved registry. Linux: empty rows |
| running-services | SYS-18 | Delegates to PRC-08 service-list, filters status=running |
| security-software | SYS-19 | Windows: SecurityCenter2 WMI. Linux: ps grep for known AV |
| installed-packages | SYS-20 | Windows: winget list. Linux: dpkg/rpm |
| environment-vars | SYS-21 | process.env entries with optional filter |
| timezone-info | SYS-22 | Intl.DateTimeFormat().resolvedOptions() + si.time() |
| hardware-info | SYS-23 | si.system() + si.bios() + si.baseboard() |
| last-activity | SYS-24 | Aggregates: WinEvent logins + home dir recent files |
| jump-lists | SYS-25 | Windows: AutomaticDestinations dir scan. Linux: PLATFORM_UNSUPPORTED |

## File Structure

```
src/services/sysint/tools/
  disk.ts              # shim → disk/index.js
  disk/
    index.ts           # MODULE_MAP dispatcher
    smart.ts           # DSK-01
    space.ts           # DSK-02, DSK-03, DSK-09
    search.ts          # DSK-04, DSK-05, DSK-06, DSK-07
    ads.ts             # DSK-08
    io.ts              # DSK-10, DSK-11
    links.ts           # DSK-12
    hash.ts            # DSK-13
    recovery.ts        # DSK-14
    shared.ts          # re-exports

  system.ts            # shim → system/index.js
  system/
    index.ts           # MODULE_MAP dispatcher
    info.ts            # SYS-01, 02, 03, 22
    apps.ts            # SYS-04, 05, 20
    hardware.ts        # SYS-06, 07, 08, 11, 12, 13, 23
    events.ts          # SYS-09, 10
    forensics.ts       # SYS-14, 15, 16, 17, 18, 19, 21, 24, 25
    shared.ts          # re-exports
```

## Known Limitations

- `disk-smart` on Linux requires `smartctl` (smartmontools) to be installed for full SMART data; falls back to `lsblk` for basic disk listing
- `disk-ads` and `jump-lists` are Windows/WSL-only (NTFS features)
- `prefetch-info` and `shell-extensions` are Windows/WSL-only
- `event-log` on Linux requires journald to be running; falls back to empty rows on systems without systemd
- `installed-apps` on Windows queries registry directly — large installations (500+) may be slow
- WSL: `disk-ads`, `jump-lists`, `prefetch-info` call PowerShell via `powershell.exe` across the WSL boundary

## Test Coverage

| File | Tests |
|------|-------|
| disk-core.test.ts | 14 |
| disk-extended.test.ts | 27 |
| system-info.test.ts | 12 |
| system-hardware.test.ts | 14 |
| system-forensics.test.ts | 17 |
| disk-system-phase2.test.ts | 46 |
| (Phase 1 + Foundation tests) | 185 |
| **Total sysint** | **315** |
