import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getPlatform } from './platforms/index.js';
import type { CleanupResult, CleanupTarget } from '../../types/disk.js';

const PROTECTED_PATHS_WIN = [
  'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData',
];
const PROTECTED_PATHS_LINUX = [
  '/bin', '/sbin', '/usr', '/etc', '/boot', '/proc', '/sys', '/dev',
];
const PROTECTED_SUBPATHS = ['.ssh', '.gnupg', '.credentials'];

function isProtected(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const isWin = process.platform === 'win32';
  const normalized = isWin ? resolved.toLowerCase() : resolved;
  const protectedPaths = isWin ? PROTECTED_PATHS_WIN : PROTECTED_PATHS_LINUX;
  for (const pp of protectedPaths) {
    const normalizedPp = isWin ? pp.toLowerCase() : pp;
    if (normalized === normalizedPp || normalized.startsWith(normalizedPp + path.sep)) return true;
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    for (const sub of PROTECTED_SUBPATHS) {
      const subPath = isWin ? path.join(home, sub).toLowerCase() : path.join(home, sub);
      if (normalized === subPath || normalized.startsWith(subPath + path.sep)) return true;
    }
  }
  return false;
}

function globMatch(name: string, pattern: string): boolean {
  if (!pattern.includes('*')) return name === pattern;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

export function assertNotProtected(targetPath: string): void {
  if (isProtected(targetPath)) {
    throw new Error(`Protected path: ${targetPath} — operation blocked`);
  }
}

const CLEANUP_TARGETS: Record<string, { patterns: string[]; description: string }> = {
  temp: {
    patterns: ['*.tmp', '*.temp', '~*', 'Thumbs.db', '.DS_Store', 'desktop.ini'],
    description: 'Temporary files',
  },
  cache: {
    patterns: ['__pycache__', '.cache', '.parcel-cache', '.next/cache', '.nuxt', '.turbo'],
    description: 'Application caches',
  },
  logs: {
    patterns: ['*.log', '*.log.*', 'npm-debug.log*', 'yarn-error.log*'],
    description: 'Log files',
  },
  empty_dirs: {
    patterns: [],
    description: 'Empty directories',
  },
  node_modules: {
    patterns: ['node_modules'],
    description: 'Node.js dependencies',
  },
  recycle_bin: {
    patterns: [],
    description: 'Recycle Bin contents',
  },
  thumbnails: {
    patterns: ['Thumbs.db', '.thumbnails', 'thumbcache_*.db'],
    description: 'Thumbnail caches',
  },
  crash_dumps: {
    patterns: ['*.dmp', '*.mdmp', 'CrashDump*'],
    description: 'Crash dump files',
  },
};

export function getAvailableTargets(): CleanupTarget[] {
  return Object.entries(CLEANUP_TARGETS).map(([type, { description }]) => ({
    type: type as CleanupTarget['type'],
    description,
  }));
}

export async function cleanup(
  dirPath: string,
  targets: string[],
  dryRun: boolean = true,
): Promise<CleanupResult[]> {
  assertNotProtected(dirPath);
  const platform = getPlatform();
  const results: CleanupResult[] = [];

  for (const target of targets) {
    if (target === 'recycle_bin') {
      const size = await platform.getRecycleBinSize();
      if (!dryRun) await platform.emptyRecycleBin();
      results.push({ target, filesDeleted: dryRun ? 0 : 1, bytesFreed: size, errors: [] });
      continue;
    }
    if (target === 'empty_dirs') {
      const result = await removeEmptyDirs(dirPath, dryRun);
      results.push(result);
      continue;
    }
    const config = CLEANUP_TARGETS[target];
    if (!config) {
      results.push({ target, filesDeleted: 0, bytesFreed: 0, errors: [`Unknown target: ${target}`] });
      continue;
    }
    const result = await cleanByPatterns(dirPath, target, config.patterns, dryRun, platform);
    results.push(result);
  }
  return results;
}

async function cleanByPatterns(
  dirPath: string,
  target: string,
  patterns: string[],
  dryRun: boolean,
  platform: ReturnType<typeof getPlatform>,
): Promise<CleanupResult> {
  let filesDeleted = 0;
  let bytesFreed = 0;
  const errors: string[] = [];

  async function walk(dir: string): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (isProtected(fullPath)) continue;
      const matches = patterns.some((p) => globMatch(item.name, p));
      if (matches) {
        try {
          const stat = await fs.lstat(fullPath);
          if (stat.isSymbolicLink()) continue;
          const size = item.isDirectory()
            ? await platform.getDirectorySize(fullPath)
            : stat.size;
          if (!dryRun) {
            if (item.isDirectory()) await platform.deleteDirRecursive(fullPath);
            else await platform.deleteFile(fullPath);
          }
          filesDeleted++;
          bytesFreed += size;
        } catch (e) {
          errors.push(`${fullPath}: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (item.isDirectory()) {
        await walk(fullPath);
      }
    }
  }
  await walk(dirPath);
  return { target, filesDeleted, bytesFreed, errors };
}

async function removeEmptyDirs(dirPath: string, dryRun: boolean): Promise<CleanupResult> {
  let dirsRemoved = 0;
  const errors: string[] = [];

  async function walk(dir: string): Promise<boolean> {
    if (isProtected(dir)) return false;
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    let isEmpty = true;
    for (const item of items) {
      if (item.isDirectory()) {
        const childEmpty = await walk(path.join(dir, item.name));
        if (!childEmpty) isEmpty = false;
      } else {
        isEmpty = false;
      }
    }
    if (isEmpty && dir !== dirPath) {
      try {
        if (!dryRun) await fs.rmdir(dir);
        dirsRemoved++;
      } catch (e) {
        errors.push(`${dir}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return isEmpty;
  }
  await walk(dirPath);
  return { target: 'empty_dirs', filesDeleted: dirsRemoved, bytesFreed: 0, errors };
}

export async function deleteItem(targetPath: string, confirm: boolean): Promise<{ success: boolean; message: string }> {
  assertNotProtected(targetPath);
  if (!confirm) {
    return { success: false, message: 'confirm: true required for delete operations' };
  }
  const platform = getPlatform();
  const stat = await fs.stat(targetPath);
  if (stat.isDirectory()) {
    await platform.deleteDirRecursive(targetPath);
  } else {
    await platform.deleteFile(targetPath);
  }
  return { success: true, message: `Deleted: ${targetPath}` };
}

export async function moveItem(
  source: string,
  destination: string,
): Promise<{ success: boolean; message: string }> {
  assertNotProtected(source);
  assertNotProtected(destination);
  try {
    await fs.access(destination);
    return { success: false, message: `Destination already exists: ${destination}` };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const platform = getPlatform();
  await platform.moveItem(source, destination);
  return { success: true, message: `Moved: ${source} → ${destination}` };
}
