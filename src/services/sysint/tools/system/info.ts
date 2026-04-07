/**
 * SYS-01: cpu-info     — CPU model, cores, frequency, load.
 * SYS-02: memory-info  — Memory total, used, available, swap.
 * SYS-03: os-info      — OS version, build, architecture, uptime.
 * SYS-22: timezone-info — Timezone and locale.
 */
import si from 'systeminformation';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

// ── Row types ───────────────────────────────────────────────────────────────

export interface CpuInfoRow {
  manufacturer: string;
  brand: string;
  cores: number;
  physicalCores: number;
  processors: number;
  speed: number;
  speedMax: number;
  governor: string;
  temperature: number;
}

export interface MemInfoRow {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
  swapUsedBytes: number;
}

export interface OsInfoRow {
  platform: string;
  distro: string;
  release: string;
  codename: string;
  kernel: string;
  arch: string;
  hostname: string;
  uptime: number;
  bootTime: string;
}

export interface TimezoneRow {
  timezone: string;
  locale: string;
  utcOffset: string;
  currentTime: string;
}

// ── Exported parsers for testing ────────────────────────────────────────────

export function parseCpuInfo(siData: Record<string, unknown>, temp: number): CpuInfoRow {
  return {
    manufacturer: String(siData['manufacturer'] ?? ''),
    brand: String(siData['brand'] ?? ''),
    cores: Number(siData['cores'] ?? 0),
    physicalCores: Number(siData['physicalCores'] ?? 0),
    processors: Number(siData['processors'] ?? 1),
    speed: Number(siData['speed'] ?? 0),
    speedMax: Number(siData['speedmax'] ?? siData['speedMax'] ?? 0),
    governor: String(siData['governor'] ?? ''),
    temperature: temp,
  };
}

export function parseMemInfo(siData: Record<string, unknown>): MemInfoRow {
  return {
    totalBytes: Number(siData['total'] ?? 0),
    freeBytes: Number(siData['free'] ?? 0),
    usedBytes: Number(siData['used'] ?? 0),
    swapTotalBytes: Number(siData['swaptotal'] ?? 0),
    swapFreeBytes: Number(siData['swapfree'] ?? 0),
    swapUsedBytes: Number(siData['swapused'] ?? 0),
  };
}

export function parseOsInfo(siOs: Record<string, unknown>, siTime: Record<string, unknown>): OsInfoRow {
  const uptime = Number(siOs['uptime'] ?? siTime['uptime'] ?? 0);
  const bootMs = Date.now() - uptime * 1000;
  return {
    platform: String(siOs['platform'] ?? ''),
    distro: String(siOs['distro'] ?? ''),
    release: String(siOs['release'] ?? ''),
    codename: String(siOs['codename'] ?? ''),
    kernel: String(siOs['kernel'] ?? ''),
    arch: String(siOs['arch'] ?? ''),
    hostname: String(siOs['hostname'] ?? ''),
    uptime,
    bootTime: new Date(bootMs).toISOString(),
  };
}

// ── Tool runners ─────────────────────────────────────────────────────────────

async function runCpuInfo(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const [cpuData, tempData] = await Promise.all([
      si.cpu(),
      si.cpuTemperature().catch(() => ({ main: 0 })),
    ]);
    const row = parseCpuInfo(cpuData as unknown as Record<string, unknown>, tempData.main ?? 0);
    return buildSuccess([row], 'cpu-info', platform);
  } catch (err) {
    return buildError(`cpu-info failed: ${String(err)}`, 'EXEC_FAILED', 'cpu-info');
  }
}

async function runMemoryInfo(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const memData = await si.mem();
    const row = parseMemInfo(memData as unknown as Record<string, unknown>);
    return buildSuccess([row], 'memory-info', platform);
  } catch (err) {
    return buildError(`memory-info failed: ${String(err)}`, 'EXEC_FAILED', 'memory-info');
  }
}

async function runOsInfo(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const osData = await si.osInfo();
    const timeData = si.time();
    const row = parseOsInfo(
      osData as unknown as Record<string, unknown>,
      timeData as unknown as Record<string, unknown>,
    );
    return buildSuccess([row], 'os-info', platform);
  } catch (err) {
    return buildError(`os-info failed: ${String(err)}`, 'EXEC_FAILED', 'os-info');
  }
}

async function runTimezoneInfo(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    const timeData = si.time();
    const now = new Date();
    const offsetMin = -now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMin) / 60).toString().padStart(2, '0');
    const offsetMins = (Math.abs(offsetMin) % 60).toString().padStart(2, '0');
    const sign = offsetMin >= 0 ? '+' : '-';
    const row: TimezoneRow = {
      timezone: resolved.timeZone ?? String(timeData.timezone ?? ''),
      locale: resolved.locale ?? '',
      utcOffset: `UTC${sign}${offsetHours}:${offsetMins}`,
      currentTime: now.toISOString(),
    };
    return buildSuccess([row], 'timezone-info', platform);
  } catch (err) {
    return buildError(`timezone-info failed: ${String(err)}`, 'EXEC_FAILED', 'timezone-info');
  }
}

// ── Run dispatcher ──────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'cpu-info': runCpuInfo,
  'memory-info': runMemoryInfo,
  'os-info': runOsInfo,
  'timezone-info': runTimezoneInfo,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
