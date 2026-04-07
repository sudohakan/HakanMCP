/**
 * PRC-02: process-connections
 * Imports parseSsOutput from network/connections.ts to avoid duplication.
 */
import si from 'systeminformation';
import { buildSuccess, buildError, getPlatformName, execAsync } from './shared.js';
import type { SysIntResult } from './shared.js';
import { parseSsOutput } from '../network/connections.js';

interface ConnectionMappingRow {
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

export function parseNetstatWindows(output: string, pidToName: Map<number, string> = new Map()): ConnectionMappingRow[] {
  const rows: ConnectionMappingRow[] = [];
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

async function getConnectionsWindows(): Promise<ConnectionMappingRow[]> {
  const [netstatResult, siProcesses] = await Promise.all([
    execAsync('netstat -ano', { timeout: 30_000 }),
    si.processes().catch(() => ({ list: [] as Array<{ pid: number; name: string }> })),
  ]);
  const pidToName = new Map(siProcesses.list.map((p) => [p.pid, p.name]));
  return parseNetstatWindows(netstatResult.stdout, pidToName);
}

async function getConnectionsLinux(): Promise<ConnectionMappingRow[]> {
  const { stdout } = await execAsync('ss -tupn 2>/dev/null || netstat -tupn 2>/dev/null', { timeout: 30_000 });
  return parseSsOutput(stdout) as unknown as ConnectionMappingRow[];
}

export async function runProcessConnections(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const targetPid = args[0] ? parseInt(args[0], 10) : undefined;
  try {
    const connections = platform === 'win32' || platform === 'wsl'
      ? await getConnectionsWindows()
      : await getConnectionsLinux();
    const filtered = targetPid !== undefined
      ? connections.filter((c) => c.pid === targetPid)
      : connections;
    return buildSuccess(filtered, 'process-connections', platform);
  } catch (err) {
    return buildError(`process-connections failed: ${String(err)}`, 'EXEC_FAILED', 'process-connections');
  }
}
