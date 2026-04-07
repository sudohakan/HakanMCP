---
domain: Architecture Patterns
phase: 1 — Process + Network
---

# Architecture Patterns Research

## Category Module Interface

The dispatcher already defines:
```typescript
interface CategoryModule {
  run: (toolId: string, args?: string[]) => Promise<unknown>;
}
```

Phase 1 creates two category modules:
- `src/services/sysint/tools/process.ts` — handles all PRC-* tools
- `src/services/sysint/tools/network.ts` — handles all NET-* tools

Both are loaded lazily via `getCategoryModule(tool.category)` in dispatcher.

## Module Internal Pattern

Each category module follows the same internal dispatch pattern:

```typescript
// src/services/sysint/tools/process.ts
import { buildSuccess, buildError } from '../outputFormatter.js';
import { getPlatformName } from '../platforms/index.js';
import type { SysIntResult } from '../outputFormatter.js';

const TOOL_HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'process-list': runProcessList,
  'process-connections': runProcessConnections,
  // ...
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = TOOL_HANDLERS[toolId];
  if (!handler) {
    return buildError(`No native handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(args);
}
```

## Catalog Tool ID Convention

Phase 1 native tools get new catalog entries with `"native": true`. Tool IDs follow NirSoft naming where applicable:
- `cports` → TCP/UDP connections (NirSoft-compatible ID, NET-01)
- `process-list` → process listing (PRC-01)
- `netscan` → port scanner (NirSoft-compatible, NET-07)

Full ID list to add to catalog:

**Process category:**
| Req | Tool ID | Description |
|-----|---------|-------------|
| PRC-01 | `process-list` | Process listing |
| PRC-02 | `process-connections` | PID → TCP/UDP ports |
| PRC-03 | `process-modules` | Loaded DLLs/libs per process |
| PRC-04 | `process-threads` | Thread listing per process |
| PRC-05 | `process-handles` | File descriptor listing |
| PRC-06 | `process-io` | Process IO activity |
| PRC-07 | `process-tree` | Parent-child hierarchy |
| PRC-08 | `service-list` | Windows services / systemd units |

**Network category:**
| Req | Tool ID | Description |
|-----|---------|-------------|
| NET-01 | `cports` | TCP/UDP connections with PID |
| NET-02 | `network-interfaces` | IP, MAC, speed, status |
| NET-03 | `dns-lookup` | DNS query/resolve |
| NET-04 | `wifi-scan` | Available Wi-Fi networks |
| NET-05 | `wifi-history` | Previously connected SSIDs |
| NET-06 | `ping-test` | Multi-host parallel ping |
| NET-07 | `port-scan` | TCP connect scan |
| NET-08 | `route-table` | Routing table |
| NET-09 | `arp-table` | ARP cache |
| NET-10 | `mac-resolve` | MAC → vendor lookup |
| NET-11 | `whois-lookup` | WHOIS via port 43 |
| NET-12 | `traceroute` | Traceroute with geo IP |
| NET-13 | `http-headers` | HTTP response headers |
| NET-14 | `network-stats` | Bytes in/out per interface |
| NET-15 | `wake-on-lan` | WOL magic packet sender |
| NET-16 | `bandwidth-test` | Download speed test |
| NET-17 | `connection-log` | Historical connection log |
| NET-18 | `ssl-checker` | SSL certificate details |
| NET-19 | `bluetooth-scan` | Bluetooth device scanner |
| NET-20 | `network-shares` | SMB/NFS share listing |

## Platform Dispatch per Tool

Tools where implementation differs by platform use an inline platform switch:

```typescript
async function runTcpConnections(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const raw = platform === 'win32' || platform === 'wsl'
    ? await getConnectionsWindows()
    : await getConnectionsLinux();
  return buildSuccess(raw, 'cports', platform);
}
```

## Row Schemas (TypeScript interfaces)

Each tool defines a typed row interface in the same file:

```typescript
interface ProcessRow {
  pid: number;
  name: string;
  cpu: number;      // percent 0-100
  memory: number;   // bytes
  user: string;
  commandLine: string;
}

interface ConnectionRow {
  pid: number;
  processName: string;
  protocol: 'TCP' | 'UDP';
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
}
```

## File Size Budget

Each category module should stay under 800 lines. For network (20 tools), consider splitting into sub-modules:
- `network/connections.ts` — NET-01 (cports)
- `network/interfaces.ts` — NET-02, NET-14 (interfaces + stats)
- `network/dns.ts` — NET-03, NET-11, NET-12 (DNS, WHOIS, traceroute)
- `network/wifi.ts` — NET-04, NET-05 (Wi-Fi scan + history)
- `network/scanner.ts` — NET-06, NET-07 (ping, port scan)
- `network/misc.ts` — NET-08..10, NET-13, NET-15..20

The `tools/network.ts` entry point re-exports the unified `run()`:
```typescript
// tools/network.ts — entry point only, delegates to sub-modules
import { run as connRun } from './network/connections.js';
// ...
```

## Validation Architecture

Testing node built-ins and child_process calls requires careful mock strategy:
- Mock `child_process.exec` return value to simulate command output
- Use fixture strings (copy from real system output)
- Mock `systeminformation` module methods
- Test per-platform parsing separately
