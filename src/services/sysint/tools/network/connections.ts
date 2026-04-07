/**
 * Network connections tool — NET-01 (cports)
 * TCP/UDP active connections with process name correlation.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import si from 'systeminformation';
import { buildSuccess, buildError } from './shared.js';
import { getPlatformName } from './shared.js';
import type { SysIntResult } from './shared.js';

const execAsync = promisify(exec);

export interface ConnectionRow {
  pid: number;
  processName: string;
  protocol: 'TCP' | 'UDP';
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
}

function splitAddrPort(addr: string): [string, string] {
  const lastColon = addr.lastIndexOf(':');
  if (lastColon === -1) return [addr, '0'];
  return [addr.slice(0, lastColon), addr.slice(lastColon + 1)];
}

export function parseNetstatWindowsConnections(output: string, pidToName: Map<number, string> = new Map()): ConnectionRow[] {
  const rows: ConnectionRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    const tcpMatch = trimmed.match(/^TCP\s+(\S+)\s+(\S+)\s+(\w+)\s+(\d+)/);
    const udpMatch = !tcpMatch && trimmed.match(/^UDP\s+(\S+)\s+\S+\s+(\d+)/);
    if (!tcpMatch && !udpMatch) continue;

    if (tcpMatch) {
      const [, local, remote, state, pidStr] = tcpMatch;
      const [localAddr, localPortStr] = splitAddrPort(local);
      const [remoteAddr, remotePortStr] = splitAddrPort(remote);
      const pid = parseInt(pidStr, 10);
      rows.push({
        pid,
        processName: pidToName.get(pid) ?? '',
        protocol: 'TCP',
        localAddress: localAddr,
        localPort: parseInt(localPortStr, 10) || 0,
        remoteAddress: remoteAddr === '*' ? '' : remoteAddr,
        remotePort: parseInt(remotePortStr, 10) || 0,
        state,
      });
    } else if (udpMatch) {
      const [, local, pidStr] = udpMatch;
      const [localAddr, localPortStr] = splitAddrPort(local);
      const pid = parseInt(pidStr, 10);
      rows.push({
        pid,
        processName: pidToName.get(pid) ?? '',
        protocol: 'UDP',
        localAddress: localAddr,
        localPort: parseInt(localPortStr, 10) || 0,
        remoteAddress: '',
        remotePort: 0,
        state: '',
      });
    }
  }
  return rows;
}

export function parseSsOutput(output: string): ConnectionRow[] {
  const rows: ConnectionRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^(tcp|udp)\s+\S+\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s*(.*)/i);
    if (!match) continue;
    const [, proto, local, remote, proc] = match;
    const [localAddr, localPortStr] = splitAddrPort(local);
    const [remoteAddr, remotePortStr] = splitAddrPort(remote);
    const pidMatch = proc.match(/pid=(\d+)/);
    const nameMatch = proc.match(/users:\(\("([^"]+)"/);
    rows.push({
      pid: pidMatch ? parseInt(pidMatch[1], 10) : 0,
      processName: nameMatch ? nameMatch[1] : '',
      protocol: proto.toUpperCase() as 'TCP' | 'UDP',
      localAddress: localAddr,
      localPort: parseInt(localPortStr, 10) || 0,
      remoteAddress: remoteAddr === '*' || remoteAddr === '0.0.0.0' ? '' : remoteAddr,
      remotePort: parseInt(remotePortStr, 10) || 0,
      state: '',
    });
  }
  return rows;
}

async function getConnectionsWindows(): Promise<ConnectionRow[]> {
  const [netstatResult, siProcesses] = await Promise.all([
    execAsync('netstat -ano', { timeout: 30_000 }),
    si.processes().catch(() => ({ list: [] as Array<{ pid: number; name: string }> })),
  ]);
  const pidToName = new Map(siProcesses.list.map((p) => [p.pid, p.name]));
  return parseNetstatWindowsConnections(netstatResult.stdout, pidToName);
}

async function getConnectionsLinux(): Promise<ConnectionRow[]> {
  const { stdout } = await execAsync('ss -tupn 2>/dev/null || netstat -tupn 2>/dev/null', { timeout: 30_000 });
  return parseSsOutput(stdout);
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId !== 'cports') {
    return buildError(`Unknown connections tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  const platform = getPlatformName();
  const targetPid = args[0] ? parseInt(args[0], 10) : undefined;
  try {
    const connections = platform === 'win32' || platform === 'wsl'
      ? await getConnectionsWindows()
      : await getConnectionsLinux();
    const filtered = targetPid !== undefined
      ? connections.filter((c) => c.pid === targetPid)
      : connections;
    return buildSuccess(filtered, 'cports', platform);
  } catch (err) {
    return buildError(`cports failed: ${String(err)}`, 'EXEC_FAILED', 'cports');
  }
}
