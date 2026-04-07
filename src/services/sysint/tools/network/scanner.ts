/**
 * Network scanner tools — NET-06 (ping-test), NET-07 (port-scan)
 * Both run targets in parallel for performance.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { buildSuccess, buildError } from '../../outputFormatter.js';
import { getPlatformName } from '../../platforms/index.js';
import type { SysIntResult, SysIntPlatform } from '../../outputFormatter.js';

export interface PingRow {
  host: string;
  reachable: boolean;
  avgMs: number | null;
  packetLoss: number;
}

export interface PortRow {
  port: number;
  open: boolean;
}

// ── Ping parsers (exported for unit testing) ──────────────────────────────────

export function parsePingWindows(output: string, host: string): PingRow {
  const lossMatch = output.match(/\((\d+)% loss\)/);
  const avgMatch = output.match(/Average = (\d+)ms/);
  const loss = lossMatch ? parseInt(lossMatch[1], 10) : 100;
  return {
    host,
    reachable: loss < 100,
    avgMs: avgMatch ? parseInt(avgMatch[1], 10) : null,
    packetLoss: loss,
  };
}

export function parsePingLinux(output: string, host: string): PingRow {
  const lossMatch = output.match(/(\d+)% packet loss/);
  const rttMatch = output.match(/rtt min\/avg\/max\/mdev = [\d.]+\/([\d.]+)/);
  const loss = lossMatch ? parseInt(lossMatch[1], 10) : 100;
  return {
    host,
    reachable: loss < 100,
    avgMs: rttMatch ? parseFloat(rttMatch[1]) : null,
    packetLoss: loss,
  };
}

// ── NET-06: ping-test (parallel multi-host) ────────────────────────────────────

async function pingHost(host: string, platform: SysIntPlatform): Promise<PingRow> {
  const isWin = platform === 'win32' || platform === 'wsl';
  const cmd = 'ping';
  const args = isWin ? ['-n', '3', '-w', '1000', host] : ['-c', '3', '-W', '1', host];

  return new Promise((resolve) => {
    let output = '';
    const proc = spawn(cmd, args);
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
    proc.on('close', () => {
      const result = isWin ? parsePingWindows(output, host) : parsePingLinux(output, host);
      resolve(result);
    });
    proc.on('error', () => resolve({ host, reachable: false, avgMs: null, packetLoss: 100 }));
    // Timeout guard
    setTimeout(() => {
      proc.kill();
      resolve({ host, reachable: false, avgMs: null, packetLoss: 100 });
    }, 10_000);
  });
}

async function runPingTest(args: string[]): Promise<SysIntResult> {
  const hosts = args.length > 0 ? args : ['127.0.0.1'];
  const platform = getPlatformName();
  const results = await Promise.all(hosts.map((h) => pingHost(h, platform)));
  return buildSuccess(results, 'ping-test', platform);
}

// ── NET-07: port-scan (parallel with concurrency limit) ────────────────────────

async function probePort(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const done = (open: boolean) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(open);
      }
    };
    socket.setTimeout(timeout);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, host);
  });
}

async function scanPortsBatched(host: string, ports: number[], concurrency: number): Promise<PortRow[]> {
  const openPorts: PortRow[] = [];
  for (let i = 0; i < ports.length; i += concurrency) {
    const batch = ports.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((port) => probePort(host, port, 2000))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled' && r.value) {
        openPorts.push({ port: batch[j], open: true });
      }
    }
  }
  return openPorts;
}

async function runPortScan(args: string[]): Promise<SysIntResult> {
  const host = args[0];
  if (!host) return buildError('host required', 'EXEC_FAILED', 'port-scan');
  const startPort = parseInt(args[1] ?? '1', 10);
  const endPort = parseInt(args[2] ?? '1024', 10);
  if (startPort < 1 || endPort > 65535 || startPort > endPort) {
    return buildError('invalid port range', 'EXEC_FAILED', 'port-scan');
  }
  const ports = Array.from({ length: endPort - startPort + 1 }, (_, i) => startPort + i);
  const results = await scanPortsBatched(host, ports, 50);
  return buildSuccess(results, 'port-scan', getPlatformName());
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  switch (toolId) {
    case 'ping-test': return runPingTest(args);
    case 'port-scan': return runPortScan(args);
    default: return buildError(`Unknown scanner tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
}
