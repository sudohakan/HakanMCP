---
plan: "04"
wave: 2
depends_on: ["03"]
files_modified:
  - src/services/sysint/tools/network/misc.ts
  - src/services/sysint/tools/network/index.ts
  - src/services/sysint/__tests__/network-misc.test.ts
autonomous: true
requirements:
  - NET-08
  - NET-09
  - NET-10
  - NET-11
  - NET-12
  - NET-13
  - NET-15
  - NET-16
  - NET-17
  - NET-18
  - NET-19
  - NET-20
---

# Plan 04: Network Extended Tools (NET-08..13, NET-15..20)

**Goal:** Remaining 12 network tools — routing, ARP, MAC resolver, HTTP headers, WOL, bandwidth test, connection log, SSL checker, Bluetooth scan, network shares.

**Wave 2** — runs after Plan 03 (inherits dns.ts for NET-11 + NET-12 which were already in Plan 03).

---

## Context

- `src/services/sysint/tools/network/misc.ts` is the new file for these 12 tools
- `index.ts` from Plan 03 already has the MODULE_MAP skeleton — update to add misc tool IDs
- NET-11 (whois) and NET-12 (traceroute) were implemented in Plan 03's `dns.ts` — not repeated here
- NET-13, NET-15..20: all implemented in `misc.ts`

---

## Tasks

<task id="1-04-01" title="Implement NET-08 + NET-09: route-table and arp-table">

**What:** Create `misc.ts` with route table and ARP table tools.

**NET-08 — route-table:**
```typescript
// Windows: route print, Linux: ip route
const cmd = platform === 'win32' || platform === 'wsl'
  ? 'route print'
  : 'ip route';
const { stdout } = await execAsync(cmd, { timeout: 15_000 });
```

Parse Windows `route print` IPv4 section — extract destination, netmask, gateway, interface, metric.
Parse Linux `ip route` — each line is a route; parse `default via X dev Y` pattern.

**Row schema:**
```typescript
interface RouteRow {
  destination: string;
  netmask: string;       // empty for Linux CIDR routes
  gateway: string;
  interface: string;
  metric: number;
}
```

**NET-09 — arp-table:**
`arp -a` works on both Windows and Linux with similar output format:
```
192.168.1.1  aa-bb-cc-dd-ee-ff  dynamic   (Windows)
192.168.1.1  aa:bb:cc:dd:ee:ff  ether     (Linux)
```

Normalize MAC separator to `:`.

**Row schema:**
```typescript
interface ArpRow {
  ip: string;
  mac: string;
  type: string;   // 'dynamic' | 'static' | 'ether' | etc.
}
```

**Tests:** Mock exec with `route-windows.txt`, `route-linux.txt`, `arp-windows.txt` fixtures. Test normalization.

<automated>npx jest --testPathPattern="network-misc" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-04-02" title="Implement NET-10 + NET-13 + NET-18: mac-resolve, http-headers, ssl-checker">

**What:** Three network utility tools.

**NET-10 — mac-resolve:**
OUI (Organizationally Unique Identifier) lookup. Embed a small inline OUI map for common vendors (top 50), fetch full OUI list from `https://www.macvendors.com/api/{mac}` as fallback.

Simpler approach: HTTP GET to `https://api.macvendors.com/{mac}` — returns vendor string directly. Cache results in memory.

```typescript
async function runMacResolve(args: string[]): Promise<SysIntResult> {
  const mac = args[0]?.toUpperCase().replace(/[-:]/g, '');
  if (!mac || mac.length < 6) return buildError('MAC address required', 'EXEC_FAILED', 'mac-resolve');
  const oui = mac.slice(0, 6);
  // Try inline OUI map first, then API fallback
  const vendor = OUI_MAP[oui] ?? await fetchVendorFromAPI(mac);
  return buildSuccess([{ mac: args[0], oui, vendor }], 'mac-resolve', getPlatformName());
}
```

**NET-13 — http-headers:**
```typescript
import https from 'node:https';
import http from 'node:http';

async function runHttpHeaders(args: string[]): Promise<SysIntResult> {
  const url = args[0];
  if (!url) return buildError('URL required', 'EXEC_FAILED', 'http-headers');
  const headers = await fetchHeaders(url);
  const rows = Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  return buildSuccess(rows, 'http-headers', getPlatformName());
}
```
Use `HEAD` request. Follow redirects. Return all response headers as rows.

**NET-18 — ssl-checker:**
```typescript
import tls from 'node:tls';

async function runSslChecker(args: string[]): Promise<SysIntResult> {
  const [host, portStr] = (args[0] ?? '').split(':');
  const port = parseInt(portStr ?? '443', 10);
  if (!host) return buildError('host required (format: example.com or example.com:443)', 'EXEC_FAILED', 'ssl-checker');

  const cert = await getCertificate(host, port);
  const rows = [{
    host,
    port,
    subject: cert.subject?.CN ?? '',
    issuer: cert.issuer?.O ?? '',
    validFrom: cert.valid_from,
    validTo: cert.valid_to,
    daysUntilExpiry: Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000),
    fingerprint: cert.fingerprint,
    sans: (cert.subjectaltname ?? '').split(', '),
  }];
  return buildSuccess(rows, 'ssl-checker', getPlatformName());
}
```

**Tests:** Mock `https.request` for http-headers; mock `tls.connect` for ssl-checker. Verify row shapes.

<automated>npx jest --testPathPattern="network-misc" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-04-03" title="Implement NET-15 + NET-16 + NET-17: wake-on-lan, bandwidth-test, connection-log">

**What:** Three utility tools.

**NET-15 — wake-on-lan:**
```typescript
import dgram from 'node:dgram';

async function runWakeOnLan(args: string[]): Promise<SysIntResult> {
  const mac = args[0];
  if (!mac) return buildError('MAC address required', 'EXEC_FAILED', 'wake-on-lan');
  const broadcastIp = args[1] ?? '255.255.255.255';

  // Build magic packet: 6x 0xFF + 16x MAC bytes
  const macBytes = mac.replace(/[:-]/g, '').match(/.{2}/g)!.map((h) => parseInt(h, 16));
  const packet = Buffer.alloc(102);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBytes.forEach((b, j) => { packet[6 + i * 6 + j] = b; });
  }

  await new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 9, broadcastIp, (err) => {
        socket.close();
        err ? reject(err) : resolve();
      });
    });
  });

  return buildSuccess([{ mac, broadcast: broadcastIp, sent: true }], 'wake-on-lan', getPlatformName());
}
```

**NET-16 — bandwidth-test:**
Time an HTTPS download of a known file (use a CDN test URL or a local reference).
```typescript
// Use a small but measurable test file
const TEST_URL = 'https://speed.cloudflare.com/__down?bytes=10000000'; // 10MB
```
Return: `{ bytes, durationMs, mbps }`.

**NET-17 — connection-log:**
This is Windows Event Log / connection tracking — low-value and hard to implement cleanly. 
Implementation: Return last N connections from `netstat -ano` with timestamps if available. On Linux, this is truly historical state (not available without packet capture). 
Pragmatic approach: Return current connections with note that historical requires elevated logging. Return `{ note: 'current-snapshot', connections: [...currentConnections] }`.

**Tests:** 
- WOL: Mock dgram socket; verify magic packet structure (102 bytes, starts with 6x 0xFF)
- Bandwidth: Mock https module; verify mbps calculation
- Connection log: Mock exec; verify row shape

<automated>npx jest --testPathPattern="network-misc" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-04-04" title="Implement NET-19 + NET-20: bluetooth-scan and network-shares">

**What:** Bluetooth device scanner and SMB/NFS share listing.

**NET-19 — bluetooth-scan:**
```typescript
async function runBluetoothScan(): Promise<SysIntResult> {
  const platform = getPlatformName();
  const rows = platform === 'linux'
    ? await scanBluetoothLinux()
    : await scanBluetoothWindows();  // win32 and wsl
  return buildSuccess(rows, 'bluetooth-scan', platform);
}

async function scanBluetoothWindows(): Promise<BluetoothRow[]> {
  const ps = 'Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Select-Object -Property FriendlyName,Status,InstanceId | ConvertTo-Json -Compress';
  const { stdout } = await execAsync(
    process.platform === 'linux'
      ? `powershell.exe -NoProfile -Command "${ps}"`
      : `powershell -NoProfile -Command "${ps}"`,
    { timeout: 30_000 }
  );
  const devices = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
  return (Array.isArray(devices) ? devices : [devices]).map((d) => ({
    name: d.FriendlyName,
    status: d.Status,
    id: d.InstanceId,
  }));
}

async function scanBluetoothLinux(): Promise<BluetoothRow[]> {
  const { stdout } = await execAsync('bluetoothctl devices 2>/dev/null || echo ""', { timeout: 15_000 });
  return stdout.replace(/\r\n/g, '\n').split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/Device ([0-9A-F:]+) (.+)/i);
      return match ? { name: match[2], id: match[1], status: 'paired' } : null;
    })
    .filter(Boolean) as BluetoothRow[];
}
```

**NET-20 — network-shares:**
```typescript
async function runNetworkShares(): Promise<SysIntResult> {
  const platform = getPlatformName();
  const cmd = platform === 'linux'
    ? 'showmount -e localhost 2>/dev/null || echo ""'
    : process.platform === 'linux'
      ? 'net.exe share'   // WSL: use net.exe
      : 'net share';
  try {
    const { stdout } = await execAsync(cmd, { timeout: 15_000 });
    const rows = platform === 'linux'
      ? parseShowmount(stdout)
      : parseNetShare(stdout);
    return buildSuccess(rows, 'network-shares', platform);
  } catch {
    // showmount may not be installed — return gracefully
    return buildSuccess([], 'network-shares', platform);
  }
}
```

**Update index.ts** to add all misc tool IDs to MODULE_MAP:
```typescript
'route-table': (id, args) => miscRun(id, args),
'arp-table': (id, args) => miscRun(id, args),
'mac-resolve': (id, args) => miscRun(id, args),
'http-headers': (id, args) => miscRun(id, args),
'ssl-checker': (id, args) => miscRun(id, args),
'wake-on-lan': (id, args) => miscRun(id, args),
'bandwidth-test': (id, args) => miscRun(id, args),
'connection-log': (id, args) => miscRun(id, args),
'bluetooth-scan': (id, args) => miscRun(id, args),
'network-shares': (id, args) => miscRun(id, args),
```

**Tests:** Mock PowerShell exec; mock bluetoothctl; verify row shapes.

<automated>npx jest --testPathPattern="network-misc" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

---

## Verification Criteria

- [ ] `src/services/sysint/tools/network/misc.ts` exists and exports `run()`
- [ ] `index.ts` MODULE_MAP covers all 20 network tool IDs
- [ ] `npx jest --testPathPattern="network-misc" --no-coverage` — all GREEN
- [ ] `runTool('arp-table')` returns rows with `ip` and `mac` fields
- [ ] `runTool('ssl-checker', ['github.com'])` returns rows with `daysUntilExpiry` field
- [ ] `runTool('wake-on-lan', ['00:11:22:33:44:55'])` returns `sent: true`
- [ ] `runTool('network-shares')` returns rows or empty array (not error) even if shares not configured
- [ ] `npx tsc --noEmit` clean

## Must-Haves

- ARP and route tables: structured rows, not raw text
- SSL checker: `daysUntilExpiry` field must be present and correct
- Bluetooth and network shares: graceful empty result when tool/hardware not available (not EXEC_FAILED)
