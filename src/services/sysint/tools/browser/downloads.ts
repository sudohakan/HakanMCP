/**
 * BRW-04: browser-downloads — Download history from Chrome, Edge, and Firefox.
 */
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  findBrowserProfiles,
  copyDbToTemp,
  webkitToIso,
  firefoxMicrosToIso,
  parseBrowserArg,
  parseLimitArg,
  chromiumDbPath,
  firefoxDbPath,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';
import type { BrowserName } from './shared.js';

export interface DownloadRow {
  browser: string;
  profile: string;
  url: string;
  filename: string;
  path: string;
  size: number;
  start_time: string;
  state: string;
}

// Chrome/Edge download state codes
const CHROMIUM_DOWNLOAD_STATES: Record<number, string> = {
  0: 'in_progress',
  1: 'complete',
  2: 'cancelled',
  3: 'interrupted',
};

// ── Chrome / Edge ────────────────────────────────────────────────────────────

export function parseChromiumDownloadRows(
  rows: Array<Record<string, unknown>>,
  browser: string,
  profile: string,
): DownloadRow[] {
  return rows.map((r) => {
    const stateCode = Number(r['state'] ?? 1);
    return {
      browser,
      profile,
      url: String(r['tab_url'] ?? r['url'] ?? ''),
      filename: String(r['target_path'] ?? r['current_path'] ?? '').split(/[/\\]/).pop() ?? '',
      path: String(r['target_path'] ?? r['current_path'] ?? ''),
      size: Number(r['total_bytes'] ?? 0),
      start_time: webkitToIso(Number(r['start_time'] ?? 0)),
      state: CHROMIUM_DOWNLOAD_STATES[stateCode] ?? 'unknown',
    };
  });
}

async function queryChromiumDownloads(browser: BrowserName, limit: number): Promise<DownloadRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: DownloadRow[] = [];

  for (const profile of profiles) {
    const dbPath = chromiumDbPath(profile.path, 'History');
    if (!existsSync(dbPath)) continue;

    let tempDb = null;
    try {
      tempDb = await copyDbToTemp(dbPath);
      const db = new Database(tempDb.path, { readonly: true, fileMustExist: true });
      try {
        // Try to join with downloads_url_chains for the source URL
        let rows: Array<Record<string, unknown>>;
        try {
          rows = db
            .prepare(
              `SELECT d.current_path, d.target_path, d.total_bytes, d.start_time, d.state,
                      c.url AS tab_url
               FROM downloads d
               LEFT JOIN downloads_url_chains c ON c.id = d.id AND c.chain_index = 0
               ORDER BY d.start_time DESC
               LIMIT ?`,
            )
            .all(limit) as Array<Record<string, unknown>>;
        } catch {
          // Fallback without URL chain join
          rows = db
            .prepare(
              `SELECT current_path, target_path, total_bytes, start_time, state
               FROM downloads
               ORDER BY start_time DESC
               LIMIT ?`,
            )
            .all(limit) as Array<Record<string, unknown>>;
        }
        allRows.push(...parseChromiumDownloadRows(rows, browser, profile.name));
      } finally {
        db.close();
      }
    } catch {
      // Skip
    } finally {
      await tempDb?.cleanup();
    }
  }

  return allRows;
}

// ── Firefox ──────────────────────────────────────────────────────────────────

export function parseFirefoxDownloadRows(
  rows: Array<Record<string, unknown>>,
  profile: string,
): DownloadRow[] {
  return rows.map((r) => {
    const content = String(r['content'] ?? '{}');
    let parsedContent: Record<string, unknown> = {};
    try {
      parsedContent = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // ignore
    }
    const filePath = String(parsedContent['file'] ?? '').replace(/^file:\/\//, '');
    return {
      browser: 'firefox',
      profile,
      url: String(r['url'] ?? ''),
      filename: filePath.split(/[/\\]/).pop() ?? '',
      path: filePath,
      size: Number(parsedContent['fileSize'] ?? 0),
      start_time: firefoxMicrosToIso(Number(r['dateAdded'] ?? 0)),
      state: parsedContent['state'] === 1 ? 'complete' : 'unknown',
    };
  });
}

async function queryFirefoxDownloads(limit: number): Promise<DownloadRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: DownloadRow[] = [];

  for (const profile of profiles) {
    const dbPath = firefoxDbPath(profile.path, 'places.sqlite');
    if (!existsSync(dbPath)) continue;

    let tempDb = null;
    try {
      tempDb = await copyDbToTemp(dbPath);
      const db = new Database(tempDb.path, { readonly: true, fileMustExist: true });
      try {
        const rows = db
          .prepare(
            `SELECT p.url, a.content, a.dateAdded
             FROM moz_annos a
             JOIN moz_places p ON a.place_id = p.id
             WHERE a.anno_attribute_id = (
               SELECT id FROM moz_anno_attributes WHERE name = 'downloads/destinationFileURI'
             )
             ORDER BY a.dateAdded DESC
             LIMIT ?`,
          )
          .all(limit) as Array<Record<string, unknown>>;
        allRows.push(...parseFirefoxDownloadRows(rows, profile.name));
      } finally {
        db.close();
      }
    } catch {
      // Skip
    } finally {
      await tempDb?.cleanup();
    }
  }

  return allRows;
}

// ── Run dispatcher ───────────────────────────────────────────────────────────

async function runBrowserDownloads(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);
  const limit = parseLimitArg(args, 100);

  try {
    const queries: Promise<DownloadRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxDownloads(limit));
      } else {
        queries.push(queryChromiumDownloads(browser, limit));
      }
    }

    const results = await Promise.all(queries);
    const rows = results
      .flat()
      .sort((a, b) => b.start_time.localeCompare(a.start_time))
      .slice(0, limit);

    return buildSuccess(rows, 'browser-downloads', platform);
  } catch (err) {
    return buildError(`browser-downloads failed: ${String(err)}`, 'EXEC_FAILED', 'browser-downloads');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-downloads': runBrowserDownloads,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
