---
domain: Performance + Parallelization
phase: 1 — Process + Network
---

# Performance + Parallelization Research

## Tools That Must Be Parallel

| Tool | Parallelism | Pattern |
|------|-------------|---------|
| `port-scan` (NET-07) | Per-target socket connects | `Promise.allSettled` with concurrency limit |
| `ping-test` (NET-06) | Per-host ping spawn | `Promise.all` (child_process.spawn per host) |
| `dns-lookup` (NET-03) | Multi-record types | `Promise.all([dns.resolve(host,'A'), dns.resolve(host,'MX'), ...])` |
| `traceroute` (NET-12) | Single sequential | No parallelism — per-hop by nature |

## Port Scanner Pattern

```typescript
async function scanPorts(host: string, ports: number[], concurrency = 50): Promise<PortResult[]> {
  const results: PortResult[] = [];
  // Chunk into batches of `concurrency`
  for (let i = 0; i < ports.length; i += concurrency) {
    const batch = ports.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((port) => connectPort(host, port, 2000)), // 2s timeout
    );
    results.push(...batchResults.map((r, j) => ({
      port: batch[j],
      open: r.status === 'fulfilled' && r.value,
    })));
  }
  return results;
}

function connectPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
```

## Parallel Ping Pattern

```typescript
async function pingMultiple(hosts: string[]): Promise<PingResult[]> {
  return Promise.all(hosts.map((h) => pingOne(h)));
}

async function pingOne(host: string): Promise<PingResult> {
  const platform = getPlatformName();
  const cmd = platform === 'win32' || platform === 'wsl'
    ? `ping -n 3 -w 1000 ${host}`
    : `ping -c 3 -W 1 ${host}`;
  try {
    const { stdout } = await execAsync(cmd, { timeout: 10_000 });
    return parsePingOutput(stdout, host, platform);
  } catch {
    return { host, reachable: false, avgMs: null, packetLoss: 100 };
  }
}
```

## WSL Cross-Call Overhead

PowerShell invocations from WSL add ~200-500ms per call:
- Batch PowerShell calls wherever possible
- For Wi-Fi: single `netsh wlan show networks mode=bssid` (one call, parse all networks)
- Avoid per-process PowerShell calls (use single `Get-Process` call, parse all)

## Timeout Strategy

| Tool | Default Timeout | Rationale |
|------|----------------|-----------|
| `port-scan` per port | 2s | Fast fail; open ports respond < 100ms |
| `ping-test` | 10s | 3 pings × 1s timeout × buffer |
| `traceroute` | 60s | Up to 30 hops × 2s each |
| `whois-lookup` | 15s | WHOIS servers can be slow |
| `bandwidth-test` | 30s | Download test |
| `ssl-checker` | 10s | TLS handshake |
| All others | 30s (catalog default) | Standard |

## Memory Considerations

- `process-handles` (PRC-05): large systems can have thousands of FDs per process — stream results, don't accumulate
- `process-list` (PRC-01): `systeminformation` returns all processes — keep full array (MCP can filter)
- Port scan result buffering: batch results to prevent memory spikes on wide scans

## Lazy Loading Impact

Category modules load on first use. For Phase 1:
- `tools/process.ts`: imports `systeminformation` (~500KB unpacked) — ~50ms first-load
- `tools/network.ts`: imports only Node built-ins — ~5ms first-load

Dispatcher handles this transparently via existing `getCategoryModule()` cache.
