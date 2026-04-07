# Roadmap: SysInt

## Overview

Six phases that build from nothing to a complete cross-platform system intelligence toolkit. Phase 0 lays the architecture every other phase depends on. Phases 1-4 implement tool categories in dependency order (network+process first, then disk+system, then browser, then sensitive credential/registry tools). Phase 5 completes remaining categories and polishes the whole system. Each phase delivers a coherent, independently testable capability.

## Phases

- [ ] **Phase 0: Foundation** - Platform abstraction, catalog loader, MCP dispatcher, output formatter
- [ ] **Phase 1: Process + Network** - Process listing, TCP/UDP connections, network interfaces and utilities (28 tools)
- [ ] **Phase 2: Disk + System** - Disk intelligence and system telemetry (39 tools)
- [ ] **Phase 3: Browser** - Multi-browser history, bookmarks, cookies, downloads (10 tools)
- [ ] **Phase 4: Registry + Password** - Windows registry tools and credential extraction (18 tools)
- [x] **Phase 5: Polish + Stragglers** - Programmer tools, Outlook, Audio, E2E tests, perf benchmarks (12 tools)

## Phase Details

### Phase 0: Foundation
**Goal**: The architectural skeleton is in place — every subsequent phase can plug in a category module and get JSON output, MCP routing, and cross-platform support automatically.
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08
**Success Criteria** (what must be TRUE):
  1. Calling `sysint list` via MCP returns the full catalog of 250+ tool definitions without loading any category module
  2. Calling `sysint info <tool-id>` returns schema, platform support flags, and privilege requirements for any tool
  3. Running a stub tool on both Windows and Linux produces `{ schema_version, rows, count, timestamp, platform }` output
  4. An unprivileged tool invocation that requires admin fails fast with a clear error — not a silent empty result
  5. WSL path normalization correctly converts `/mnt/c/...` to `C:\...` and back in both directions
**Plans**: TBD

### Phase 1: Process + Network
**Goal**: AI agents can query live process state and network activity on both Windows and Linux with process-to-connection correlation.
**Depends on**: Phase 0
**Requirements**: PRC-01, PRC-02, PRC-03, PRC-04, PRC-05, PRC-06, PRC-07, PRC-08, NET-01, NET-02, NET-03, NET-04, NET-05, NET-06, NET-07, NET-08, NET-09, NET-10, NET-11, NET-12, NET-13, NET-14, NET-15, NET-16, NET-17, NET-18, NET-19, NET-20
**Success Criteria** (what must be TRUE):
  1. Process list includes PID, name, CPU%, memory, user, and command line — works on Windows and Linux
  2. Each active TCP/UDP connection row includes the owning process PID and name (not just port numbers)
  3. Wi-Fi network listing returns SSID, signal strength, channel, and security type on both platforms
  4. DNS lookup, WHOIS, and traceroute all return structured JSON rows (not raw text)
  5. Port scanner and ping tester run against multiple targets in parallel and return per-host results
**Plans**: TBD

### Phase 2: Disk + System
**Goal**: AI agents can inspect disk health, file system state, and system telemetry (hardware, OS, installed software, events) on both platforms.
**Depends on**: Phase 1
**Requirements**: DSK-01, DSK-02, DSK-03, DSK-04, DSK-05, DSK-06, DSK-07, DSK-08, DSK-09, DSK-10, DSK-11, DSK-12, DSK-13, DSK-14, SYS-01, SYS-02, SYS-03, SYS-04, SYS-05, SYS-06, SYS-07, SYS-08, SYS-09, SYS-10, SYS-11, SYS-12, SYS-13, SYS-14, SYS-15, SYS-16, SYS-17, SYS-18, SYS-19, SYS-20, SYS-21, SYS-22, SYS-23, SYS-24, SYS-25
**Success Criteria** (what must be TRUE):
  1. Disk SMART data, partition listing, and drive space summary all return valid JSON on Windows and Linux
  2. Duplicate file finder uses hash comparison (not just name/size) and returns file paths grouped by hash
  3. CPU, memory, and OS info tools return structured rows with correct values verified against `uname`/`systeminfo`
  4. Windows Event Log reader returns filtered rows by level/source; Linux equivalent reads journald/syslog
  5. BSOD/crash analysis returns minidump summary on Windows and dmesg panic lines on Linux
**Plans**: TBD

### Phase 3: Browser
**Goal**: AI agents can read browser artifacts (history, bookmarks, cookies, downloads, extensions) across Chrome, Firefox, and Edge in a unified JSON format.
**Depends on**: Phase 2
**Requirements**: BRW-01, BRW-02, BRW-03, BRW-04, BRW-05, BRW-06, BRW-07, BRW-08, BRW-09, BRW-10
**Success Criteria** (what must be TRUE):
  1. Browsing history from Chrome, Firefox, and Edge is returned as unified rows with `browser`, `url`, `title`, and `visit_time` fields
  2. Browser DB reads never crash when the browser is currently open — temp copy approach handles file locks silently
  3. Cookie reader returns structured rows including domain, name, value, and expiry across all supported browsers
  4. Extension listing returns name, version, enabled state, and permissions for each installed extension
  5. All browser tools return an empty rows array (not an error) when the browser is not installed
**Plans**: TBD

### Phase 4: Registry + Password
**Goal**: AI agents can read Windows registry artifacts and extract saved credentials — with explicit platform guards, privilege checks, and no silent failures.
**Depends on**: Phase 3
**Requirements**: REG-01, REG-02, REG-03, REG-04, REG-05, REG-06, REG-07, REG-08, PWD-01, PWD-02, PWD-03, PWD-04, PWD-05, PWD-06, PWD-07, PWD-08, PWD-09, PWD-10
**Success Criteria** (what must be TRUE):
  1. Registry search by key pattern returns matching keys and values; registry snapshot diff shows added/removed/changed entries between two snapshots
  2. All registry tools invoked on Linux return a clear `platform: windows-only` error — not an empty result or crash
  3. Firefox saved passwords are extracted via NSS on both Windows and Linux without requiring admin
  4. Chrome/Edge DPAPI password extraction works on Windows with user-level privilege; returns a platform error on Linux
  5. Wi-Fi saved passwords are retrieved via `netsh` on Windows and NetworkManager on Linux
**Plans**: TBD

### Phase 5: Polish + Stragglers
**Goal**: Remaining tool categories are complete, the full system has E2E test coverage, and performance is verified across tool categories.
**Depends on**: Phase 4
**Requirements**: PRG-01, PRG-02, PRG-03, PRG-04, PRG-05, PRG-06, OTL-01, OTL-02, OTL-03, AUD-01, AUD-02, AUD-03
**Success Criteria** (what must be TRUE):
  1. DLL/SO export listing and PE/ELF header reader return valid structured JSON for sample binaries on their respective platforms
  2. Outlook PST reader returns attachment list and mailbox statistics without requiring Outlook to be installed (direct PST parsing)
  3. Audio device listing returns input and output devices with name, driver, and default status on both platforms
  4. A full E2E test suite runs against all 117 v1 requirements and passes on both Windows and Linux CI environments
  5. Cold startup (catalog load) completes in under 200ms; first tool invocation (category lazy-load + execution) completes in under 2s
**Plans**: TBD

## Progress

**Execution Order:** 0 → 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundation | 0/TBD | Not started | - |
| 1. Process + Network | 0/TBD | Not started | - |
| 2. Disk + System | 0/TBD | Not started | - |
| 3. Browser | 0/TBD | Not started | - |
| 4. Registry + Password | 3/3 | Complete | 2026-04-07 |
| 5. Polish + Stragglers | 3/3 | Complete | 2026-04-07 |
