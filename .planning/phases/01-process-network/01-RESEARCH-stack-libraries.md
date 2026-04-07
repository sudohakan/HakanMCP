---
domain: Stack & Libraries
phase: 1 — Process + Network
---

# Stack & Libraries Research

## Recommended Stack

| Tool | Package | Notes |
|------|---------|-------|
| Process listing | `systeminformation` (must install) | `si.processes()` returns full process list with CPU%, mem, user, cmd |
| Network interfaces | `systeminformation` | `si.networkInterfaces()` — cross-platform |
| TCP/UDP connections | Node built-in `child_process` | `netstat -ano` (Windows), `/proc/net/tcp6` (Linux) |
| DNS lookup | Node built-in `dns` module | `dns.resolve()`, `dns.reverse()` — cross-platform |
| Port scanner | Node built-in `net.Socket` | TCP connect with timeout — no external dep |
| Ping | `child_process` + platform ping | parse output per platform |
| Traceroute | `child_process` | `tracert` (Windows), `traceroute` (Linux) |
| WHOIS | Node built-in `net.Socket` | TCP to port 43 |
| Wake-on-LAN | Node built-in `dgram` | UDP magic packet |
| SSL checker | Node built-in `tls.connect()` | read `getPeerCertificate()` |
| HTTP header view | Node built-in `https.request` | read response headers only |
| Wi-Fi scan | `child_process` | `netsh wlan show networks` (Windows/WSL), `nmcli` (Linux) |
| ARP table | `child_process` | `arp -a` — same format on both platforms |
| Route table | `child_process` | `route print` (Windows), `ip route` (Linux) |
| Bandwidth test | Node built-in `https` | Time a download of a known-size resource |
| Bluetooth | `child_process` | PowerShell `Get-PnpDevice` (Windows/WSL), `bluetoothctl` (Linux) |
| Network shares | `child_process` | `net share` (Windows), `showmount` (Linux) |

## systeminformation — Key APIs for Phase 1

```typescript
import si from 'systeminformation';

// Process list — covers PRC-01
const procs = await si.processes();
// procs.list[i]: { pid, name, cpu, mem, user, command, params }

// Network interfaces — covers NET-02
const ifaces = await si.networkInterfaces();
// iface: { iface, ip4, ip6, mac, speed, operstate }

// Network stats (bytes in/out) — covers NET-14
const stats = await si.networkStats('*');
// stat: { iface, rx_bytes, tx_bytes, rx_dropped, tx_dropped }
```

**systeminformation is NOT in package.json** — must be installed:
```bash
npm install systeminformation
```

## child_process Patterns (established in foundation)

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);

// Already used in privilegeHelper.ts — same pattern for all tools
const { stdout, stderr } = await execAsync('netstat -ano', { timeout: 30_000 });
```

**CRLF normalization** (critical for Windows output):
```typescript
const lines = stdout.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
```

## WSL-Specific Notes

- Wi-Fi tools: WSL has no Wi-Fi stack — fall back to `powershell.exe -Command "netsh wlan ..."` 
- Route table in WSL: Linux `ip route` gives WSL routes, not Windows routes — for Windows routes use PowerShell
- Bluetooth in WSL: no BT stack — PowerShell fallback
- Network shares: WSL can see Windows shares via Linux `smbclient` if installed

## Sources

- systeminformation docs: https://systeminformation.io/
- Node.js net docs: https://nodejs.org/api/net.html
- Node.js dns docs: https://nodejs.org/api/dns.html
- Node.js tls docs: https://nodejs.org/api/tls.html
