/**
 * Extended network tools — NET-08..10, NET-13, NET-15..20
 * Plan 04: route-table, arp-table, mac-resolve, http-headers, ssl-checker,
 *          wake-on-lan, bandwidth-test, connection-log, bluetooth-scan, network-shares
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { buildSuccess, buildError } from './shared.js';
import { getPlatformName } from './shared.js';
import type { SysIntResult } from './shared.js';

const execAsync = promisify(exec);

// ── Exported parsers for unit testing ────────────────────────────────────────

export interface RouteRow {
  destination: string;
  netmask: string;
  gateway: string;
  iface: string;
  metric: number;
}

export interface ArpRow {
  ip: string;
  mac: string;
  type: string;
}

export function parseRouteWindows(output: string): RouteRow[] {
  const rows: RouteRow[] = [];
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    // e.g.:  "0.0.0.0          0.0.0.0         192.168.1.1      192.168.1.100      25"
    const match = line.match(/^\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/);
    if (match && !line.includes('Network Destination')) {
      rows.push({
        destination: match[1],
        netmask: match[2],
        gateway: match[3],
        iface: match[4],
        metric: parseInt(match[5], 10),
      });
    }
  }
  return rows;
}

export function parseRouteLinux(output: string): RouteRow[] {
  const rows: RouteRow[] = [];
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (line.startsWith('Iface') || !line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4) {
      rows.push({
        destination: parts[0],
        netmask: parts[7] ?? '',
        gateway: parts[2],
        iface: parts[0] !== '0.0.0.0' ? parts[0] : parts[7] ?? '',
        metric: parseInt(parts[6] ?? '0', 10),
      });
    }
  }
  return rows;
}

export function parseArpWindows(output: string): ArpRow[] {
  const rows: ArpRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]+)\s+(\w+)/i);
    if (match) {
      rows.push({ ip: match[1], mac: match[2].replace(/-/g, ':'), type: match[3] });
    }
  }
  return rows;
}

export function parseArpLinux(output: string): ArpRow[] {
  const rows: ArpRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^(\S+)\s+\S+\s+([0-9a-f:]+)\s+\S+\s+(\S+)/i);
    if (match && match[2] !== '00:00:00:00:00:00') {
      rows.push({ ip: match[1], mac: match[2], type: 'dynamic' });
    }
  }
  return rows;
}

// ── NET-08: route-table ───────────────────────────────────────────────────────

async function runRouteTable(): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const cmd = platform === 'wsl'
        ? 'powershell.exe -NoProfile -Command "route print"'
        : 'route print';
      const { stdout } = await execAsync(cmd, { timeout: 10_000 });
      return buildSuccess(parseRouteWindows(stdout), 'route-table', platform);
    } else {
      const { stdout } = await execAsync('cat /proc/net/route', { timeout: 10_000 });
      return buildSuccess(parseRouteLinux(stdout), 'route-table', platform);
    }
  } catch (err) {
    return buildError(`route-table failed: ${String(err)}`, 'EXEC_FAILED', 'route-table');
  }
}

// ── NET-09: arp-table ─────────────────────────────────────────────────────────

async function runArpTable(): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const cmd = platform === 'wsl'
        ? 'powershell.exe -NoProfile -Command "arp -a"'
        : 'arp -a';
      const { stdout } = await execAsync(cmd, { timeout: 10_000 });
      return buildSuccess(parseArpWindows(stdout), 'arp-table', platform);
    } else {
      const { stdout } = await execAsync('arp -n 2>/dev/null', { timeout: 10_000 });
      return buildSuccess(parseArpLinux(stdout), 'arp-table', platform);
    }
  } catch (err) {
    return buildError(`arp-table failed: ${String(err)}`, 'EXEC_FAILED', 'arp-table');
  }
}

// ── NET-10: mac-resolve ───────────────────────────────────────────────────────

async function runMacResolve(args: string[]): Promise<SysIntResult> {
  const ip = args[0];
  if (!ip) return buildError('IP address required', 'EXEC_FAILED', 'mac-resolve');
  const platform = getPlatformName();
  try {
    // Ping first to populate ARP cache, then query
    const pingCmd = platform === 'win32' || platform === 'wsl'
      ? `ping -n 1 -w 1000 ${ip}`
      : `ping -c 1 -W 1 ${ip}`;
    await execAsync(pingCmd, { timeout: 5_000 }).catch(() => { /* ignore, just populating ARP */ });

    const arpCmd = platform === 'win32' || platform === 'wsl'
      ? (platform === 'wsl' ? `powershell.exe -NoProfile -Command "arp -a ${ip}"` : `arp -a ${ip}`)
      : `arp -n ${ip} 2>/dev/null`;
    const { stdout } = await execAsync(arpCmd, { timeout: 5_000 });
    const rows = platform === 'linux' ? parseArpLinux(stdout) : parseArpWindows(stdout);
    const match = rows.find((r) => r.ip === ip);
    if (match) {
      return buildSuccess([match], 'mac-resolve', platform);
    }
    return buildError(`No ARP entry for ${ip}`, 'NOT_FOUND', 'mac-resolve');
  } catch (err) {
    return buildError(`mac-resolve failed: ${String(err)}`, 'EXEC_FAILED', 'mac-resolve');
  }
}

// ── NET-13: http-headers ──────────────────────────────────────────────────────

export interface HttpHeaderRow {
  name: string;
  value: string;
}

async function runHttpHeaders(args: string[]): Promise<SysIntResult> {
  const url = args[0];
  if (!url) return buildError('URL required', 'EXEC_FAILED', 'http-headers');
  const platform = getPlatformName();
  try {
    const headers = await fetchHeaders(url);
    return buildSuccess(headers, 'http-headers', platform);
  } catch (err) {
    return buildError(`http-headers failed: ${String(err)}`, 'EXEC_FAILED', 'http-headers');
  }
}

async function fetchHeaders(url: string): Promise<HttpHeaderRow[]> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10_000) });
  const rows: HttpHeaderRow[] = [];
  res.headers.forEach((value, name) => rows.push({ name, value }));
  rows.unshift({ name: ':status', value: String(res.status) });
  return rows;
}

// ── NET-15: ssl-checker ───────────────────────────────────────────────────────

export interface SslInfo {
  host: string;
  port: number;
  valid: boolean;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
}

async function runSslChecker(args: string[]): Promise<SysIntResult> {
  const target = args[0];
  if (!target) return buildError('host required', 'EXEC_FAILED', 'ssl-checker');
  const [host, portStr] = target.split(':');
  const port = portStr ? parseInt(portStr, 10) : 443;
  const platform = getPlatformName();

  return new Promise((resolve) => {
    // Use tls module via dynamic import to keep this file cleaner
    import('node:tls').then(({ connect }) => {
      const socket = connect({ host, port, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.subject) {
          socket.destroy();
          resolve(buildError('No certificate found', 'EXEC_FAILED', 'ssl-checker'));
          return;
        }
        const validFrom = new Date(cert.valid_from);
        const validTo = new Date(cert.valid_to);
        const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
        const info: SslInfo = {
          host,
          port,
          valid: daysRemaining > 0,
          subject: typeof cert.subject === 'object' ? JSON.stringify(cert.subject) : String(cert.subject),
          issuer: typeof cert.issuer === 'object' ? JSON.stringify(cert.issuer) : String(cert.issuer),
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          daysRemaining,
        };
        socket.destroy();
        resolve(buildSuccess([info], 'ssl-checker', platform));
      });
      socket.on('error', (err) => {
        resolve(buildError(`ssl-checker failed: ${String(err)}`, 'EXEC_FAILED', 'ssl-checker'));
      });
      setTimeout(() => {
        socket.destroy();
        resolve(buildError('ssl-checker timeout', 'EXEC_FAILED', 'ssl-checker'));
      }, 10_000);
    }).catch((err) => {
      resolve(buildError(`ssl-checker failed: ${String(err)}`, 'EXEC_FAILED', 'ssl-checker'));
    });
  });
}

// ── NET-16: wake-on-lan ───────────────────────────────────────────────────────

function buildMagicPacket(mac: string): Buffer {
  const macBytes = mac.replace(/[:\-]/g, '').match(/.{2}/g);
  if (!macBytes || macBytes.length !== 6) throw new Error(`Invalid MAC: ${mac}`);
  const macBuffer = Buffer.from(macBytes.map((b) => parseInt(b, 16)));
  const packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBuffer.copy(packet, 6 + i * 6);
  }
  return packet;
}

async function runWakeOnLan(args: string[]): Promise<SysIntResult> {
  const mac = args[0];
  if (!mac) return buildError('MAC address required', 'EXEC_FAILED', 'wake-on-lan');
  const platform = getPlatformName();
  try {
    const packet = buildMagicPacket(mac);
    const dgram = await import('node:dgram');
    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(packet, 0, packet.length, 9, '255.255.255.255', (err: Error | null) => {
          socket.close();
          if (err) reject(err);
          else resolve();
        });
      });
    });
    return buildSuccess([{ mac, sent: true }], 'wake-on-lan', platform);
  } catch (err) {
    return buildError(`wake-on-lan failed: ${String(err)}`, 'EXEC_FAILED', 'wake-on-lan');
  }
}

// ── NET-17: bandwidth-test ────────────────────────────────────────────────────

async function runBandwidthTest(args: string[]): Promise<SysIntResult> {
  const url = args[0] ?? 'https://speed.cloudflare.com/__down?bytes=10000000';
  const platform = getPlatformName();
  try {
    const start = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const buf = await res.arrayBuffer();
    const elapsed = (Date.now() - start) / 1000;
    const bytes = buf.byteLength;
    const mbps = (bytes * 8) / elapsed / 1_000_000;
    return buildSuccess([{ url, bytes, elapsedSec: elapsed, mbps: Math.round(mbps * 100) / 100 }], 'bandwidth-test', platform);
  } catch (err) {
    return buildError(`bandwidth-test failed: ${String(err)}`, 'EXEC_FAILED', 'bandwidth-test');
  }
}

// ── NET-18: connection-log ────────────────────────────────────────────────────

async function runConnectionLog(): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      // Event log query for network connections (limited)
      const cmd = platform === 'wsl'
        ? 'powershell.exe -NoProfile -Command "Get-WinEvent -LogName Security -MaxEvents 20 -FilterHashtable @{Id=5156} -ErrorAction SilentlyContinue | Select-Object -Property TimeCreated,Message | ConvertTo-Json -Compress"'
        : 'powershell -NoProfile -Command "Get-WinEvent -LogName Security -MaxEvents 20 -FilterHashtable @{Id=5156} -ErrorAction SilentlyContinue | Select-Object -Property TimeCreated,Message | ConvertTo-Json -Compress"';
      const { stdout } = await execAsync(cmd, { timeout: 15_000 }).catch(() => ({ stdout: '[]' }));
      let events: unknown[] = [];
      try { events = JSON.parse(stdout || '[]'); } catch { events = []; }
      if (!Array.isArray(events)) events = [events];
      return buildSuccess(events, 'connection-log', platform);
    } else {
      // Linux: read recent syslog entries for network events
      const { stdout } = await execAsync('journalctl -u NetworkManager --since "1 hour ago" --no-pager -o json 2>/dev/null | head -50', { timeout: 10_000 }).catch(() => ({ stdout: '' }));
      const lines = stdout.trim().split('\n').filter(Boolean);
      const events = lines.map((l) => { try { return JSON.parse(l); } catch { return { message: l }; } });
      return buildSuccess(events, 'connection-log', platform);
    }
  } catch (err) {
    return buildError(`connection-log failed: ${String(err)}`, 'EXEC_FAILED', 'connection-log');
  }
}

// ── NET-19: bluetooth-scan ────────────────────────────────────────────────────

export interface BluetoothRow {
  name: string;
  address: string;
  paired: boolean;
  connected: boolean;
}

async function runBluetoothScan(): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const cmd = 'powershell.exe -NoProfile -Command "Get-PnpDevice -Class Bluetooth | Select-Object Name,InstanceId,Status | ConvertTo-Json -Compress"';
      const { stdout } = await execAsync(cmd, { timeout: 15_000 });
      let devices: unknown[] = [];
      try { devices = JSON.parse(stdout); } catch { devices = []; }
      if (!Array.isArray(devices)) devices = [devices];
      const rows: BluetoothRow[] = (devices as Record<string, unknown>[]).map((d) => ({
        name: String(d['Name'] ?? ''),
        address: String(d['InstanceId'] ?? ''),
        paired: true,
        connected: String(d['Status']) === 'OK',
      }));
      return buildSuccess(rows, 'bluetooth-scan', platform);
    } else {
      const { stdout } = await execAsync('bluetoothctl devices 2>/dev/null', { timeout: 10_000 }).catch(() => ({ stdout: '' }));
      const rows: BluetoothRow[] = stdout.trim().split('\n')
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/Device\s+([0-9A-F:]+)\s+(.*)/i);
          return match ? { name: match[2].trim(), address: match[1], paired: true, connected: false } : null;
        })
        .filter((r): r is BluetoothRow => r !== null);
      return buildSuccess(rows, 'bluetooth-scan', platform);
    }
  } catch (err) {
    return buildError(`bluetooth-scan failed: ${String(err)}`, 'EXEC_FAILED', 'bluetooth-scan');
  }
}

// ── NET-20: network-shares ────────────────────────────────────────────────────

export interface ShareRow {
  name: string;
  path: string;
  type: string;
  comment: string;
}

async function runNetworkShares(): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const cmd = platform === 'wsl'
        ? 'powershell.exe -NoProfile -Command "Get-SmbShare | Select-Object Name,Path,ShareType,Description | ConvertTo-Json -Compress"'
        : 'powershell -NoProfile -Command "Get-SmbShare | Select-Object Name,Path,ShareType,Description | ConvertTo-Json -Compress"';
      const { stdout } = await execAsync(cmd, { timeout: 15_000 });
      let shares: unknown[] = [];
      try { shares = JSON.parse(stdout); } catch { shares = []; }
      if (!Array.isArray(shares)) shares = [shares];
      const rows: ShareRow[] = (shares as Record<string, unknown>[]).map((s) => ({
        name: String(s['Name'] ?? ''),
        path: String(s['Path'] ?? ''),
        type: String(s['ShareType'] ?? ''),
        comment: String(s['Description'] ?? ''),
      }));
      return buildSuccess(rows, 'network-shares', platform);
    } else {
      const { stdout } = await execAsync('net share 2>/dev/null || smbclient -L localhost -N 2>/dev/null', { timeout: 10_000 }).catch(() => ({ stdout: '' }));
      const rows: ShareRow[] = [];
      for (const line of stdout.split('\n')) {
        const match = line.match(/^(\S+)\s{2,}(.+?)\s{2,}(.+)?$/);
        if (match && !line.startsWith('Share name') && !line.startsWith('---')) {
          rows.push({ name: match[1], path: match[2].trim(), type: 'SMB', comment: match[3]?.trim() ?? '' });
        }
      }
      return buildSuccess(rows, 'network-shares', platform);
    }
  } catch (err) {
    return buildError(`network-shares failed: ${String(err)}`, 'EXEC_FAILED', 'network-shares');
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  switch (toolId) {
    case 'route-table': return runRouteTable();
    case 'arp-table': return runArpTable();
    case 'mac-resolve': return runMacResolve(args);
    case 'http-headers': return runHttpHeaders(args);
    case 'ssl-checker': return runSslChecker(args);
    case 'wake-on-lan': return runWakeOnLan(args);
    case 'bandwidth-test': return runBandwidthTest(args);
    case 'connection-log': return runConnectionLog();
    case 'bluetooth-scan': return runBluetoothScan();
    case 'network-shares': return runNetworkShares();
    default: return buildError(`Unknown misc network tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
}
