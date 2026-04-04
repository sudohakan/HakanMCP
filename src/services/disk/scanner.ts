import * as path from 'node:path';
import { getPlatform } from './platforms/index.js';
import type {
  ScanResult, ScanEntry, TopEntry, TypeDistribution,
  AgeBracket, DuplicateGroup, TreeNode,
} from '../../types/disk.js';

export async function scan(
  dirPath: string,
  depth: number = 3,
  minSize: number = 0,
): Promise<ScanResult> {
  const platform = getPlatform();
  const children = await platform.getDirectoryEntries(dirPath, depth, minSize);
  const fileCount = countFiles(children, 'file');
  const dirCount = countFiles(children, 'dir');
  const totalSize = children.reduce((s, c) => s + c.size, 0);
  return {
    path: dirPath,
    totalSize,
    fileCount,
    dirCount,
    depth,
    children: children.sort((a, b) => b.size - a.size),
    scannedAt: new Date().toISOString(),
  };
}

function countFiles(entries: ScanEntry[], type: 'file' | 'dir'): number {
  let count = 0;
  for (const e of entries) {
    if (e.type === type) count++;
    if (e.children) count += countFiles(e.children, type);
  }
  return count;
}

export async function drives() {
  const platform = getPlatform();
  return platform.getDrives();
}

export async function top(
  dirPath: string,
  count: number = 20,
  type: 'file' | 'dir' | 'all' = 'all',
): Promise<TopEntry[]> {
  const platform = getPlatform();
  const entries = await platform.getDirectoryEntries(dirPath, 10, 0);
  const flat = flattenEntries(entries);
  const filtered = type === 'all' ? flat : flat.filter((e) => e.type === type);
  return filtered
    .sort((a, b) => b.size - a.size)
    .slice(0, count)
    .map((e) => ({ path: e.path, size: e.size, type: e.type, modified: e.modified }));
}

function flattenEntries(entries: ScanEntry[]): ScanEntry[] {
  const result: ScanEntry[] = [];
  for (const e of entries) {
    result.push(e);
    if (e.children) result.push(...flattenEntries(e.children));
  }
  return result;
}

export async function types(dirPath: string, depth: number = 5): Promise<TypeDistribution[]> {
  const platform = getPlatform();
  const entries = await platform.getDirectoryEntries(dirPath, depth, 0);
  const flat = flattenEntries(entries).filter((e) => e.type === 'file');
  const extMap = new Map<string, { count: number; totalSize: number }>();
  let grandTotal = 0;
  for (const f of flat) {
    const ext = path.extname(f.name).toLowerCase() || '(no ext)';
    const curr = extMap.get(ext) || { count: 0, totalSize: 0 };
    curr.count++;
    curr.totalSize += f.size;
    extMap.set(ext, curr);
    grandTotal += f.size;
  }
  return Array.from(extMap.entries())
    .map(([extension, data]) => ({
      extension,
      count: data.count,
      totalSize: data.totalSize,
      percent: grandTotal > 0 ? (data.totalSize / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.totalSize - a.totalSize);
}

export async function age(
  dirPath: string,
  brackets: number[] = [30, 60, 90, 180, 365],
): Promise<AgeBracket[]> {
  const platform = getPlatform();
  const entries = await platform.getDirectoryEntries(dirPath, 10, 0);
  const flat = flattenEntries(entries).filter((e) => e.type === 'file');
  const now = Date.now();
  const result: AgeBracket[] = brackets.map((maxDays) => ({
    label: `>${maxDays}d`,
    maxDays,
    count: 0,
    totalSize: 0,
    percent: 0,
  }));
  let grandTotal = 0;
  for (const f of flat) {
    const ageDays = (now - new Date(f.modified).getTime()) / (1000 * 60 * 60 * 24);
    grandTotal += f.size;
    for (const bracket of result) {
      if (ageDays > bracket.maxDays) {
        bracket.count++;
        bracket.totalSize += f.size;
      }
    }
  }
  for (const b of result) {
    b.percent = grandTotal > 0 ? (b.totalSize / grandTotal) * 100 : 0;
  }
  return result;
}

export async function duplicates(
  dirPath: string,
  minSize: number = 1024 * 1024,
  algorithm: string = 'md5',
): Promise<DuplicateGroup[]> {
  const platform = getPlatform();
  const entries = await platform.getDirectoryEntries(dirPath, 10, minSize);
  const flat = flattenEntries(entries).filter((e) => e.type === 'file');

  const sizeMap = new Map<number, ScanEntry[]>();
  for (const f of flat) {
    const group = sizeMap.get(f.size) || [];
    group.push(f);
    sizeMap.set(f.size, group);
  }

  const groups: DuplicateGroup[] = [];
  for (const [, sameSize] of sizeMap) {
    if (sameSize.length < 2) continue;
    const hashMap = new Map<string, string[]>();
    for (const f of sameSize) {
      const hash = await platform.getFileHash(f.path, algorithm).catch(() => null);
      if (!hash) continue;
      const files = hashMap.get(hash) || [];
      files.push(f.path);
      hashMap.set(hash, files);
    }
    for (const [hash, files] of hashMap) {
      if (files.length < 2) continue;
      const size = sameSize[0].size;
      groups.push({ hash, size, files, wastedBytes: size * (files.length - 1) });
    }
  }
  return groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
}

export async function tree(
  dirPath: string,
  depth: number = 3,
  minSize: number = 1024 * 1024,
): Promise<TreeNode> {
  const platform = getPlatform();
  const entries = await platform.getDirectoryEntries(dirPath, depth, minSize);
  const totalSize = entries.reduce((s, c) => s + c.size, 0);
  return {
    name: path.basename(dirPath),
    path: dirPath,
    size: totalSize,
    type: 'dir',
    children: entries.sort((a, b) => b.size - a.size).map(entryToTreeNode),
  };
}

function entryToTreeNode(entry: ScanEntry): TreeNode {
  return {
    name: entry.name,
    path: entry.path,
    size: entry.size,
    type: entry.type,
    children: entry.children?.sort((a, b) => b.size - a.size).map(entryToTreeNode),
  };
}
