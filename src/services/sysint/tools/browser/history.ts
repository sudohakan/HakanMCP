/**
 * BRW-01: browser-history — Browsing history from Chrome, Edge, and Firefox.
 * Unified output across all browsers with WAL-safe temp copy approach.
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

export interface HistoryRow {
  browser: string;
  profile: string;
  url: string;
  title: string;
  visit_time: string;
  visit_count: number;
}

// ── Chrome / Edge ────────────────────────────────────────────────────────────

export function parseChromiumHistoryRows(
  rows: Array<Record<string, unknown>>,
  browser: string,
  profile: string,
): HistoryRow[] {
  return rows.map((r) => ({
    browser,
    profile,
    url: String(r['url'] ?? ''),
    title: String(r['title'] ?? ''),
    visit_time: webkitToIso(Number(r['last_visit_time'] ?? 0)),
    visit_count: Number(r['visit_count'] ?? 0),
  }));
}

async function queryChromiumHistory(
  browser: BrowserName,
  limit: number,
): Promise<HistoryRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: HistoryRow[] = [];

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
            `SELECT url, title, last_visit_time, visit_count
             FROM urls
             ORDER BY last_visit_time DESC`,
          )
          .all() as Array<Record<string, unknown>>;
        allRows.push(...parseChromiumHistoryRows(rows, browser, profile.name));
      } finally {
        db.close();
      }
    } catch {
      // Skip this profile on error (corrupt DB, locked, etc.)
    } finally {
      await tempDb?.cleanup();
    }
  }

  return allRows;
}

// ── Firefox ──────────────────────────────────────────────────────────────────

export function parseFirefoxHistoryRows(
  rows: Array<Record<string, unknown>>,
  profile: string,
): HistoryRow[] {
  return rows.map((r) => ({
    browser: 'firefox',
    profile,
    url: String(r['url'] ?? ''),
    title: String(r['title'] ?? ''),
    visit_time: firefoxMicrosToIso(Number(r['visit_date'] ?? 0)),
    visit_count: Number(r['visit_count'] ?? 0),
  }));
}

async function queryFirefoxHistory(limit: number): Promise<HistoryRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: HistoryRow[] = [];

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
            `SELECT p.url, p.title, h.visit_date, p.visit_count
             FROM moz_historyvisits h
             JOIN moz_places p ON h.place_id = p.id
             ORDER BY h.visit_date DESC`,
          )
          .all() as Array<Record<string, unknown>>;
        allRows.push(...parseFirefoxHistoryRows(rows, profile.name));
      } finally {
        db.close();
      }
    } catch {
      // Skip this profile on error
    } finally {
      await tempDb?.cleanup();
    }
  }

  return allRows;
}

// ── Run dispatcher ───────────────────────────────────────────────────────────

async function runBrowserHistory(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);
  const limit = parseLimitArg(args, 100);

  try {
    const queries: Promise<HistoryRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxHistory(limit));
      } else {
        queries.push(queryChromiumHistory(browser, limit));
      }
    }

    const results = await Promise.all(queries);
    const rows = results
      .flat()
      .sort((a, b) => b.visit_time.localeCompare(a.visit_time))
      .slice(0, limit);

    return buildSuccess(rows, 'browser-history', platform);
  } catch (err) {
    return buildError(`browser-history failed: ${String(err)}`, 'EXEC_FAILED', 'browser-history');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-history': runBrowserHistory,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
