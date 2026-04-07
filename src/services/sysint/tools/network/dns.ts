/**
 * DNS, WHOIS, and traceroute tools — NET-03, NET-11, NET-12
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSuccess, buildError } from './shared.js';
import { getPlatformName } from './shared.js';
import type { SysIntResult } from './shared.js';

const execAsync = promisify(exec);

export interface DnsRow {
  host: string;
  type: string;
  value: string;
}

export interface HopRow {
  hop: number;
  ip: string;
  rttMs: number | null;
}

export interface WhoisRow {
  key: string;
  value: string;
}

// ── NET-03: dns-lookup ────────────────────────────────────────────────────────

async function runDnsLookup(args: string[]): Promise<SysIntResult> {
  const host = args[0];
  if (!host) return buildError('hostname required', 'EXEC_FAILED', 'dns-lookup');
  const platform = getPlatformName();

  const types = ['A', 'AAAA', 'MX', 'TXT', 'NS'] as const;
  const results = await Promise.allSettled(
    types.map(async (type) => ({ type, records: await dns.resolve(host, type) }))
  );

  const rows: DnsRow[] = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => {
      const fulfilled = r as PromiseFulfilledResult<{ type: string; records: unknown }>;
      const recs = Array.isArray(fulfilled.value.records) ? fulfilled.value.records : [fulfilled.value.records];
      return (recs as unknown[]).map((rec) => ({
        host,
        type: fulfilled.value.type,
        value: typeof rec === 'object' && rec !== null ? JSON.stringify(rec) : String(rec),
      }));
    });

  return buildSuccess(rows, 'dns-lookup', platform);
}

// ── NET-11: whois-lookup ──────────────────────────────────────────────────────

async function runWhoisLookup(args: string[]): Promise<SysIntResult> {
  const query = args[0];
  if (!query) return buildError('domain or IP required', 'EXEC_FAILED', 'whois-lookup');
  const platform = getPlatformName();

  try {
    const response = await whoisQuery(query);
    const rows: WhoisRow[] = response
      .split('\n')
      .map((line) => {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1 || line.startsWith('%') || line.startsWith('#')) return null;
        return { key: line.slice(0, colonIdx).trim(), value: line.slice(colonIdx + 1).trim() };
      })
      .filter((r): r is WhoisRow => r !== null && r.key.length > 0 && r.value.length > 0);

    return buildSuccess(rows, 'whois-lookup', platform);
  } catch (err) {
    return buildError(`whois-lookup failed: ${String(err)}`, 'EXEC_FAILED', 'whois-lookup');
  }
}

function whoisQuery(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const socket = net.createConnection(43, 'whois.iana.org');
    socket.setTimeout(15_000);
    socket.on('connect', () => { socket.write(`${query}\r\n`); });
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('WHOIS timeout')); });
  });
}

// ── NET-12: traceroute ────────────────────────────────────────────────────────

export function parseTracerouteWindows(output: string): HopRow[] {
  const rows: HopRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^\s*(\d+)\s+([\d<*]+\s+ms\s+[\d<*]+\s+ms\s+[\d<*]+\s+ms\s+)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\*)/);
    if (!match) continue;
    const hop = parseInt(match[1], 10);
    const ip = match[3] === '*' ? '' : (match[3] ?? '');
    const rttMatch = match[2]?.match(/(\d+)\s+ms/);
    rows.push({ hop, ip, rttMs: rttMatch ? parseInt(rttMatch[1], 10) : null });
  }
  return rows;
}

export function parseTracerouteLinux(output: string): HopRow[] {
  const rows: HopRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(?:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\*)\s+(?:([\d.]+)\s+ms)?)?/);
    if (!match || !match[1]) continue;
    const hop = parseInt(match[1], 10);
    const ip = match[2] === '*' ? '' : (match[2] ?? '');
    rows.push({ hop, ip, rttMs: match[3] ? parseFloat(match[3]) : null });
  }
  return rows;
}

async function runTraceroute(args: string[]): Promise<SysIntResult> {
  const host = args[0];
  if (!host) return buildError('host required', 'EXEC_FAILED', 'traceroute');
  const platform = getPlatformName();

  try {
    if (platform === 'win32' || platform === 'wsl') {
      const cmd = platform === 'wsl'
        ? `tracert.exe -d -w 1000 ${host}`
        : `tracert -d -w 1000 ${host}`;
      const { stdout } = await execAsync(cmd, { timeout: 60_000 });
      return buildSuccess(parseTracerouteWindows(stdout), 'traceroute', platform);
    } else {
      const { stdout } = await execAsync(`traceroute -n -w 1 ${host} 2>/dev/null`, { timeout: 60_000 });
      return buildSuccess(parseTracerouteLinux(stdout), 'traceroute', platform);
    }
  } catch (err) {
    return buildError(`traceroute failed: ${String(err)}`, 'EXEC_FAILED', 'traceroute');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  switch (toolId) {
    case 'dns-lookup': return runDnsLookup(args);
    case 'whois-lookup': return runWhoisLookup(args);
    case 'traceroute': return runTraceroute(args);
    default: return buildError(`Unknown DNS tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
}
