# Phase 1: Process + Network - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

28 native cross-platform tools for process inspection (PRC-01..08) and network intelligence (NET-01..20). Each tool plugs into the Phase 0 foundation: platform adapter, catalog, dispatcher, output formatter. No GUI, no external binary dependencies.

</domain>

<decisions>
## Implementation Decisions

### Process tools approach
- Use `systeminformation` package for process listing (CPU%, memory, user) — already in deps
- Process-to-connection mapping: correlate PID from process list with PID from TCP/UDP connections
- Thread/handle listing: Windows via PowerShell `Get-Process -Id X | Select-Object Threads`, Linux via /proc/[pid]/task
- Process tree: parse PPID relationships from process list into parent-child hierarchy
- Service listing: Windows `Get-Service` via PowerShell, Linux `systemctl list-units --type=service`

### Network tools approach
- TCP/UDP connections: Windows `netstat -ano` parsed, Linux `/proc/net/tcp` + `/proc/net/udp` direct read
- Network interfaces: `systeminformation.networkInterfaces()` — cross-platform
- Wi-Fi: Windows `netsh wlan show networks mode=bssid`, Linux `nmcli dev wifi list`
- Wi-Fi history: Windows `netsh wlan show profiles`, Linux NetworkManager connection files
- DNS lookup: Node.js built-in `dns.resolve()` — cross-platform
- Port scanner: TCP connect scan via `net.Socket` — cross-platform
- Ping: `child_process` spawn of platform `ping` command, parse output
- Traceroute: `tracert` on Windows, `traceroute` on Linux
- WHOIS: TCP socket to whois server (port 43) — cross-platform
- ARP table: `arp -a` parsed
- Route table: Windows `route print`, Linux `ip route`
- Wake-on-LAN: UDP magic packet via `dgram` — cross-platform
- Bandwidth test: HTTP download speed measurement
- Bluetooth: Windows PowerShell `Get-PnpDevice -Class Bluetooth`, Linux `bluetoothctl devices`
- Network shares: Windows `net share`, Linux `showmount -e` / `smbclient -L`
- SSL cert checker: `tls.connect()` and read peer certificate — cross-platform

### Output format
- All tools follow Phase 0 output contract: `{ rows, count, timestamp, platform, tool }`
- Each tool defines its own row schema (typed in catalog)

### Error handling
- Platform-unsupported tools: return PLATFORM_UNSUPPORTED error
- Missing system commands (e.g., traceroute not installed): return EXEC_FAILED with install hint
- Timeout: per-tool from catalog, default 30s

### Claude's Discretion
- Internal module organization within tools/process/ and tools/network/
- Exact parsing regex for command outputs
- Test fixture data
- Whether to split into sub-modules or keep per-category files

</decisions>

<specifics>
## Specific Ideas

- Process-to-connection correlation is the key differentiator — NirSoft cports does this, we must match it
- Wi-Fi tools should work in WSL by falling back to PowerShell `netsh` commands
- Port scanner should be fast (parallel socket connects, configurable concurrency)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-process-network*
*Context gathered: 2026-04-07*
