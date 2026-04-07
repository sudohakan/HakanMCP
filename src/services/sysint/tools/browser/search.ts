/**
 * BRW-08: browser-search-history — Last search queries from Chrome, Edge, and Firefox.
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

export interface SearchRow {
  browser: string;
  profile: string;
  query: string;
  timestamp: string;
  engine: string;
  url: string;
}

/** Attempt to extract search engine name from URL domain. */
function detectEngine(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('google')) return 'google';
    if (hostname.includes('bing')) return 'bing';
    if (hostname.includes('yahoo')) return 'yahoo';
    if (hostname.includes('duckduckgo')) return 'duckduckgo';
    if (hostname.includes('baidu')) return 'baidu';
    if (hostname.includes('yandex')) return 'yandex';
    return hostname;
  } catch {
    return 'unknown';
  }
}

// ── Chrome / Edge ────────────────────────────────────────────────────────────

export function parseChromiumSearchRows(
  rows: Array<Record<string, unknown>>,
  browser: string,
  profile: string,
): SearchRow[] {
  return rows.map((r) => {
    const url = String(r['url'] ?? '');
    return {
      browser,
      profile,
      query: String(r['term'] ?? ''),
      timestamp: webkitToIso(Number(r['last_visit_time'] ?? 0)),
      engine: detectEngine(url),
      url,
    };
  });
}

async function queryChromiumSearchHistory(
  browser: BrowserName,
  limit: number,
): Promise<SearchRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: SearchRow[] = [];

  for (const profile of profiles) {
    const dbPath = chromiumDbPath(profile.path, 'History');
    if (!existsSync(dbPath)) continue;

    let tempDb = null;
    try {
      tempDb = await copyDbToTemp(dbPath);
      const db = new Database(tempDb.path, { readonly: true, fileMustExist: true });
      try {
        const rows = db
          .prepare(
            `SELECT k.term, u.url, u.last_visit_time
             FROM keyword_search_terms k
             JOIN urls u ON k.url_id = u.id
             ORDER BY u.last_visit_time DESC
             LIMIT ?`,
          )
          .all(limit) as Array<Record<string, unknown>>;
        allRows.push(...parseChromiumSearchRows(rows, browser, profile.name));
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

export function parseFirefoxSearchRows(
  rows: Array<Record<string, unknown>>,
  profile: string,
): SearchRow[] {
  return rows.map((r) => {
    const url = String(r['url'] ?? '');
    return {
      browser: 'firefox',
      profile,
      query: String(r['input'] ?? ''),
      timestamp: firefoxMicrosToIso(Number(r['last_visit_date'] ?? 0)),
      engine: detectEngine(url),
      url,
    };
  });
}

async function queryFirefoxSearchHistory(limit: number): Promise<SearchRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: SearchRow[] = [];

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
            `SELECT i.input, p.url, p.last_visit_date
             FROM moz_inputhistory i
             JOIN moz_places p ON i.place_id = p.id
             ORDER BY p.last_visit_date DESC
             LIMIT ?`,
          )
          .all(limit) as Array<Record<string, unknown>>;
        allRows.push(...parseFirefoxSearchRows(rows, profile.name));
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

async function runBrowserSearchHistory(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);
  const limit = parseLimitArg(args, 50);

  try {
    const queries: Promise<SearchRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxSearchHistory(limit));
      } else {
        queries.push(queryChromiumSearchHistory(browser, limit));
      }
    }

    const results = await Promise.all(queries);
    const rows = results
      .flat()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);

    return buildSuccess(rows, 'browser-search-history', platform);
  } catch (err) {
    return buildError(
      `browser-search-history failed: ${String(err)}`,
      'EXEC_FAILED',
      'browser-search-history',
    );
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-search-history': runBrowserSearchHistory,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
