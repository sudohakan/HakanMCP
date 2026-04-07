/**
 * SysInt process category tools — Phase 1 native implementations.
 * PRC-01: process-list     PRC-02: process-connections
 * PRC-03: process-modules  PRC-04: process-threads
 * PRC-05: process-handles  PRC-06: process-io
 * PRC-07: process-tree     PRC-08: service-list
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import si from 'systeminformation';
import { buildSuccess, buildError } from '../outputFormatter.js';
import { getPlatformName } from '../platforms/index.js';
import type { SysIntResult, SysIntPlatform } from '../outputFormatter.js';

const execAsync = promisify(exec);

// ── Row interfaces ──────────────────────────────────────────────────────────

export interface ProcessRow {
  pid: number;
  parentPid: number;
  name: string;
  cpu: number;
  memoryBytes: number;
  user: string;
  commandLine: string;
  state: string;
}

export interface ConnectionMappingRow {
  pid: number;
  processName: string;
  protocol: 'TCP' | 'UDP';
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
}

export interface ModuleRow {
  name: string;
  path: string;
  version: string;
}

export interface ThreadRow {
  threadId: number;
  state: string;
}

export interface HandleRow {
  fd: number | string;
  path: string;
}

export interface IORow {
  pid: number;
  name: string;
  readBytes: number;
  writeBytes: number;
}

export interface ProcessTreeRow {
  pid: number;
  parentPid: number;
  name: string;
  children: number[];
}

export interface ServiceRow {
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'pending' | 'unknown';
  startType: 'auto' | 'manual' | 'disabled' | 'unknown';
}

// ── Tool handler map ────────────────────────────────────────────────────────

const TOOL_HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'process-list': runProcessList,
  'process-connections': runProcessConnections,
  'process-modules': runProcessModules,
  'process-threads': runProcessThreads,
  'process-handles': runProcessHandles,
  'process-io': runProcessIO,
  'process-tree': runProcessTree,
  'service-list': runServiceList,
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = TOOL_HANDLERS[toolId];
  if (!handler) return buildError(`No native handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}

// ── PRC-01: process-list ────────────────────────────────────────────────────

async function runProcessList(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const data = await si.processes();
    const rows: ProcessRow[] = data.list.map((p) => ({
      pid: p.pid,
      parentPid: p.parentPid ?? 0,
      name: p.name,
      cpu: Math.round((p.cpu ?? 0) * 10) / 10,
      memoryBytes: (p as unknown as Record<string, unknown>)['mem_rss'] as number ?? 0,
      user: p.user ?? '',
      commandLine: [p.command, p.params].filter(Boolean).join(' '),
      state: p.state ?? '',
    }));
    return buildSuccess(rows, 'process-list', platform);
  } catch (err) {
    return buildError(`process-list failed: ${String(err)}`, 'EXEC_FAILED', 'process-list');
  }
}

// ── PRC-07: process-tree ────────────────────────────────────────────────────

async function runProcessTree(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const data = await si.processes();
    const byPid = new Map(data.list.map((p) => [p.pid, { pid: p.pid, parentPid: p.parentPid ?? 0, name: p.name, children: [] as number[] }]));
    for (const p of data.list) {
      if (p.parentPid && byPid.has(p.parentPid)) {
        byPid.get(p.parentPid)!.children.push(p.pid);
      }
    }
    const rows: ProcessTreeRow[] = [...byPid.values()];
    return buildSuccess(rows, 'process-tree', platform);
  } catch (err) {
    return buildError(`process-tree failed: ${String(err)}`, 'EXEC_FAILED', 'process-tree');
  }
}

// ── PRC-02: process-connections ─────────────────────────────────────────────

export function parseNetstatWindows(output: string, pidToName: Map<number, string> = new Map()): ConnectionMappingRow[] {
  const rows: ConnectionMappingRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    // TCP: TCP  local  remote  STATE  PID
    // UDP: UDP  local  *:*             PID  (no state column)
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

function splitAddrPort(addr: string): [string, string] {
  const lastColon = addr.lastIndexOf(':');
  if (lastColon === -1) return [addr, '0'];
  return [addr.slice(0, lastColon), addr.slice(lastColon + 1)];
}

async function runProcessConnections(args: string[]): Promise<SysIntResult> {
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

async function getConnectionsWindows(): Promise<ConnectionMappingRow[]> {
  const [netstatResult, siProcesses] = await Promise.all([
    execAsync('netstat -ano', { timeout: 30_000 }),
    si.processes().catch(() => ({ list: [] as Array<{ pid: number; name: string }> })),
  ]);
  const pidToName = new Map(siProcesses.list.map((p) => [p.pid, p.name]));
  return parseNetstatWindows(netstatResult.stdout, pidToName);
}

async function getConnectionsLinux(): Promise<ConnectionMappingRow[]> {
  // Use ss -tupn which includes process names
  const { stdout } = await execAsync('ss -tupn 2>/dev/null || netstat -tupn 2>/dev/null', { timeout: 30_000 });
  return parseSsOutput(stdout);
}

function parseSsOutput(output: string): ConnectionMappingRow[] {
  const rows: ConnectionMappingRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    // ss format: Netid  State  Recv-Q Send-Q Local          Peer           Process
    const match = line.match(/^(tcp|udp)\s+\S+\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s*(.*)/i);
    if (!match) continue;
    const [, proto, local, remote, proc] = match;
    const [localAddr, localPortStr] = splitAddrPort(local);
    const [remoteAddr, remotePortStr] = splitAddrPort(remote);
    const pidMatch = proc.match(/pid=(\d+)/);
    const nameMatch = proc.match(/,(\w+),pid=/);
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

// ── PRC-03: process-modules ─────────────────────────────────────────────────

async function runProcessModules(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const pid = args[0];
  if (!pid) return buildError('PID required', 'EXEC_FAILED', 'process-modules');
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `Get-Process -Id ${pid} -ErrorAction Stop | Select-Object -ExpandProperty Modules | Select-Object -Property ModuleName,FileName,FileVersionInfo | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl' ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"` : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const mods = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(mods) ? mods : [mods];
      const rows: ModuleRow[] = list.map((m: Record<string, unknown>) => ({
        name: String(m['ModuleName'] ?? ''),
        path: String(m['FileName'] ?? ''),
        version: String((m['FileVersionInfo'] as Record<string, unknown>)?.['FileVersion'] ?? ''),
      }));
      return buildSuccess(rows, 'process-modules', platform);
    } else {
      // Linux: /proc/{pid}/maps
      const maps = await readFile(`/proc/${pid}/maps`, 'utf8').catch(() => '');
      const seen = new Set<string>();
      const rows: ModuleRow[] = [];
      for (const line of maps.split('\n')) {
        const parts = line.split(' ');
        const path = parts[parts.length - 1]?.trim();
        if (path && path.startsWith('/') && !seen.has(path)) {
          seen.add(path);
          rows.push({ name: path.split('/').pop() ?? path, path, version: '' });
        }
      }
      return buildSuccess(rows, 'process-modules', platform);
    }
  } catch (err) {
    return buildError(`process-modules failed: ${String(err)}`, 'EXEC_FAILED', 'process-modules');
  }
}

// ── PRC-04: process-threads ─────────────────────────────────────────────────

async function runProcessThreads(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const pid = args[0];
  if (!pid) return buildError('PID required', 'EXEC_FAILED', 'process-threads');
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `(Get-Process -Id ${pid} -ErrorAction Stop).Threads | Select-Object -Property Id,ThreadState | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl' ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"` : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const threads = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(threads) ? threads : [threads];
      const rows: ThreadRow[] = list.map((t: Record<string, unknown>) => ({
        threadId: Number(t['Id'] ?? 0),
        state: String(t['ThreadState'] ?? ''),
      }));
      return buildSuccess(rows, 'process-threads', platform);
    } else {
      // Linux: /proc/{pid}/task/
      const { stdout } = await execAsync(`ls /proc/${pid}/task/ 2>/dev/null`, { timeout: 10_000 });
      const rows: ThreadRow[] = stdout.trim().split('\n').filter(Boolean).map((tid) => ({
        threadId: parseInt(tid.trim(), 10),
        state: '',
      }));
      return buildSuccess(rows, 'process-threads', platform);
    }
  } catch (err) {
    return buildError(`process-threads failed: ${String(err)}`, 'EXEC_FAILED', 'process-threads');
  }
}

// ── PRC-05: process-handles ─────────────────────────────────────────────────

async function runProcessHandles(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const pid = args[0];
  if (!pid) return buildError('PID required', 'EXEC_FAILED', 'process-handles');
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `$p = Get-Process -Id ${pid} -ErrorAction Stop; @{HandleCount=$p.HandleCount} | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl' ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"` : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const data = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '{}');
      return buildSuccess([{ pid: parseInt(pid, 10), handleCount: data['HandleCount'] ?? 0 }], 'process-handles', platform);
    } else {
      // Linux: /proc/{pid}/fd/
      const { stdout } = await execAsync(`ls /proc/${pid}/fd/ 2>/dev/null`, { timeout: 10_000 });
      const fds = stdout.trim().split('\n').filter(Boolean);
      const rows: HandleRow[] = [];
      for (const fd of fds) {
        let target = '';
        try {
          const link = await execAsync(`readlink /proc/${pid}/fd/${fd} 2>/dev/null`).catch(() => ({ stdout: '' }));
          target = link.stdout.trim();
        } catch {
          // ignore unreadable fds
        }
        rows.push({ fd: parseInt(fd, 10), path: target });
      }
      return buildSuccess(rows, 'process-handles', platform);
    }
  } catch (err) {
    return buildError(`process-handles failed: ${String(err)}`, 'EXEC_FAILED', 'process-handles');
  }
}

// ── PRC-06: process-io ──────────────────────────────────────────────────────

async function runProcessIO(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const pid = args[0];
  if (!pid) return buildError('PID required', 'EXEC_FAILED', 'process-io');
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = `Get-Process -Id ${pid} -ErrorAction Stop | Select-Object -Property Id,Name,WorkingSet64,PagedMemorySize64 | ConvertTo-Json -Compress`;
      const cmd = platform === 'wsl' ? `powershell.exe -NoProfile -Command "${ps.replace(/"/g, '\\"')}"` : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const data = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '{}');
      const row: IORow = {
        pid: parseInt(pid, 10),
        name: String(data['Name'] ?? ''),
        readBytes: Number(data['WorkingSet64'] ?? 0),
        writeBytes: Number(data['PagedMemorySize64'] ?? 0),
      };
      return buildSuccess([row], 'process-io', platform);
    } else {
      // Linux: /proc/{pid}/io
      const content = await readFile(`/proc/${pid}/io`, 'utf8').catch(() => '');
      const getValue = (key: string): number => {
        const match = content.match(new RegExp(`${key}:\\s*(\\d+)`));
        return match ? parseInt(match[1], 10) : 0;
      };
      const row: IORow = {
        pid: parseInt(pid, 10),
        name: '',
        readBytes: getValue('read_bytes'),
        writeBytes: getValue('write_bytes'),
      };
      return buildSuccess([row], 'process-io', platform);
    }
  } catch (err) {
    return buildError(`process-io failed: ${String(err)}`, 'EXEC_FAILED', 'process-io');
  }
}

// ── PRC-08: service-list ────────────────────────────────────────────────────

// ── Exported parsers (for unit testing) ─────────────────────────────────────

export function parseWindowsServices(json: string): Array<{ name: string; displayName: string; status: string; startType: string }> {
  const services = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(services) ? services : [services];
  return list.map((s: Record<string, unknown>) => ({
    name: String(s['Name'] ?? ''),
    displayName: String(s['DisplayName'] ?? ''),
    status: mapWindowsStatus(Number(s['Status'] ?? 0)),
    startType: mapWindowsStartType(Number(s['StartType'] ?? 0)),
  }));
}

export function parseLinuxServices(json: string): Array<{ name: string; displayName: string; status: string; startType: string }> {
  const units = JSON.parse(json.trim() || '[]');
  const list = Array.isArray(units) ? units : [units];
  return list.map((u: Record<string, unknown>) => ({
    name: String(u['unit'] ?? '').replace('.service', ''),
    displayName: String(u['description'] ?? ''),
    status: String(u['sub'] ?? '') === 'running' ? 'running' : String(u['active'] ?? '') === 'inactive' ? 'stopped' : 'unknown',
    startType: 'unknown' as const,
  }));
}

function mapWindowsStatus(status: number): ServiceRow['status'] {
  switch (status) {
    case 4: return 'running';
    case 1: return 'stopped';
    case 2: case 3: return 'pending';
    default: return 'unknown';
  }
}

function mapWindowsStartType(startType: number): ServiceRow['startType'] {
  switch (startType) {
    case 2: return 'auto';
    case 3: return 'manual';
    case 4: return 'disabled';
    default: return 'unknown';
  }
}

async function runServiceList(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = 'Get-Service | Select-Object -Property Name,DisplayName,Status,StartType | ConvertTo-Json -Compress';
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const services = JSON.parse(stdout.replace(/\r\n/g, '\n').trim() || '[]');
      const list = Array.isArray(services) ? services : [services];
      const rows: ServiceRow[] = list.map((s: Record<string, unknown>) => ({
        name: String(s['Name'] ?? ''),
        displayName: String(s['DisplayName'] ?? ''),
        status: mapWindowsStatus(Number(s['Status'] ?? 0)),
        startType: mapWindowsStartType(Number(s['StartType'] ?? 0)),
      }));
      return buildSuccess(rows, 'service-list', platform);
    } else {
      // Linux: systemctl list-units --type=service --output=json
      const { stdout } = await execAsync('systemctl list-units --type=service --output=json --no-pager 2>/dev/null', { timeout: 30_000 });
      const units = JSON.parse(stdout.trim() || '[]');
      const list = Array.isArray(units) ? units : [units];
      const rows: ServiceRow[] = list.map((u: Record<string, unknown>) => ({
        name: String(u['unit'] ?? '').replace('.service', ''),
        displayName: String(u['description'] ?? ''),
        status: String(u['sub'] ?? '') === 'running' ? 'running' : String(u['active'] ?? '') === 'inactive' ? 'stopped' : 'unknown',
        startType: 'unknown',
      }));
      return buildSuccess(rows, 'service-list', platform);
    }
  } catch (err) {
    return buildError(`service-list failed: ${String(err)}`, 'EXEC_FAILED', 'service-list');
  }
}
