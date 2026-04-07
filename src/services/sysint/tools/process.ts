/**
 * SysInt process category tools — shim re-exporting from process/ subdirectory.
 * PRC-01: process-list     PRC-02: process-connections
 * PRC-03: process-modules  PRC-04: process-threads
 * PRC-05: process-handles  PRC-06: process-io
 * PRC-07: process-tree     PRC-08: service-list
 */

// Row interfaces — exported for consumers and sub-modules
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

// ── Exported parsers (for unit testing) ──────────────────────────────────────

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

// Re-export parseNetstatWindows from process/connections.ts for test compatibility
export { parseNetstatWindows } from './process/connections.js';

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

// Main dispatcher — delegates to process/index.ts
export { run } from './process/index.js';
