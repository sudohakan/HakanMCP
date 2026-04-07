/**
 * DSK-04: file-search — Recursive file search with filters.
 * DSK-05: duplicate-finder — Hash-based duplicate detection.
 * DSK-06: large-files — Large file finder.
 * DSK-07: recent-files — Recently modified files.
 */
import { readdir, stat, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const readdirAsync = promisify(readdir);
const statAsync = promisify(stat);

const MAX_FILE_SCAN = 10_000;
const DEFAULT_MIN_DUPLICATE_BYTES = 1024;
const DEFAULT_LARGE_FILE_MIN_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_LARGE_FILE_LIMIT = 50;
const DEFAULT_RECENT_FILE_LIMIT = 50;

export interface FileRow {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  createdAt: string;
}

export interface DuplicateGroup {
  hash: string;
  count: number;
  sizeBytes: number;
  paths: string[];
}

// ── Recursive directory walker ──────────────────────────────────────────────

async function* walkDir(
  rootDir: string,
  maxDepth: number,
  currentDepth = 0,
): AsyncGenerator<{ filePath: string; name: string; sizeBytes: number; mtime: Date; birthtime: Date }> {
  if (currentDepth > maxDepth) return;
  let entries: string[];
  try {
    entries = await readdirAsync(rootDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(rootDir, entry);
    let st;
    try {
      st = await statAsync(fullPath);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkDir(fullPath, maxDepth, currentDepth + 1);
    } else if (st.isFile()) {
      yield {
        filePath: fullPath,
        name: entry,
        sizeBytes: st.size,
        mtime: st.mtime,
        birthtime: st.birthtime,
      };
    }
  }
}

// ── DSK-04: file-search ─────────────────────────────────────────────────────

async function runFileSearch(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [rootDir = '.', pattern, maxDepthStr, minSizeBytesStr, maxSizeBytesStr, modifiedAfterIso] = args;
  const maxDepth = parseInt(maxDepthStr ?? '10', 10);
  const minSize = minSizeBytesStr ? parseInt(minSizeBytesStr, 10) : undefined;
  const maxSize = maxSizeBytesStr ? parseInt(maxSizeBytesStr, 10) : undefined;
  const modifiedAfter = modifiedAfterIso ? new Date(modifiedAfterIso) : undefined;

  // Validate root dir exists
  try {
    await statAsync(rootDir);
  } catch {
    return buildError(`file-search: directory not found: ${rootDir}`, 'EXEC_FAILED', 'file-search');
  }

  const regex = pattern ? new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i') : null;
  const rows: FileRow[] = [];
  let scanned = 0;

  for await (const file of walkDir(rootDir, isNaN(maxDepth) ? 10 : maxDepth)) {
    if (scanned >= MAX_FILE_SCAN) break;
    scanned++;

    if (regex && !regex.test(file.name)) continue;
    if (minSize !== undefined && file.sizeBytes < minSize) continue;
    if (maxSize !== undefined && file.sizeBytes > maxSize) continue;
    if (modifiedAfter && file.mtime < modifiedAfter) continue;

    rows.push({
      path: file.filePath,
      name: file.name,
      sizeBytes: file.sizeBytes,
      modifiedAt: file.mtime.toISOString(),
      createdAt: file.birthtime.toISOString(),
    });
  }

  return buildSuccess(rows, 'file-search', platform);
}

// ── DSK-05: duplicate-finder ────────────────────────────────────────────────

async function hashFile(filePath: string, bytesToRead = 65536): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath, { end: bytesToRead - 1 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function computeFileHash(filePath: string, algorithm = 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function runDuplicateFinder(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [rootDir = '.', minSizeBytesStr] = args;
  const minSize = minSizeBytesStr ? parseInt(minSizeBytesStr, 10) : DEFAULT_MIN_DUPLICATE_BYTES;

  try {
    await statAsync(rootDir);
  } catch {
    return buildError(`duplicate-finder: directory not found: ${rootDir}`, 'EXEC_FAILED', 'duplicate-finder');
  }

  // Phase 1: group by size
  const bySize = new Map<number, string[]>();
  for await (const file of walkDir(rootDir, 20)) {
    if (file.sizeBytes < minSize) continue;
    const existing = bySize.get(file.sizeBytes) ?? [];
    existing.push(file.filePath);
    bySize.set(file.sizeBytes, existing);
  }

  // Phase 2: hash files with same size
  const byHash = new Map<string, { paths: string[]; sizeBytes: number }>();
  for (const [sizeBytes, paths] of bySize) {
    if (paths.length < 2) continue;
    for (const filePath of paths) {
      let hash: string;
      try {
        hash = await hashFile(filePath);
      } catch {
        continue;
      }
      const key = `${sizeBytes}:${hash}`;
      const existing = byHash.get(key) ?? { paths: [], sizeBytes };
      existing.paths.push(filePath);
      byHash.set(key, existing);
    }
  }

  const rows: DuplicateGroup[] = [];
  for (const [key, { paths, sizeBytes }] of byHash) {
    if (paths.length < 2) continue;
    const hash = key.split(':').slice(1).join(':');
    rows.push({ hash, count: paths.length, sizeBytes, paths });
  }

  return buildSuccess(rows, 'duplicate-finder', platform);
}

// ── DSK-06: large-files ─────────────────────────────────────────────────────

async function runLargeFiles(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [rootDir = '.', limitStr, minSizeBytesStr] = args;
  const limit = limitStr ? parseInt(limitStr, 10) : DEFAULT_LARGE_FILE_LIMIT;
  const minSize = minSizeBytesStr ? parseInt(minSizeBytesStr, 10) : DEFAULT_LARGE_FILE_MIN_BYTES;

  const files: Array<{ path: string; sizeBytes: number; modifiedAt: string }> = [];
  for await (const file of walkDir(rootDir, 20)) {
    if (file.sizeBytes >= minSize) {
      files.push({ path: file.filePath, sizeBytes: file.sizeBytes, modifiedAt: file.mtime.toISOString() });
    }
  }

  files.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return buildSuccess(files.slice(0, limit), 'large-files', platform);
}

// ── DSK-07: recent-files ────────────────────────────────────────────────────

async function runRecentFiles(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [rootDir = '.', limitStr, modifiedAfterIso] = args;
  const limit = limitStr ? parseInt(limitStr, 10) : DEFAULT_RECENT_FILE_LIMIT;
  const modifiedAfter = modifiedAfterIso ? new Date(modifiedAfterIso) : new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const files: Array<{ path: string; sizeBytes: number; modifiedAt: string }> = [];
  for await (const file of walkDir(rootDir, 20)) {
    if (file.mtime >= modifiedAfter) {
      files.push({ path: file.filePath, sizeBytes: file.sizeBytes, modifiedAt: file.mtime.toISOString() });
    }
  }

  files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  return buildSuccess(files.slice(0, limit), 'recent-files', platform);
}

// ── Run dispatcher ──────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'file-search': runFileSearch,
  'duplicate-finder': runDuplicateFinder,
  'large-files': runLargeFiles,
  'recent-files': runRecentFiles,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
