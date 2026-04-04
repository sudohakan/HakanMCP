import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getPlatform } from './platforms/index.js';
import { getDataDir } from './history.js';
import { assertNotProtected } from './cleaner.js';
import type { SnapshotMeta, CompareResult, ScanEntry } from '../../types/disk.js';
import { scan } from './scanner.js';

const VALID_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidSnapshotName(name: string): void {
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(`Invalid snapshot name: "${name}". Only alphanumeric, underscore, and hyphen allowed (max 64 chars).`);
  }
}

export async function archive(
  sourcePath: string,
  format: string = 'zip',
  destination?: string,
): Promise<{ archivePath: string; originalSize: number }> {
  assertNotProtected(sourcePath);
  const platform = getPlatform();
  const originalSize = await platform.getDirectorySize(sourcePath);
  const destDir = destination || path.dirname(sourcePath);
  const baseName = path.basename(sourcePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destPath = path.join(destDir, `${baseName}_${timestamp}`);
  const archivePath = await platform.compress(sourcePath, format, destPath);
  return { archivePath, originalSize };
}

export async function saveSnapshot(
  dirPath: string,
  name?: string,
): Promise<SnapshotMeta> {
  const dataDir = await getDataDir();
  const snapshotsDir = path.join(dataDir, 'snapshots');
  await fs.mkdir(snapshotsDir, { recursive: true });

  const scanResult = await scan(dirPath, 5, 0);
  const snapshotName = name || `snapshot_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  assertValidSnapshotName(snapshotName);
  const filePath = path.join(snapshotsDir, `${snapshotName}.json`);
  await fs.writeFile(filePath, JSON.stringify(scanResult, null, 2));

  return {
    name: snapshotName,
    path: filePath,
    createdAt: scanResult.scannedAt,
    fileCount: scanResult.fileCount,
    totalSize: scanResult.totalSize,
  };
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const dataDir = await getDataDir();
  const snapshotsDir = path.join(dataDir, 'snapshots');
  try {
    const files = await fs.readdir(snapshotsDir);
    const metas: SnapshotMeta[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(snapshotsDir, file), 'utf-8');
      const data = JSON.parse(content);
      metas.push({
        name: file.replace('.json', ''),
        path: path.join(snapshotsDir, file),
        createdAt: data.scannedAt,
        fileCount: data.fileCount,
        totalSize: data.totalSize,
      });
    }
    return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function compare(snapshotA: string, snapshotB: string): Promise<CompareResult> {
  const dataDir = await getDataDir();
  const snapshotsDir = path.join(dataDir, 'snapshots');
  const aPath = path.join(snapshotsDir, `${path.basename(snapshotA, '.json')}.json`);
  const bPath = path.join(snapshotsDir, `${path.basename(snapshotB, '.json')}.json`);

  let aData: { children?: ScanEntry[] };
  let bData: { children?: ScanEntry[] };
  try {
    aData = JSON.parse(await fs.readFile(aPath, 'utf-8'));
  } catch {
    throw new Error(`Snapshot not found or corrupt: ${snapshotA}`);
  }
  try {
    bData = JSON.parse(await fs.readFile(bPath, 'utf-8'));
  } catch {
    throw new Error(`Snapshot not found or corrupt: ${snapshotB}`);
  }

  const aMap = buildPathMap(aData.children || []);
  const bMap = buildPathMap(bData.children || []);

  const added: ScanEntry[] = [];
  const removed: ScanEntry[] = [];
  const modified: Array<{ path: string; oldSize: number; newSize: number; sizeDiff: number }> = [];

  for (const [p, entry] of bMap) {
    if (!aMap.has(p)) {
      added.push(entry);
    } else {
      const aEntry = aMap.get(p)!;
      if (aEntry.size !== entry.size) {
        modified.push({ path: p, oldSize: aEntry.size, newSize: entry.size, sizeDiff: entry.size - aEntry.size });
      }
    }
  }
  for (const [p, entry] of aMap) {
    if (!bMap.has(p)) removed.push(entry);
  }

  const addedSize = added.reduce((s, e) => s + e.size, 0);
  const removedSize = removed.reduce((s, e) => s + e.size, 0);

  return {
    added,
    removed,
    modified,
    summary: { addedSize, removedSize, netChange: addedSize - removedSize },
  };
}

function buildPathMap(entries: ScanEntry[]): Map<string, ScanEntry> {
  const map = new Map<string, ScanEntry>();
  function walk(items: ScanEntry[]): void {
    for (const item of items) {
      map.set(item.path, item);
      if (item.children) walk(item.children);
    }
  }
  walk(entries);
  return map;
}
