# Cross-Platform System Intelligence Tools: Feature Research

## Executive Summary

Feasibility varies sharply by category. Network and disk tools are 90%+ cross-platform. Password/registry/Outlook are Windows-only. Browser tools are highly portable with caveats. Anti-features: anything that duplicates `ls`, `ps`, `netstat`, `dig` without meaningful aggregation or parsing.

**Priority sequence** (by feasibility + value):
1. **Network** (63 tools) — 85% high-value, portable
2. **Disk** (17 tools) — 70% portable, native equiv exist but NirSoft adds aggregation
3. **System** (74 tools) — 40% portable (many Windows-only telemetry reads)
4. **Browser** (24 tools) — 80% portable with caveats (DPAPI → need alternative crypto)
5. **Process** (11 tools) — 60% portable (proc/stat → ptrace on Linux)
6. **Registry** (10 tools) — 100% Windows-only (no Linux equiv)
7. **Password** (21 tools) — 95% Windows-only (DPAPI core blocker)
8. **Programmer** (15 tools) — 20% portable (mostly Windows dev tools)
9. **Outlook** (6 tools) — 70% portable (file-based access)
10. **Audio** (4 tools) — 40% portable (mixer APIs platform-specific)

---

## Network (63 tools)

### Table Stakes
- **DNS resolution & caching**: `dnslookupview`, `fastresolver`
  - Platform equiv: `dig`, `nslookup`, but NirSoft's value is aggregation + visualization
  - Cross-platform: Yes (libc dns, async ops easy)
- **ARP & IP neighbors**: `ipneighborsview`
  - Platform equiv: `arp -a` (Windows), `ip neigh` (Linux)
  - Cross-platform: Yes (can read `/proc/net/arp` on Linux, `GetIpNetTable` on Windows)
- **TCP/UDP connections**: `tcpconnectionsinspector`, `processtcpsummary`
  - Platform equiv: `netstat -ano` (Windows), `ss -tupan` or `lsof -i` (Linux)
  - Cross-platform: Yes (can wrap ss/netstat OR use libc bindings)
- **Port scanning/reachability**: `downtester`, `fastresolver`
  - Platform equiv: None (niche feature)
  - Cross-platform: Yes (socket-based)
- **Listening ports**: `tcpportinspector`
  - Platform equiv: `netstat -tunlp` (Linux), `netstat -ano` (Windows)
  - Cross-platform: Yes
- **DHCP/IP config**: `dhcplogview` (Windows-only), general IP info portable
  - Platform equiv: `ipconfig /all` (Windows), `ip addr` (Linux)
  - Cross-platform: Partial (DHCP log is Windows Event Log only)

### Differentiators
- **Multi-threaded DNS/IP resolution** with batch processing → aggregates results, filters, sorts
- **Domain hosting info**: WHOIS + DNS records + nameserver check (no native tool)
  - Cross-platform: Yes (external WHOIS API or socket lookups)
- **Packet sniffing for passwords** (`sniffpass` → password category)
- **Hosted network management** (`hostednetworkstarter`) — Windows-only
- **Bluetooth LE scanning** — Windows-only (Linux Bluetooth is different API)

### Anti-features
- Don't rebuild `netstat -ano` verbatim. Only build if adding: process→connection correlation, JSON output, filtering/sorting, rate-based metrics
- Don't duplicate `dig` CLI. Only build if batch-resolving or enriching with hosting info
- Avoid raw `/proc/net/tcp` parsing — too brittle. Use `ss` (Linux) or WMI (Windows) as source

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| DNS lookups | Native | Native | Low |
| ARP table | Native | /proc/net/arp | Low |
| TCP/UDP conns | Native | ss/lsof | Low |
| Port reachability | Socket | Socket | Low |
| WHOIS/domain info | HTTP API | HTTP API | Low |
| Bluetooth LE | WinRT API | BlueZ dbus | Medium |
| Hosted network | Windows-only | — | — |
| DHCP logs | Event Log | /var/lib/dhcp | Medium |
| Packet capture | WinPCAP | libpcap | Medium |

### Complexity: Low–Medium

---

## Disk (17 tools)

### Table Stakes
- **Disk space monitoring**: `freespacelogview`, `diskcountersview`, `driveletterview`
  - Platform equiv: `df`, `du`, `fdisk -l`
  - Cross-platform: Yes (os.statfs on Node.js)
- **File hashing**: `hashmyfiles`
  - Platform equiv: `sha256sum`, `md5sum`
  - Cross-platform: Yes (native crypto modules)
- **Opened files by process**: `openedfilesview`
  - Platform equiv: `lsof -p PID` (Linux), `handle -p PID` (Windows, Sysinternals)
  - Cross-platform: Yes (lsof common, can wrap or use libc)
- **Disk SMART data**: `disksmartview`
  - Platform equiv: `smartctl` (Linux), WMI (Windows)
  - Cross-platform: Yes (smartctl portable, or via WMI/libc)
- **File metadata**: timestamps, attributes, permissions
  - Platform equiv: `ls -la`, `stat`
  - Cross-platform: Yes (fs.stat, fs.readdir)

### Differentiators
- **Duplicate file finder** (`searchmyfiles` component) — aggregates by hash
- **NTFS-specific**: alternate data streams (`alternatestreamview`), symbolic links (`ntfslinksview`), hard links
  - Linux equiv: extended attributes, symlinks, hard links (different semantics)
  - Cross-platform: Partial (APIs differ, NTFS-exclusive features Windows-only)
- **Shadow copy enumeration** (`shadowcopyview`) — Windows VSS only
- **Directory modification time propagation** (`foldertimeupdate`) — useful utility, cross-platform
- **Previous versions recovery** — Windows System Restore only

### Anti-features
- Don't rebuild `df` or `du` verbatim for space monitoring
- Don't just list files — value-add: dedupe detection, hash-based matching, open-file tracking
- Avoid low-level NTFS parsing for ADS/links unless that's the explicit goal

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| Disk space | Native | Native | Low |
| File hashing | Native | Native | Low |
| Opened files | handle.exe | lsof | Low |
| SMART data | WMI | smartctl | Low |
| File permissions | Native | Native | Low |
| Symlinks/hardlinks | Native | Native | Low |
| Alternate streams | NTFS-only | — | — |
| Shadow copies | VSS-only | — | — |
| Deduplication | NTFS-only | — | — |

### Complexity: Low–Medium (Medium for NTFS features)

---

## System (74 tools)

### Table Stakes
- **Running processes**: `cprocess`, task list
  - Platform equiv: `tasklist` (Windows), `ps aux` (Linux)
  - Cross-platform: Yes (libc, /proc)
- **Installed apps**: `installedappview`
  - Platform equiv: registry scan (Windows), `dpkg -l` / `rpm -qa` / `flatpak list` (Linux)
  - Cross-platform: Partial (very different on each platform)
- **Windows updates history**: `fullupdateshistoryview`, `winupdatesview`
  - Platform equiv: Windows Update logs, /var/log/apt or dnf history (Linux)
  - Cross-platform: Partial (Event Log vs syslog, format very different)
- **Driver info**: implicit in `installedappview`, device enumeration
  - Platform equiv: `wmic logicaldisk list`, `lsmod`, `lspci` (Linux)
  - Cross-platform: Partial (device discovery APIs differ sharply)
- **System startup programs**: registry scan (Windows)
  - Platform equiv: /etc/systemd/system/*.service, /etc/init.d/ (Linux)
  - Cross-platform: Partial

### Differentiators
- **Event Log parsing** (`appcrashview`, `fileaccesserrorview`) — Windows-only telemetry
- **Application crash analysis** — Windows Error Reporting only
- **Product key extraction** (`productkeyscanner`) — registry-based, Windows-only
- **App compatibility info** (`appcompatibilityview`) — Windows Compatibility mode, no Linux equiv
- **App resource history** (`appresourcesusageview`) — Windows perf counters, no cross-platform equiv
- **Registry browsing** (multiple tools) — Windows-only, see Registry section

### Anti-features
- Don't rebuild `ps aux` verbatim. Value: per-process resource aggregation, historical data, crash context
- Avoid querying Event Log without value-add (crash correlation, regex filtering)

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| Process list | Native | /proc/stat | Low |
| Installed apps | Registry | pkg managers | Medium |
| Updates history | Event Log | syslog/pkg logs | Medium |
| Driver info | WMI/Registry | lsmod/lspci | Medium |
| Startup programs | Registry | systemd/init.d | Medium |
| App crashes | WER | syslog/core | Medium |
| Perf counters | WMI | /proc/stat | Medium |
| Compatibility modes | Windows-only | — | — |
| Reliability Monitor | Windows-only | — | — |

### Complexity: Medium

---

## Browser (24 tools)

### Table Stakes
- **Browsing history**: `browsinghistoryview`
  - Platforms: Chrome (Leveldb), Firefox (SQLite), Edge (Chromium-based), Safari (Plist)
  - Cross-platform: Yes, multi-browser aggregation is core value
- **Downloaded files history**: `browserdownloadsview`
  - Platform equiv: None (browser-specific)
  - Cross-platform: Yes (similar DBs to history)
- **Bookmarks**: `webbrowserbookmarksview`
  - Platform equiv: None (browser-specific)
  - Cross-platform: Yes (JSON/SQLite formats)
- **Cookies**: `edgecookiesview`, cookie viewers
  - Platform equiv: None (browser-specific)
  - Cross-platform: Yes (SQLite/JSON, but encrypted in Edge/Chrome with DPAPI on Windows)
- **Browser extensions**: `browseraddonsview`
  - Platform equiv: None (browser-specific)
  - Cross-platform: Yes (JSON configs, manifest files)
- **Cache files**: `chromecacheview`
  - Platform equiv: None (but can be manually inspected)
  - Cross-platform: Partial (Chrome cache is proprietary, Firefox simpler)

### Differentiators
- **Multi-browser aggregation** — Chrome, Firefox, Edge, Safari, Opera in single output
- **Cookie decryption** on Windows (DPAPI) — requires elevated access, Windows-only
- **Flash cookies** (`flashcookiesview`) — mostly obsolete now
- **Cache inspection** — forensic value but low practical utility

### Anti-features
- Don't build single-browser viewers (just use `sqlite3` for Firefox, or inspect Chrome Leveldb)
- Cross-platform value is aggregation, not individual tool duplication

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| Chrome history | SQLite | SQLite | Low |
| Chrome cookies | DPAPI-encrypted | Plaintext | Medium |
| Edge history | SQLite | SQLite | Low |
| Edge cookies | DPAPI-encrypted | Plaintext | Medium |
| Firefox history | SQLite | SQLite | Low |
| Firefox cookies | SQLite | SQLite | Low |
| Safari history | Plist | Plist | Low |
| Opera history | SQLite | SQLite | Low |
| Bookmarks (all) | JSON/SQLite | JSON/SQLite | Low |
| Extensions (all) | JSON manifest | JSON manifest | Low |
| Cache inspection | Format-specific | Format-specific | Medium |

### Complexity: Low–Medium (Medium if decrypting DPAPI)

**Platform note**: Linux browsers store cookies in plaintext or unencrypted SQLite. Windows Edge/Chrome use DPAPI, requiring CurrentUser decryption key (Windows-only feature). Firefox on all platforms uses NSS (Network Security Services) with similar key-wrapping but cross-platform NSS library available.

---

## Password (21 tools)

### Table Stakes
Password tools are **95% Windows-only** due to DPAPI (Data Protection API) as the core blocker. Linux has no platform-native equivalent. Consider scope: build a few portable ones (Firefox, Chrome plaintext) and flag Windows-only tools clearly.

- **Firefox password extraction**: `passwordfox`
  - Platform: Windows & Linux (uses NSS library)
  - Cross-platform: Yes (NSS is portable, key3.db / key4.db format understood)
  - Difficulty: Medium (NSS key derivation, SQLite parsing)
- **Chrome plaintext fallback**: Windows plaintext older versions, Linux native plaintext
  - Platform: Windows & Linux (but Windows Edge uses DPAPI, requires admin)
  - Cross-platform: Partial (Chrome on Linux: plaintext or unencrypted; Windows: DPAPI-encrypted)

### Windows-Only (DPAPI-protected, non-portable)
- `chromepass`, `webbrowserpassview` (DPAPI on Windows)
- `vaultpasswordview`, `credentialsfileview`, `credhistview` (Credential Manager/Vault)
- `netpass`, `rdpv`, `mspass`, `mailpv`, `iepv` (Windows credential stores)
- `dataprotectiondecryptor` (DPAPI core — Windows-only API)
- `vncpassview` (VNC registry storage — Windows registry)
- `sniffpass` (packet sniffing for plaintext passwords — portable but network-level)
- `asterie` (asterisk revealer — Windows UI automation, not portable)
- `extpassword`, `lostmypassword` (Windows-specific password recovery)
- `passwordscan` (memory scanning — platform-specific but possible on both)
- `securityquestionsview` (Windows Vault, DPAPI)

### Differentiators
- **Firefox extraction** — one of few cross-platform password tools
- **Memory scanning** (`passwordscan`) — process-level, both platforms possible but fragile
- **Packet sniffing** (`sniffpass`) — legacy (modern apps use TLS)

### Anti-features
- Don't try to replicate DPAPI decryption on Linux (impossible without Windows Key Management Service)
- Don't build tools that require admin/root unless necessary for value-add

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| Firefox NSS keys | NSS library | NSS library | Medium |
| Chrome plaintext | Rarely (old ver) | Native | Low |
| Chrome DPAPI | Admin+DPAPI | — | — |
| Vault decryption | DPAPI | — | — |
| RDP password | Registry | — | — |
| VNC password | Registry | — | — |
| Memory scanning | API | /proc | Medium |
| Network sniffing | WinPCAP | libpcap | Medium |

### Complexity: Medium–High (High due to crypto)

**Recommendation**: Build Firefox NSS extractor first (portable, ~Medium effort). Mark 19 DPAPI-protected tools as Windows-only. Consider flagging as security-sensitive (needs elevation, user consent).

---

## Registry (10 tools)

### Platform Feasibility: Windows-Only (100%)

Linux has no registry equivalent. No cross-platform value.

| Feature | Windows | Linux |
|---------|---------|-------|
| Registry read | Native | — |
| Registry search | Native | — |
| Registry diff | Native | — |
| Offline hive read | Native | — |
| Registry export | Native | — |
| Change monitoring | Native | — |
| Encrypted value decrypt | DPAPI | — |

### Table Stakes (Windows-only)
- `regscanner` — search registry keys/values
- `offlineregistryview` — read hive files (forensics)
- `registrychangesview` — diff two snapshots
- `regfileexport` — export to .reg format
- `userassistview` — program execution history
- `shellbagsview` — folder view history (forensics)
- `muicacheview` — application descriptions

### Complexity: Low–Medium

**Recommendation**: Build all 10 for Windows. Skip Linux entirely. Market as "Windows forensics" category.

---

## Process (11 tools)

### Table Stakes
- **Process list with details**: `cprocess`, `processthreadsview`
  - Platform equiv: `ps aux`, tasklist (Windows)
  - Cross-platform: Yes (libc, /proc)
- **Loaded DLLs/shared libraries**: `loadeddllsview`
  - Platform equiv: `lsof -p PID | grep .so/.dll`, `wmic process list` (Windows)
  - Cross-platform: Yes (lsof on Linux, handle/wmic on Windows)
- **Process TCP/UDP connections**: `processtcpsummary`
  - Platform equiv: `netstat -aubp` (Linux), `netstat -ano` (Windows)
  - Cross-platform: Yes (ss/lsof, or libc bindings)
- **Thread info**: `allthreadsview`, `processthreadsview`
  - Platform equiv: `/proc/[pid]/task/` (Linux), `tasklist /m` (Windows)
  - Cross-platform: Yes
- **GDI/handle counts**: `gdiview`, `handlecountersview`
  - Platform equiv: Windows-only (GDI is Windows GUI API)
  - Cross-platform: No (Linux has no GDI)

### Differentiators
- **What's hanging process** (`whatishang`) — investigates blocking syscalls/waits
  - Cross-platform: Partial (strace on Linux, not directly on Windows without Tools)
- **Process activity monitoring** (`processactivityview`) — real-time file I/O, registry, network
  - Cross-platform: Partial (strace/auditd on Linux; ETW on Windows)
- **Run from process** (`runfromprocess`) — impersonate token from another process
  - Cross-platform: No (Windows security model only)

### Anti-features
- Don't rebuild `ps aux`. Value: process→connection correlation, DLL tracking, real-time activity
- Avoid GDI tools on Linux (no equivalent)

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| Process list | Native | /proc | Low |
| Process details | Native | /proc | Low |
| Loaded DLLs | handle.exe | lsof | Low |
| TCP/UDP by process | netstat/ss | netstat/ss | Low |
| Threads | tasklist/WMI | /proc/task | Low |
| GDI handles | Windows-only | — | — |
| Handle counts | Windows-only | — | — |
| Real-time activity | ETW | strace/auditd | Medium |
| Token impersonation | Windows-only | — | — |

### Complexity: Low–Medium

---

## Programmer (15 tools)

### Table Stakes
Most are Windows-only developer/admin tools. Low cross-platform value.

- **DLL export viewer**: `dllexp`
  - Platform equiv: `nm`, `objdump` (Linux)
  - Cross-platform: Partial (different formats for .so vs .dll)
- **Resource extraction**: `resourcesextract`, `iconsext`
  - Platform equiv: None (Windows PE-specific)
  - Cross-platform: No
- **.NET tools**: `gacview`, `dotnetresourcesextract`
  - Platform equiv: None (or .NET Core/Mono tools)
  - Cross-platform: Partial (.NET Core on Linux, but GAC is Windows-only concept)
- **COM/ActiveX tools**: `axhelper`, `awatch`, `regdllview`
  - Platform equiv: None (Windows COM only)
  - Cross-platform: No
- **Debugging**: `simpleprogramdebugger`
  - Platform equiv: `gdb`, `lldb` (but NirSoft tool is GUI wrapper)
  - Cross-platform: No (Windows API-specific)

### Differentiators
- None that are meaningfully cross-platform
- `htmlastext`, `csvfileview`, `tabletextcompare` are general utilities, not programmer-specific

### Anti-features
- Skip most of these. Very Windows-focused.
- Only build if you have a specific use case (e.g., extracting icons from PE binaries for inventory).

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| DLL export viewer | Native | objdump (different) | Low |
| Resource extraction | PE format | — | — |
| Icon extraction | PE format | — | — |
| COM enumeration | Windows-only | — | — |
| .NET GAC | Windows-only | — | — |
| Registry tools | Windows-only | — | — |
| Debugger UI | Windows API | — | — |

### Complexity: Low (but Windows-only)

**Recommendation**: Build DLL export viewer if you need Windows PE introspection. Skip the rest unless you have specific forensics/inventory goals. Not worth cross-platform effort.

---

## Outlook (6 tools)

### Table Stakes
- **Email file access** — .pst, .ost (Outlook), .eml (standard)
  - Platform equiv: None (Outlook-specific)
  - Cross-platform: Partial (PST is proprietary, but libraries exist: libpst, python-outlook)
- **Attachment extraction** — from mail files
  - Platform equiv: None (mail-specific)
  - Cross-platform: Yes (if parsing PST/EML)

### Differentiators
- PST parsing is niche but valuable for forensics/migration
- Email recovery/analysis not provided by standard tools

### Anti-features
- Don't build unless you need email forensics/migration
- Use existing `libpst` or `libvsmapi` libraries (Node.js bindings exist)

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| PST parsing | libpst | libpst | Medium |
| EML parsing | Native | Native | Low |
| Attachment extract | libpst | libpst | Medium |
| Recovery | Windows-only | — | — |

### Complexity: Medium

**Recommendation**: Build basic PST/EML readers if forensics is a priority. Low demand otherwise.

---

## Audio (4 tools)

### Table Stakes
- **Installed codecs** — audio/video formats
  - Platform equiv: `ffmpeg -codecs`, system-level APIs
  - Cross-platform: Partial (codec list APIs differ sharply)
- **Volume control** — per-app and system
  - Platform equiv: `pactl` (Linux PulseAudio), WMI (Windows)
  - Cross-platform: Partial (PulseAudio vs Pipewire vs ALSA on Linux, multiple APIs on Windows)

### Differentiators
- Per-app volume control — useful but platform APIs very different

### Anti-features
- Skip unless you have audio management needs
- OS APIs too fragmented to justify cross-platform build

### Platform Feasibility

| Feature | Windows | Linux | Difficulty |
|---------|---------|-------|------------|
| Codec list | WMI | ffmpeg/system | Medium |
| Volume control | WMI | PulseAudio/ALSA | Medium |
| Audio config | WMI | DBus/config | High |

### Complexity: High (due to audio subsystem fragmentation)

**Recommendation**: Skip unless you have a specific audio automation need. Too platform-specific.

---

## Summary Table: Feasibility & Priority

| Category | Tools | Portable | Feasibility | Priority | Complexity | Notes |
|----------|-------|----------|------------|----------|------------|-------|
| Network | 63 | 85% | High | 1 | Low–Med | 53+ tools, strong cross-platform story |
| Disk | 17 | 70% | High | 2 | Low–Med | Dedup, hash, opened files valuable |
| System | 74 | 40% | Medium | 3 | Medium | Many Windows-only (telemetry, Event Log) |
| Browser | 24 | 80% | High | 4 | Low–Med | Multi-browser aggregation is key |
| Process | 11 | 60% | Medium | 5 | Low–Med | GDI/handle tools Windows-only |
| Registry | 10 | 0% | Low | 6 | Low | Windows forensics only |
| Password | 21 | 5% | Low | 7 | Med–High | DPAPI blocker, except Firefox |
| Outlook | 6 | 50% | Low | 8 | Medium | Forensics niche |
| Programmer | 15 | 20% | Low | 9 | Low | Windows dev tools, skip if no need |
| Audio | 4 | 25% | Low | 10 | High | Too fragmented, skip |

---

## Recommended Build Strategy

### Phase 1: Core Portable (Effort: ~4–6 weeks, Value: High)
1. **Network** (select 15–20 high-value tools)
   - DNS aggregation + enrichment (WHOIS, nameserver check)
   - ARP table readers
   - TCP/UDP connection tracking
   - Port reachability
2. **Disk** (select 10 tools)
   - Space monitoring (df aggregation + JSON)
   - File hashing (sha256, md5, crc32)
   - Opened files by process
   - Duplicate detection (hash-based)

### Phase 2: Browser + System (Effort: ~3–4 weeks, Value: High)
3. **Browser** (select 8–10 tools)
   - Multi-browser history aggregator
   - Bookmarks + extensions aggregator
   - Cookies (with DPAPI caveat on Windows)
4. **System** (select 15–20 tools)
   - Process list + connections
   - Installed apps (aggregator across pkg managers)
   - Updates history (with platform-specific parsing)

### Phase 3: Windows-Only + Forensics (Effort: ~2–3 weeks, Value: Medium)
5. **Registry** (all 10 tools) — Windows-only label
6. **Process** (select 6–8 tools) — handle counts, DLL tracking
7. **Outlook** (select 3 tools) — PST reader, attachment extractor

### Phase 4: Opportunistic (Only if demand)
8. **Password** — Firefox NSS extractor only (Windows/Linux); flag DPAPI tools as unsupported
9. **Programmer** — DLL export viewer, if PE introspection needed
10. **Audio** — Skip entirely

---

## Anti-Features & Scope Discipline

### Do Not Build
- Single-platform wrappers (e.g., just wrapping `netstat` output)
- Tools that only duplicate existing OS commands without aggregation/enrichment
- GUI-dependent tools (Outlook recovery, Application Compatibility View)
- Real-time monitoring dashboards (NirSoft's real-time tools → output single snapshot instead)

### Do Build (Value-Add Examples)
- **Aggregated DNS** (single query across all cached entries, deduplicated results)
- **Multi-browser history** (Chrome + Firefox + Edge → single JSON output)
- **Duplicate file detector** (scan by hash, correlation)
- **Process TCP summary** (all processes → connections in single output)
- **Forensic snapshots** (registry export, file audit logs, event log parsing)

### Build Trade-Off: Effort vs Cross-Platform %
- **Network & Disk**: 85%+ portable → Always build
- **Browser & System**: 40–80% portable → Build portable parts first, Windows-only as phase 2
- **Registry & Password**: <10% portable → Windows-only features, minor effort for Linux to handle missing gracefully
- **Programmer & Audio**: <25% portable → Only build if solving specific customer problem

---

## Implementation Notes

### Crypto & Security Considerations
- **DPAPI** (Windows-only): Require admin/elevated token access. Document clearly.
- **Firefox NSS**: Portable but requires libgcrypt or Node.js crypto bindings. Medium complexity.
- **Chrome DPAPI on Windows**: Only works if tool runs as user or system account with key access.
- **Password scanning**: Document legal/compliance implications (corporate networks may prohibit).

### Database & File Parsing
- **SQLite** (Chrome, Firefox history/cookies) — use `sqlite3` npm or better-sqlite3
- **LevelDB** (Chrome cache, very rare) — use `leveldb` npm (overkill for our use case, skip)
- **Plist** (Safari history) — use `bplist-parser` npm
- **NTFS streams** (Windows only) — use `fs.readFileSync` with stream path syntax (e.g., `file:stream`)
- **Registry hives** — use `registry-parser` or libc bindings (Windows) / no Linux equiv

### Output Standardization
- Default: JSON array of objects
- Optional: CSV (for tools that produce tabular data)
- Optional: Raw (machine-readable format per tool, e.g., sqlite dump, pcap file)
- Schema version in output (for compatibility, future changes)

### Error Handling
- Tools should fail gracefully on unsupported platforms (not throw)
- Report missing dependencies (libpcap, smartctl, etc.) with helpful install instructions
- Permissions errors (denied access to file/registry) should surface clearly (not silent failures)

---

## Risk Mitigation

### High-Risk Areas
1. **DPAPI decryption**: Requires Windows token context. May fail silently on WSL or non-user-run contexts.
   - Mitigation: Explicit platform check, clear error message, documentation
2. **Packet capture** (sniffpass, etc.): Requires elevated privileges and may be denied by network policy.
   - Mitigation: Check for CAP_NET_RAW (Linux) / admin (Windows), early fail
3. **Memory scanning**: Fragile, permission-heavy, may crash on modern OSs.
   - Mitigation: Only if core feature; add process separation, sandboxing
4. **Event Log parsing**: Format changes across Windows versions.
   - Mitigation: Version detection, graceful fallback to raw XML

### Low-Risk Areas
- Network tools (mostly read-only, standard APIs)
- File/disk tools (standard fs APIs)
- Browser history (standard databases, widely-used parsers)

---

*Research completed 2026-04-07. Next: Phase 1 detailed task breakdown.*
