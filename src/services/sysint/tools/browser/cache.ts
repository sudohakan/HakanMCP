/**
 * BRW-07: browser-cache — Cache metadata viewer for Chrome, Edge, and Firefox.
 * Returns file metadata only — no content reading.
 */
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  findBrowserProfiles,
  parseBrowserArg,
  parseLimitArg,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';
import type { BrowserName } from './shared.js';

export interface CacheRow {
  browser: string;
  profile: string;
  url: string;
  content_type: string;
  size: number;
  last_accessed: string;
}

// ── Shared cache directory scanner ──────────────────────────────────────────

/**
 * Scan a cache directory and return file metadata rows.
 * URL and content_type are unknowable from binary cache files without parsing.
 */
async function scanCacheDirectory(
  browser: string,
  profile: string,
  cacheDir: string,
  limit: number,
): Promise<CacheRow[]> {
  if (!existsSync(cacheDir)) return [];

  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return [];
  }

  const rows: CacheRow[] = [];

  for (const entry of entries.slice(0, limit)) {
    const entryPath = join(cacheDir, entry);
    try {
      const s = await stat(entryPath);
      if (!s.isFile()) continue;
      rows.push({
        browser,
        profile,
        url: 'unknown',
        content_type: 'unknown',
        size: s.size,
        last_accessed: s.mtime.toISOString(),
      });
    } catch {
      // Skip unreadable entries
    }
  }

  return rows;
}

// ── Chrome / Edge ────────────────────────────────────────────────────────────

async function queryChromiumCache(browser: BrowserName, limit: number): Promise<CacheRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: CacheRow[] = [];

  for (const profile of profiles) {
    // Chrome/Edge cache locations (try multiple common paths)
    const cachePaths = [
      join(profile.path, 'Cache', 'Cache_Data'),
      join(profile.path, 'Cache'),
    ];

    for (const cachePath of cachePaths) {
      if (existsSync(cachePath)) {
        const rows = await scanCacheDirectory(browser, profile.name, cachePath, limit);
        allRows.push(...rows);
        break; // Use first found
      }
    }
  }

  return allRows.slice(0, limit);
}

// ── Firefox ──────────────────────────────────────────────────────────────────

async function queryFirefoxCache(limit: number): Promise<CacheRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: CacheRow[] = [];

  for (const profile of profiles) {
    // Firefox cache2 entries directory
    const cacheDir = join(profile.path, 'cache2', 'entries');
    if (!existsSync(cacheDir)) continue;

    const rows = await scanCacheDirectory('firefox', profile.name, cacheDir, limit);
    allRows.push(...rows);
  }

  return allRows.slice(0, limit);
}

// ── Run dispatcher ───────────────────────────────────────────────────────────

async function runBrowserCache(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);
  const limit = parseLimitArg(args, 200);

  try {
    const queries: Promise<CacheRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxCache(limit));
      } else {
        queries.push(queryChromiumCache(browser, limit));
      }
    }

    const results = await Promise.all(queries);
    const rows = results
      .flat()
      .sort((a, b) => b.last_accessed.localeCompare(a.last_accessed))
      .slice(0, limit);

    return buildSuccess(rows, 'browser-cache', platform);
  } catch (err) {
    return buildError(`browser-cache failed: ${String(err)}`, 'EXEC_FAILED', 'browser-cache');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-cache': runBrowserCache,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
