# Phase 1: Process + Network — Research

**Synthesized:** 2026-04-07
**Domains:** Stack & Libraries, Architecture Patterns, Testing Strategy, Performance + Parallelization

---

## User Constraints

From `01-CONTEXT.md` locked decisions:

- `systeminformation` for process listing and network interfaces (already in deps intent, must install)
- Process-to-connection mapping via PID correlation between process list and TCP/UDP table
- Thread/handle listing: Windows via PowerShell `Get-Process`, Linux via `/proc/[pid]/task`
- Process tree: parse PPID relationships
- Service listing: Windows `Get-Service`, Linux `systemctl list-units --type=service`
- TCP/UDP: `netstat -ano` (Windows), `/proc/net/tcp` + `/proc/net/udp` (Linux)
- Network interfaces: `systeminformation.networkInterfaces()` — cross-platform
- Wi-Fi: `netsh wlan show networks mode=bssid` (Windows/WSL), `nmcli dev wifi list` (Linux)
- Wi-Fi history: `netsh wlan show profiles` (Windows), NetworkManager files (Linux)
- DNS: Node built-in `dns.resolve()` — cross-platform
- Port scanner: TCP connect via `net.Socket` — cross-platform
- Ping: `child_process` spawn, parse per-platform
- Traceroute: `tracert` (Windows), `traceroute` (Linux)
- WHOIS: TCP socket to port 43 — cross-platform
- ARP: `arp -a` — same format both platforms
- Route table: `route print` (Windows), `ip route` (Linux)
- Wake-on-LAN: UDP magic packet via `dgram` — cross-platform
- Bandwidth: HTTP download speed
- Bluetooth: PowerShell `Get-PnpDevice -Class Bluetooth` (Windows/WSL), `bluetoothctl` (Linux)
- Network shares: `net share` (Windows), `showmount` / `smbclient -L` (Linux)
- SSL: `tls.connect()` + `getPeerCertificate()` — cross-platform
- Output contract: `{ rows, count, timestamp, platform, tool }` (Phase 0 standard)
- Error handling: PLATFORM_UNSUPPORTED, EXEC_FAILED with install hint, 30s default timeout

---

## Recommended Stack

| Layer | Package | Notes |
|-------|---------|-------|
| Runtime | Node.js 20+ | Already required |
| Process + interfaces | `systeminformation` | **NOT in package.json — must `npm install systeminformation`** |
| TCP/UDP + services | `child_process` built-in | `execAsync` pattern from privilegeHelper |
| DNS | `dns` built-in | `dns.resolve()`, `dns.promises` |
| Port scanner + ping | `net.Socket` + `child_process` | No external dep |
| WHOIS | `net.Socket` | TCP to port 43 |
| Wake-on-LAN | `dgram` built-in | UDP broadcast |
| SSL check | `tls` built-in | `tls.connect()` |
| HTTP headers | `https` built-in | HEAD request |
| Validation | `zod` | Already installed |
| Test framework | `jest` 30 + `ts-jest` | Already configured |

**Do NOT add:** nmap bindings, raw socket libs, pcap — Node builtins cover all Phase 1 needs.

---

## Architecture Patterns

### Category Module Interface

Dispatcher expects:
```typescript
interface CategoryModule {
  run: (toolId: string, args?: string[]) => Promise<unknown>;
}
```

Phase 1 creates:
- `src/services/sysint/tools/process.ts` (PRC-01..08)
- `src/services/sysint/tools/network.ts` entry point + sub-modules under `tools/network/`

### Internal Dispatch Pattern

```typescript
const TOOL_HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'process-list': runProcessList,
  'cports': runConnections,
  // ...
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = TOOL_HANDLERS[toolId];
  if (!handler) return buildError(`No native handler: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
```

### Network Sub-Module Split (keeps files < 800 lines)

```
src/services/sysint/tools/
├── process.ts              # All PRC-* tools in one file (~400 lines)
└── network/
    ├── index.ts            # Re-exports run()
    ├── connections.ts      # NET-01 (cports)
    ├── interfaces.ts       # NET-02, NET-14
    ├── dns.ts              # NET-03, NET-11, NET-12
    ├── wifi.ts             # NET-04, NET-05
    ├── scanner.ts          # NET-06, NET-07
    └── misc.ts             # NET-08..10, NET-13, NET-15..20
```

### Catalog Tool IDs

**Process tools (category: "process"):**

| Req | Tool ID | Platforms |
|-----|---------|-----------|
| PRC-01 | `process-list` | win32, linux, wsl |
| PRC-02 | `process-connections` | win32, linux, wsl |
| PRC-03 | `process-modules` | win32, linux, wsl |
| PRC-04 | `process-threads` | win32, linux, wsl |
| PRC-05 | `process-handles` | win32, linux, wsl |
| PRC-06 | `process-io` | win32, linux, wsl |
| PRC-07 | `process-tree` | win32, linux, wsl |
| PRC-08 | `service-list` | win32, linux, wsl |

**Network tools (category: "network"):**

| Req | Tool ID | Platforms |
|-----|---------|-----------|
| NET-01 | `cports` | win32, linux, wsl |
| NET-02 | `network-interfaces` | win32, linux, wsl |
| NET-03 | `dns-lookup` | win32, linux, wsl |
| NET-04 | `wifi-scan` | win32, linux, wsl |
| NET-05 | `wifi-history` | win32, linux, wsl |
| NET-06 | `ping-test` | win32, linux, wsl |
| NET-07 | `port-scan` | win32, linux, wsl |
| NET-08 | `route-table` | win32, linux, wsl |
| NET-09 | `arp-table` | win32, linux, wsl |
| NET-10 | `mac-resolve` | win32, linux, wsl |
| NET-11 | `whois-lookup` | win32, linux, wsl |
| NET-12 | `traceroute` | win32, linux, wsl |
| NET-13 | `http-headers` | win32, linux, wsl |
| NET-14 | `network-stats` | win32, linux, wsl |
| NET-15 | `wake-on-lan` | win32, linux, wsl |
| NET-16 | `bandwidth-test` | win32, linux, wsl |
| NET-17 | `connection-log` | win32, wsl |
| NET-18 | `ssl-checker` | win32, linux, wsl |
| NET-19 | `bluetooth-scan` | win32, linux, wsl |
| NET-20 | `network-shares` | win32, linux, wsl |

### Row Type Schemas

```typescript
// PRC-01
interface ProcessRow { pid: number; name: string; cpu: number; memoryBytes: number; user: string; commandLine: string; }

// NET-01
interface ConnectionRow { pid: number; processName: string; protocol: 'TCP'|'UDP'; localAddr: string; localPort: number; remoteAddr: string; remotePort: number; state: string; }

// NET-04
interface WifiNetworkRow { ssid: string; signalDbm: number; channel: number; security: string; bssid: string; }
```

---

## Don't Hand-Roll

- **Process list**: use `systeminformation.processes()` — handles Windows/Linux differences
- **Network interfaces**: use `systeminformation.networkInterfaces()` — handles all adapters
- **DNS**: use `node:dns` promises API — already handles all record types
- **CRLF normalization**: established pattern in `outputFormatter.toCSV()` — reuse
- **execAsync pattern**: established in `privilegeHelper.ts` — copy exactly

---

## Common Pitfalls

| # | Pitfall | Fix |
|---|---------|-----|
| 1 | `systeminformation` not installed | Add to package.json before writing any code that imports it |
| 2 | CRLF in PowerShell/netstat output | `.replace(/\r\n/g, '\n')` immediately after `stdout` |
| 3 | PID correlation: `netstat -ano` PIDs may be 0 for system processes | Handle gracefully — `processName: 'SYSTEM'` for PID 0 |
| 4 | Wi-Fi scan in WSL: no Wi-Fi stack | Detect WSL, execute `powershell.exe netsh wlan ...`, parse Windows output |
| 5 | Port scanner flooding: scanning 0-65535 serially | Batch with concurrency=50, `Promise.allSettled` |
| 6 | `process-handles` requires root on Linux | Return partial results or PRIVILEGE_REQUIRED, not crash |
| 7 | `traceroute` not installed on minimal Linux | Return EXEC_FAILED with install hint: `apt install traceroute` |
| 8 | WSL PowerShell calls: ~200ms overhead per call | One PowerShell call per tool, parse all results locally |
| 9 | systeminformation processes(): full list on busy system = 500+ entries | No filtering in handler — let caller filter via args |
| 10 | `dns.resolve()` returns arrays, not single values | Always return array in row schema for consistency |

---

## Validation Architecture

```
Test framework: jest 30 + ts-jest
Quick run: npx jest --testPathPattern="sysint" --no-coverage
Full suite: npx jest --testPathPattern="sysint"
Estimated runtime: ~15s (Phase 1 additions + existing 63 tests)
```

Mock strategy:
- `child_process.exec` → fixture strings (netstat output, netsh output, etc.)
- `systeminformation` → mock module with fixture data
- Platform detection → `getPlatformName` mock returning 'win32' or 'linux'

Fixture directory: `src/services/sysint/__tests__/fixtures/`

Tests requiring manual verification:
- Wi-Fi scan on real hardware
- Bluetooth scan on real hardware  
- Bandwidth test (network-dependent)
- Traceroute (depends on traceroute binary)

---

## Performance

| Tool | Parallelism | Timeout |
|------|-------------|---------|
| `port-scan` | 50 concurrent socket connects | 2s per port |
| `ping-test` | All hosts in parallel | 10s total |
| `dns-lookup` | All record types in parallel | 5s |
| `traceroute` | Sequential (per-hop) | 60s |
| `bandwidth-test` | Single download | 30s |
| All others | Single call | 30s |

WSL cross-call: batch all per-tool data into one PowerShell invocation. No per-row PowerShell calls.

---

## Open Questions

| # | Question | Stakes |
|---|----------|--------|
| 1 | `connection-log` (NET-17): Windows Event Log log source unclear | Low — can return EXEC_FAILED + note |
| 2 | `mac-resolve` (NET-10): requires OUI database | Low — can fetch from public URL or embed small OUI list |
| 3 | `network-shares` (NET-20) on Linux: `showmount` may not be installed | Low — EXEC_FAILED + install hint |

---

## Sources

- systeminformation: https://systeminformation.io/processes.html
- Node.js net/dns/tls/dgram: https://nodejs.org/api/
- Phase 0 foundation patterns: `src/services/sysint/privilegeHelper.ts`, `dispatcher.ts`

<phase_requirements>
- PRC-01: `process-list` via `si.processes()` — platform-agnostic
- PRC-02: `process-connections` — correlate PID from `cports` with `process-list`
- PRC-03: `process-modules` — Windows `Get-Process -Id X | Select Modules`, Linux `/proc/[pid]/maps`
- PRC-04: `process-threads` — Windows PowerShell `.Threads`, Linux `/proc/[pid]/task/`
- PRC-05: `process-handles` — Windows `Get-Process | Select Handles`, Linux `/proc/[pid]/fd/`
- PRC-06: `process-io` — Linux `/proc/[pid]/io`, Windows PowerShell IO counters
- PRC-07: `process-tree` — derive from PPID field in `si.processes().list`
- PRC-08: `service-list` — Windows `Get-Service`, Linux `systemctl list-units --type=service --output=json`
- NET-01: `cports` — `netstat -ano` (Windows/WSL), `/proc/net/tcp` (Linux), correlate PIDs
- NET-02: `network-interfaces` — `si.networkInterfaces()`
- NET-03: `dns-lookup` — `dns.promises.resolve(host, type)` for A/AAAA/MX/TXT/NS
- NET-04: `wifi-scan` — `netsh wlan show networks mode=bssid`, `nmcli dev wifi list`
- NET-05: `wifi-history` — `netsh wlan show profiles` + per-profile details, NM connection files
- NET-06: `ping-test` — parallel `ping -c 3` / `ping -n 3`, parse RTT + packet loss
- NET-07: `port-scan` — TCP connect scan, parallel with concurrency limit, configurable range
- NET-08: `route-table` — `route print` (Windows), `ip route` (Linux)
- NET-09: `arp-table` — `arp -a` (both platforms, same output format)
- NET-10: `mac-resolve` — OUI database lookup from MAC prefix
- NET-11: `whois-lookup` — TCP socket to whois.iana.org port 43
- NET-12: `traceroute` — `tracert` / `traceroute` output parsed per hop
- NET-13: `http-headers` — `https.request` HEAD, return response headers as rows
- NET-14: `network-stats` — `si.networkStats('*')`
- NET-15: `wake-on-lan` — UDP magic packet via `dgram` to broadcast
- NET-16: `bandwidth-test` — time HTTPS download of known-size file, return Mbps
- NET-17: `connection-log` — Windows netstat with timestamps or Event Log
- NET-18: `ssl-checker` — `tls.connect()`, read `getPeerCertificate()`, parse expiry, issuer
- NET-19: `bluetooth-scan` — PowerShell `Get-PnpDevice -Class Bluetooth`, `bluetoothctl devices`
- NET-20: `network-shares` — `net share` (Windows), `showmount -e localhost` (Linux)
</phase_requirements>
