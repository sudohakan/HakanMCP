/**
 * DSK-02: disk-partitions — Partition/volume listing.
 * DSK-03: disk-space — Drive space summary.
 * DSK-09: drive-map — Drive letter/mount point mapping.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import si from 'systeminformation';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export interface PartitionRow {
  device: string;
  name: string;
  fsType: string;
  mountPoint: string;
  sizeBytes: number;
  type: string;
}

export interface DiskSpaceRow {
  fs: string;
  type: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
  usePercent: number;
  mountPoint: string;
}

export interface DriveMapRow {
  drive: string;
  name: string;
  freeBytes: number;
  usedBytes: number;
  root: string;
}

// ── DSK-02: disk-partitions ─────────────────────────────────────────────────

async function runDiskPartitions(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const [layout, blockDevs] = await Promise.all([
      si.diskLayout().catch(() => []),
      si.blockDevices().catch(() => []),
    ]);

    const rows: PartitionRow[] = [
      ...layout.map((d) => ({
        device: d.device ?? '',
        name: d.name ?? '',
        fsType: d.type ?? '',
        mountPoint: '',
        sizeBytes: d.size ?? 0,
        type: 'disk',
      })),
      ...blockDevs.map((b) => ({
        device: b.name ?? '',
        name: b.label ?? b.name ?? '',
        fsType: b.fsType ?? '',
        mountPoint: b.mount ?? '',
        sizeBytes: b.size ?? 0,
        type: b.type ?? 'partition',
      })),
    ];

    return buildSuccess(rows, 'disk-partitions', platform);
  } catch (err) {
    return buildError(`disk-partitions failed: ${String(err)}`, 'EXEC_FAILED', 'disk-partitions');
  }
}

// ── DSK-03: disk-space ──────────────────────────────────────────────────────

async function runDiskSpace(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const data = await si.fsSize();
    const rows: DiskSpaceRow[] = data.map((fs) => ({
      fs: fs.fs ?? '',
      type: fs.type ?? '',
      sizeBytes: fs.size ?? 0,
      usedBytes: fs.used ?? 0,
      availableBytes: (fs.size ?? 0) - (fs.used ?? 0),
      usePercent: Math.round((fs.use ?? 0) * 10) / 10,
      mountPoint: fs.mount ?? '',
    }));
    return buildSuccess(rows, 'disk-space', platform);
  } catch (err) {
    return buildError(`disk-space failed: ${String(err)}`, 'EXEC_FAILED', 'disk-space');
  }
}

// ── DSK-09: drive-map ───────────────────────────────────────────────────────

export function parseDrivesWindows(json: string): DriveMapRow[] {
  const raw = JSON.parse(json.replace(/\r\n/g, '\n').trim() || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((d: Record<string, unknown>) => d['Name'])
    .map((d: Record<string, unknown>) => ({
      drive: String(d['Name'] ?? ''),
      name: String(d['Description'] ?? d['Name'] ?? ''),
      freeBytes: Number(d['Free'] ?? 0),
      usedBytes: Number(d['Used'] ?? 0),
      root: String(d['Root'] ?? d['Name'] ?? ''),
    }));
}

export function parseMountsLinux(content: string): DriveMapRow[] {
  const rows: DriveMapRow[] = [];
  const realFs = new Set(['ext4', 'ext3', 'ext2', 'xfs', 'btrfs', 'vfat', 'ntfs', 'f2fs', 'tmpfs', 'nfs']);
  for (const line of content.split('\n')) {
    const parts = line.trim().split(' ');
    if (parts.length < 4) continue;
    const [device, mountPoint, fsType] = parts;
    if (!realFs.has(fsType) && !device.startsWith('/dev/')) continue;
    rows.push({
      drive: device,
      name: mountPoint,
      freeBytes: 0,
      usedBytes: 0,
      root: mountPoint,
    });
  }
  return rows;
}

async function runDriveMap(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    if (platform === 'win32' || platform === 'wsl') {
      const ps = 'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Description,Root,Free,Used | ConvertTo-Json -Compress';
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "${ps}"`
        : `powershell -NoProfile -Command "${ps}"`;
      const { stdout } = await execAsync(cmd, { timeout: 30_000 });
      const rows = parseDrivesWindows(stdout);
      return buildSuccess(rows, 'drive-map', platform);
    } else {
      const content = await readFile('/proc/mounts', 'utf8').catch(() => '');
      const rows = parseMountsLinux(content);
      return buildSuccess(rows, 'drive-map', platform);
    }
  } catch (err) {
    return buildError(`drive-map failed: ${String(err)}`, 'EXEC_FAILED', 'drive-map');
  }
}

// ── Run dispatcher ──────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'disk-partitions': runDiskPartitions,
  'disk-space': runDiskSpace,
  'drive-map': runDriveMap,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
