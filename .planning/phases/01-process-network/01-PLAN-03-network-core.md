---
plan: "03"
wave: 1
depends_on: ["01"]
files_modified:
  - src/services/sysint/tools/network/index.ts
  - src/services/sysint/tools/network/connections.ts
  - src/services/sysint/tools/network/interfaces.ts
  - src/services/sysint/tools/network/dns.ts
  - src/services/sysint/tools/network/wifi.ts
  - src/services/sysint/tools/network/scanner.ts
  - src/services/sysint/__tests__/network-connections.test.ts
  - src/services/sysint/__tests__/network-interfaces.test.ts
  - src/services/sysint/__tests__/network-dns.test.ts
  - src/services/sysint/__tests__/network-wifi.test.ts
  - src/services/sysint/__tests__/network-scanner.test.ts
autonomous: true
requirements:
  - NET-01
  - NET-02
  - NET-03
  - NET-04
  - NET-05
  - NET-06
  - NET-07
  - NET-14
---

# Plan 03: Network Core Tools (NET-01..07, NET-14)

**Goal:** Core network tools — connections with process correlation, interfaces, DNS, Wi-Fi scan/history, ping (parallel), port scanner (parallel), network stats.

**Wave 1** — runs in parallel with Plan 02.

---

## Context

- Network module split into sub-files under `src/services/sysint/tools/network/`
- `src/services/sysint/tools/network/index.ts` is the entry point (re-exports `run()`)
- Dispatcher loads `tools/network` → maps to `tools/network/index.ts`
- `systeminformation` available after Plan 01
- Fixtures from Plan 01 (`netstat-windows.txt`, `si-interfaces.json`, etc.)
- Wi-Fi in WSL: fall back to `powershell.exe netsh wlan ...` (note: `powershell.exe` not `powershell`)

---

## Tasks

<task id="1-03-01" title="Scaffold network module structure and index (RED)">

**What:** Create the network sub-module directory and index file. Create all 5 test files with failing stubs.

**File structure:**
```
src/services/sysint/tools/network/
├── index.ts        # entry — dispatches to sub-modules
├── connections.ts  # NET-01 (cports)
├── interfaces.ts   # NET-02, NET-14
├── dns.ts          # NET-03, NET-11, NET-12 (DNS, WHOIS, traceroute)
├── wifi.ts         # NET-04, NET-05
└── scanner.ts      # NET-06, NET-07 (ping, port-scan)
```

**index.ts:**
```typescript
import { run as connectionsRun } from './connections.js';
import { run as interfacesRun } from './interfaces.js';
import { run as dnsRun } from './dns.js';
import { run as wifiRun } from './wifi.js';
import { run as scannerRun } from './scanner.js';
import { run as miscRun } from './misc.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  'cports': (id, args) => connectionsRun(id, args),
  'network-interfaces': (id, args) => interfacesRun(id, args),
  'network-stats': (id, args) => interfacesRun(id, args),
  'dns-lookup': (id, args) => dnsRun(id, args),
  'whois-lookup': (id, args) => dnsRun(id, args),
  'traceroute': (id, args) => dnsRun(id, args),
  'wifi-scan': (id, args) => wifiRun(id, args),
  'wifi-history': (id, args) => wifiRun(id, args),
  'ping-test': (id, args) => scannerRun(id, args),
  'port-scan': (id, args) => scannerRun(id, args),
  // misc tools added in Plan 04
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) return buildError(`No native handler for network tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(toolId, args);
}
```

<automated>npx jest --testPathPattern="network" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-03-02" title="Implement NET-01: cports (TCP/UDP connections with process correlation)">

**What:** Implement `connections.ts` — TCP/UDP active connections with process name correlation.

**Key requirement:** Each row must include `pid` AND `processName` (Phase 1 success criterion #2).

**Windows/WSL implementation:**
```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import si from 'systeminformation';

const execAsync = promisify(exec);

async function getConnectionsWindows(): Promise<ConnectionRow[]> {
  // Run netstat and process list in parallel
  const [netstatResult, siData] = await Promise.all([
    execAsync('netstat -ano', { timeout: 30_000 }),
    si.processes().catch(() => ({ list: [] })),
  ]);

  const pidToName = new Map(siData.list.map((p) => [p.pid, p.name]));
  return parseNetstatWindows(netstatResult.stdout, pidToName);
}
```

**Linux implementation:**
Parse `/proc/net/tcp` and `/proc/net/tcp6` (hex-encoded addresses), correlate with `/proc/[pid]/net/tcp` or use `ss -tupn`.

Alternative (simpler): Use `ss -tupn` on Linux which includes process names directly:
```bash
ss -tupn | grep -v "^Netid"
```

**Row schema:**
```typescript
export interface ConnectionRow {
  pid: number;
  processName: string;
  protocol: 'TCP' | 'UDP';
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;    // '' for UDP
}
```

**Tests:**
- Windows: Mock exec with `netstat-windows.txt`, mock `si.processes()`, verify `processName` populated
- Linux: Mock exec with `ss -tupn` output fixture, verify row shape
- Empty: zero connections returns empty rows

<automated>npx jest --testPathPattern="network-connections" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-03-03" title="Implement NET-02 + NET-14: network-interfaces and network-stats">

**What:** Implement `interfaces.ts` — network interfaces and traffic statistics.

**NET-02 — network-interfaces:**
```typescript
import si from 'systeminformation';

async function runNetworkInterfaces(): Promise<SysIntResult> {
  const platform = getPlatformName();
  const ifaces = await si.networkInterfaces();
  const list = Array.isArray(ifaces) ? ifaces : [ifaces];
  const rows = list.map((i) => ({
    name: i.iface,
    ip4: i.ip4,
    ip6: i.ip6,
    mac: i.mac,
    speedMbps: i.speed,
    status: i.operstate,
    type: i.type,
  }));
  return buildSuccess(rows, 'network-interfaces', platform);
}
```

**NET-14 — network-stats:**
```typescript
async function runNetworkStats(args: string[]): Promise<SysIntResult> {
  const iface = args[0] ?? '*';
  const stats = await si.networkStats(iface);
  const rows = stats.map((s) => ({
    interface: s.iface,
    rxBytes: s.rx_bytes,
    txBytes: s.tx_bytes,
    rxDropped: s.rx_dropped,
    txDropped: s.tx_dropped,
  }));
  return buildSuccess(rows, 'network-stats', getPlatformName());
}
```

**Tests:** Mock `si.networkInterfaces()` and `si.networkStats()` with fixtures. Verify field mapping.

<automated>npx jest --testPathPattern="network-interfaces" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-03-04" title="Implement NET-03 + NET-11 + NET-12: dns-lookup, whois-lookup, traceroute">

**What:** Implement `dns.ts` — DNS resolution, WHOIS, and traceroute.

**NET-03 — dns-lookup:**
```typescript
import dns from 'node:dns/promises';

async function runDnsLookup(args: string[]): Promise<SysIntResult> {
  const host = args[0];
  if (!host) return buildError('hostname required', 'EXEC_FAILED', 'dns-lookup');

  const types: dns.RecordType[] = ['A', 'AAAA', 'MX', 'TXT', 'NS'];
  const results = await Promise.allSettled(
    types.map(async (type) => ({ type, records: await dns.resolve(host, type) }))
  );

  const rows = results
    .filter((r): r is PromiseFulfilledResult<{ type: string; records: unknown }> => r.status === 'fulfilled')
    .flatMap((r) => {
      const recs = Array.isArray(r.value.records) ? r.value.records : [r.value.records];
      return recs.map((rec) => ({ host, type: r.value.type, value: String(rec) }));
    });
  return buildSuccess(rows, 'dns-lookup', getPlatformName());
}
```

**NET-11 — whois-lookup:**
TCP socket to `whois.iana.org:43`. Send `{domain}\r\n`, read response, split into key-value rows.

**NET-12 — traceroute:**
```typescript
const cmd = platform === 'win32' || platform === 'wsl'
  ? `tracert -d -w 1000 ${host}`
  : `traceroute -n -w 1 ${host}`;
const { stdout } = await execAsync(cmd, { timeout: 60_000 });
```
Parse each hop line: hop number, RTT values, IP address. Return `HopRow[]`.

**Tests:** 
- DNS: Mock `dns.resolve` per type; test partial failure (some types not found)
- WHOIS: Mock socket with fixture response
- Traceroute: Mock exec with fixture output; verify hop parsing

<automated>npx jest --testPathPattern="network-dns" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-03-05" title="Implement NET-04 + NET-05: wifi-scan and wifi-history">

**What:** Implement `wifi.ts` — Wi-Fi network scanning and connection history.

**NET-04 — wifi-scan:**
```typescript
async function runWifiScan(): Promise<SysIntResult> {
  const platform = getPlatformName();
  const rows = platform === 'linux'
    ? await scanWifiLinux()
    : await scanWifiWindows();  // win32 and wsl both use netsh
  return buildSuccess(rows, 'wifi-scan', platform);
}

async function scanWifiWindows(): Promise<WifiNetworkRow[]> {
  // WSL: powershell.exe (not powershell — different binary in WSL)
  const cmd = process.platform === 'linux'
    ? 'powershell.exe -NoProfile -Command "netsh wlan show networks mode=bssid"'
    : 'netsh wlan show networks mode=bssid';
  const { stdout } = await execAsync(cmd, { timeout: 30_000 });
  return parseNetshNetworks(stdout);
}

async function scanWifiLinux(): Promise<WifiNetworkRow[]> {
  const { stdout } = await execAsync('nmcli dev wifi list', { timeout: 30_000 });
  return parseNmcliWifi(stdout);
}
```

**Row schema:**
```typescript
interface WifiNetworkRow {
  ssid: string;
  bssid: string;
  signalPercent: number;
  channel: number;
  security: string;
  inUse: boolean;
}
```

**NET-05 — wifi-history:**
Windows: `netsh wlan show profiles` → list profile names → per-profile `netsh wlan show profile name="{X}" key=clear` (omit key by default)
Linux: Read `/etc/NetworkManager/system-connections/*.nmconnection` files

**Tests:** Mock exec with `netsh-wifi-networks.txt` and `nmcli-wifi.txt` fixtures. Verify signal/channel parsing.

<automated>npx jest --testPathPattern="network-wifi" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-03-06" title="Implement NET-06 + NET-07: ping-test (parallel) and port-scan (parallel)">

**What:** Implement `scanner.ts` — parallel ping and TCP port scanner.

**NET-06 — ping-test (parallel multi-host):**
```typescript
import { spawn } from 'node:child_process';

async function runPingTest(args: string[]): Promise<SysIntResult> {
  const hosts = args.length ? args : ['127.0.0.1'];
  const platform = getPlatformName();
  const results = await Promise.all(hosts.map((h) => pingHost(h, platform)));
  return buildSuccess(results, 'ping-test', platform);
}

async function pingHost(host: string, platform: SysIntPlatform): Promise<PingRow> {
  const cmd = platform === 'win32' || platform === 'wsl' ? 'ping' : 'ping';
  const pingArgs = platform === 'win32' || platform === 'wsl'
    ? ['-n', '3', '-w', '1000', host]
    : ['-c', '3', '-W', '1', host];

  return new Promise((resolve) => {
    let output = '';
    const proc = spawn(cmd, pingArgs, { timeout: 10_000 });
    proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    proc.on('close', () => resolve(parsePingOutput(output, host, platform)));
    proc.on('error', () => resolve({ host, reachable: false, avgMs: null, packetLoss: 100 }));
  });
}
```

**NET-07 — port-scan (parallel with concurrency limit):**
```typescript
import net from 'node:net';

async function runPortScan(args: string[]): Promise<SysIntResult> {
  const host = args[0];
  if (!host) return buildError('host required', 'EXEC_FAILED', 'port-scan');
  
  const startPort = parseInt(args[1] ?? '1', 10);
  const endPort = parseInt(args[2] ?? '1024', 10);
  const ports = Array.from({ length: endPort - startPort + 1 }, (_, i) => startPort + i);
  
  const results = await scanPortsBatched(host, ports, 50); // concurrency=50
  return buildSuccess(results, 'port-scan', getPlatformName());
}

async function scanPortsBatched(host: string, ports: number[], concurrency: number): Promise<PortRow[]> {
  const results: PortRow[] = [];
  for (let i = 0; i < ports.length; i += concurrency) {
    const batch = ports.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((port) => probePort(host, port, 2000))
    );
    results.push(...batchResults.map((r, j) => ({
      port: batch[j],
      open: r.status === 'fulfilled' && r.value,
    })));
  }
  return results.filter((r) => r.open); // return open ports only
}
```

**Tests:**
- Ping: Mock spawn; test Windows + Linux parse; verify parallel result array
- Port scan: Mock `net.Socket`; test open/closed; verify batching (no more than 50 concurrent)

<automated>npx jest --testPathPattern="network-scanner" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

---

## Verification Criteria

- [ ] `npx jest --testPathPattern="network-(connections|interfaces|dns|wifi|scanner)" --no-coverage` — all GREEN
- [ ] `runTool('cports')` returns rows with `pid` and `processName` fields
- [ ] `runTool('wifi-scan')` returns rows with `ssid`, `signalPercent`, `channel`, `security`
- [ ] `runTool('dns-lookup', ['example.com'])` returns rows with `type` and `value`
- [ ] `runTool('ping-test', ['127.0.0.1', '8.8.8.8'])` returns 2 rows (parallel)
- [ ] `runTool('port-scan', ['127.0.0.1', '1', '100'])` completes without hanging
- [ ] `npx tsc --noEmit` clean

## Must-Haves

Phase 1 success criteria addressed here:
- Success criterion #2: cports rows include processName (PID correlated to process name)
- Success criterion #3: wifi-scan returns SSID, signal, channel, security
- Success criterion #4: dns-lookup returns structured JSON rows (not raw text)
- Success criterion #5: ping and port-scan run in parallel
