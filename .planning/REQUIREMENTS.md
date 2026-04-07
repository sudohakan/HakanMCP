# Requirements: SysInt

**Defined:** 2026-04-07
**Core Value:** AI agent'larin herhangi bir platformda sistem bilgisine programatik erisimi — GUI veya platform kisitlamasi olmadan

## v1 Requirements

### Foundation

- [ ] **FND-01**: Platform abstraction layer (AbstractSysIntPlatform, WindowsPlatform, LinuxPlatform, WSLBridge)
- [ ] **FND-02**: Tool catalog loader (catalog.json, 250 tool definitions)
- [ ] **FND-03**: Output formatter (JSON default, CSV/raw opsiyonel, schema validation)
- [ ] **FND-04**: MCP dispatcher (sysint tool: list/info/run actions)
- [ ] **FND-05**: Privilege helper (admin/root detection, escalation, fail-fast)
- [ ] **FND-06**: Path helper (cross-platform normalization, WSL path conversion)
- [ ] **FND-07**: Lazy loading (startup: catalog only, first-use: category module import)
- [ ] **FND-08**: Unified dispatcher (sysint native first, nirsoft binary fallback)

### Network

- [ ] **NET-01**: TCP/UDP connection listing (cports equivalent, process correlation)
- [ ] **NET-02**: Network interface listing (IP, MAC, speed, status)
- [ ] **NET-03**: DNS query/lookup (dnsdataview equivalent)
- [ ] **NET-04**: Wi-Fi network listing (SSID, signal, channel, security)
- [ ] **NET-05**: Wi-Fi history (previously connected networks)
- [ ] **NET-06**: Ping/latency testing (multi-host parallel)
- [ ] **NET-07**: Port scanner (TCP connect scan)
- [ ] **NET-08**: Route table viewer
- [ ] **NET-09**: ARP table viewer
- [ ] **NET-10**: MAC address resolver
- [ ] **NET-11**: WHOIS lookup
- [ ] **NET-12**: Traceroute with geo-IP
- [ ] **NET-13**: HTTP header viewer
- [ ] **NET-14**: Network traffic statistics (bytes in/out per interface)
- [ ] **NET-15**: Wake-on-LAN sender
- [ ] **NET-16**: Bandwidth tester (download speed)
- [ ] **NET-17**: Network connection log (historical)
- [ ] **NET-18**: SSL certificate checker
- [ ] **NET-19**: Bluetooth device scanner
- [ ] **NET-20**: Network share listing (SMB/NFS)

### Process

- [ ] **PRC-01**: Process listing (PID, name, CPU%, memory, user, command line)
- [ ] **PRC-02**: Process-to-connection mapping (PID → TCP/UDP ports)
- [ ] **PRC-03**: Loaded library/DLL listing per process
- [ ] **PRC-04**: Thread listing per process
- [ ] **PRC-05**: Handle/file descriptor listing per process
- [ ] **PRC-06**: Process IO activity (read/write bytes)
- [ ] **PRC-07**: Process tree (parent-child relationships)
- [ ] **PRC-08**: Service listing (Windows services, Linux systemd units)

### System

- [ ] **SYS-01**: CPU info (model, cores, frequency, load)
- [ ] **SYS-02**: Memory info (total, used, available, swap)
- [ ] **SYS-03**: OS info (version, build, architecture, uptime)
- [ ] **SYS-04**: Installed applications listing
- [ ] **SYS-05**: Windows Update / package update history
- [ ] **SYS-06**: Installed drivers listing
- [ ] **SYS-07**: Startup programs listing
- [ ] **SYS-08**: Scheduled tasks listing
- [ ] **SYS-09**: Event log reader (Windows Event Log, Linux syslog/journald)
- [ ] **SYS-10**: BSOD/crash analysis (Windows minidump, Linux dmesg panic)
- [ ] **SYS-11**: USB device history
- [ ] **SYS-12**: Battery info (capacity, health, charge cycles)
- [ ] **SYS-13**: Monitor/display info (resolution, refresh rate, model)
- [ ] **SYS-14**: Login history (winlogon, lastlog)
- [ ] **SYS-15**: System boot/shutdown times
- [ ] **SYS-16**: Prefetch/preload analysis (Windows prefetch, Linux prelink)
- [ ] **SYS-17**: Shell extensions listing (Windows)
- [ ] **SYS-18**: Running services listing
- [ ] **SYS-19**: Security software detection
- [ ] **SYS-20**: Installed packages listing (dpkg/rpm/choco/winget)
- [ ] **SYS-21**: Environment variable listing
- [ ] **SYS-22**: Timezone and locale info
- [ ] **SYS-23**: Hardware info (motherboard, BIOS, serial)
- [ ] **SYS-24**: Last activity viewer (forensics aggregation)
- [ ] **SYS-25**: Jump list viewer (Windows recent files)

### Disk

- [ ] **DSK-01**: Disk SMART data reader
- [ ] **DSK-02**: Partition/volume listing
- [ ] **DSK-03**: Drive space summary (used, free, percentage)
- [ ] **DSK-04**: File search (name pattern, size, date filters)
- [ ] **DSK-05**: Duplicate file finder (hash-based)
- [ ] **DSK-06**: Large file finder
- [ ] **DSK-07**: Recently modified files
- [ ] **DSK-08**: Alternate data stream viewer (NTFS, Windows-only)
- [ ] **DSK-09**: Drive letter/mount point mapping
- [ ] **DSK-10**: Disk IO counters (read/write IOPS, throughput)
- [ ] **DSK-11**: Free space log (historical tracking)
- [ ] **DSK-12**: NTFS junction/symlink listing
- [ ] **DSK-13**: File hash calculator (MD5, SHA1, SHA256)
- [ ] **DSK-14**: Deleted file recovery metadata (Windows shadow copy, Linux extundelete info)

### Browser

- [ ] **BRW-01**: Browsing history reader (Chrome, Firefox, Edge — unified output)
- [ ] **BRW-02**: Bookmark reader (all browsers)
- [ ] **BRW-03**: Cookie reader (all browsers)
- [ ] **BRW-04**: Download history reader
- [ ] **BRW-05**: Browser extension listing
- [ ] **BRW-06**: Autofill data reader
- [ ] **BRW-07**: Cache metadata viewer
- [ ] **BRW-08**: Last search queries
- [ ] **BRW-09**: Browser profile listing
- [ ] **BRW-10**: Saved form data reader

### Password

- [ ] **PWD-01**: Browser saved passwords (Chrome DPAPI + SQLite, Windows-only)
- [ ] **PWD-02**: Firefox saved passwords (NSS, cross-platform)
- [ ] **PWD-03**: Wi-Fi saved passwords (Windows netsh, Linux NetworkManager)
- [ ] **PWD-04**: Windows Credential Manager reader
- [ ] **PWD-05**: Windows Vault reader
- [ ] **PWD-06**: RDP saved credentials reader
- [ ] **PWD-07**: VNC password file reader
- [ ] **PWD-08**: Mail client passwords (Outlook, Thunderbird)
- [ ] **PWD-09**: LSA secrets reader (Windows, admin required)
- [ ] **PWD-10**: Network saved passwords (Windows, admin required)

### Registry

- [ ] **REG-01**: Registry search (key/value by pattern)
- [ ] **REG-02**: Registry change monitor (snapshot diff)
- [ ] **REG-03**: Offline registry hive reader
- [ ] **REG-04**: Startup registry entries
- [ ] **REG-05**: Uninstall registry entries
- [ ] **REG-06**: USB device registry history
- [ ] **REG-07**: Shell association registry
- [ ] **REG-08**: MRU (Most Recently Used) lists

### Programmer

- [ ] **PRG-01**: DLL/SO export listing
- [ ] **PRG-02**: PE/ELF file header reader
- [ ] **PRG-03**: File hash calculator (batch mode)
- [ ] **PRG-04**: .NET assembly info reader
- [ ] **PRG-05**: Resource extractor (icons, strings)
- [ ] **PRG-06**: GAC (Global Assembly Cache) viewer (Windows)

### Outlook

- [ ] **OTL-01**: Outlook attachment listing (PST file reader)
- [ ] **OTL-02**: Outlook mailbox statistics
- [ ] **OTL-03**: Outlook address book reader

### Audio

- [ ] **AUD-01**: Audio device listing (input/output)
- [ ] **AUD-02**: Volume level getter/setter
- [ ] **AUD-03**: Audio codec listing

## v2 Requirements

### Network Extended

- **NET-V2-01**: Real-time packet capture (npcap/libpcap wrapper)
- **NET-V2-02**: DNS sniffer (passive DNS recording)
- **NET-V2-03**: HTTP content sniffer
- **NET-V2-04**: Network adapter speed test

### System Extended

- **SYS-V2-01**: WMI query executor (arbitrary WMI class)
- **SYS-V2-02**: Performance counter reader
- **SYS-V2-03**: Kernel module listing (Linux)

### Browser Extended

- **BRW-V2-01**: Browser session restore reader
- **BRW-V2-02**: IndexedDB reader

## Out of Scope

| Feature | Reason |
|---------|--------|
| GUI interface | AI-agent-first, CLI-only by design |
| macOS support | Windows + Linux covers target users |
| Real-time monitoring daemon | Tools are one-shot; monitoring is a different product |
| NirSoft binary wrapping | Existing nirsoft.ts handles this; SysInt is native reimplementation |
| Mobile device forensics | Out of platform scope |
| Network attack tools | Not a security tool; read-only information gathering only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01..08 | Phase 0 | Pending |
| NET-01..20 | Phase 1 | Pending |
| PRC-01..08 | Phase 1 | Pending |
| DSK-01..14 | Phase 2 | Pending |
| SYS-01..25 | Phase 2 | Pending |
| BRW-01..10 | Phase 3 | Pending |
| PWD-01..10 | Phase 4 | Pending |
| REG-01..08 | Phase 4 | Pending |
| PRG-01..06 | Phase 5 | Pending |
| OTL-01..03 | Phase 5 | Pending |
| AUD-01..03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 117 total
- Mapped to phases: 117
- Unmapped: 0

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after auto-generation from research*
