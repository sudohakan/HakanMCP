/**
 * DSK-12: disk-links — NTFS junction and symlink listing.
 */
import { readdir, lstat, readlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface LinkRow {
  path: string;
  type: 'symlink' | 'junction';
  target: string;
  exists: boolean;
}

async function* walkForLinks(
  rootDir: string,
  maxDepth: number,
  currentDepth = 0,
): AsyncGenerator<LinkRow> {
  if (currentDepth > maxDepth) return;
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(rootDir, entry);
    let st;
    try {
      st = await lstat(fullPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      let target = '';
      let exists = false;
      try {
        target = await readlink(fullPath);
        await stat(fullPath); // follows symlink — throws if broken
        exists = true;
      } catch {
        exists = false;
      }
      yield { path: fullPath, type: 'symlink', target, exists };
    } else if (st.isDirectory()) {
      yield* walkForLinks(fullPath, maxDepth, currentDepth + 1);
    }
  }
}

export async function run(_toolId: string, args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [rootDir = '.', maxDepthStr = '3'] = args;
  const maxDepth = parseInt(maxDepthStr, 10);

  try {
    const rows: LinkRow[] = [];
    for await (const link of walkForLinks(rootDir, isNaN(maxDepth) ? 3 : maxDepth)) {
      rows.push(link);
    }
    return buildSuccess(rows, 'disk-links', platform);
  } catch (err) {
    return buildError(`disk-links failed: ${String(err)}`, 'EXEC_FAILED', 'disk-links');
  }
}
