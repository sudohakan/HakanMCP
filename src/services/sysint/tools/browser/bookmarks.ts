/**
 * BRW-02: browser-bookmarks — Bookmarks from Chrome, Edge, and Firefox.
 * Chrome/Edge: parse Bookmarks JSON file.
 * Firefox: query places.sqlite moz_bookmarks + moz_places.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
  chromiumDbPath,
  firefoxDbPath,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';
import type { BrowserName } from './shared.js';

export interface BookmarkRow {
  browser: string;
  profile: string;
  url: string;
  title: string;
  folder: string;
  date_added: string;
}

// ── Chrome / Edge ────────────────────────────────────────────────────────────

interface ChromiumBookmarkNode {
  type: string;
  name: string;
  url?: string;
  date_added?: string;
  children?: ChromiumBookmarkNode[];
}

export function flattenChromiumBookmarks(
  node: ChromiumBookmarkNode,
  folderPath: string,
  browser: string,
  profile: string,
): BookmarkRow[] {
  const rows: BookmarkRow[] = [];

  if (node.type === 'url' && node.url) {
    rows.push({
      browser,
      profile,
      url: node.url,
      title: node.name ?? '',
      folder: folderPath,
      date_added: webkitToIso(parseInt(node.date_added ?? '0', 10)),
    });
  }

  if (node.children) {
    const nextFolder = folderPath ? `${folderPath}/${node.name}` : node.name;
    for (const child of node.children) {
      rows.push(...flattenChromiumBookmarks(child, nextFolder, browser, profile));
    }
  }

  return rows;
}

export function parseChromiumBookmarksJson(
  raw: string,
  browser: string,
  profile: string,
): BookmarkRow[] {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }

  const roots = data['roots'] as Record<string, ChromiumBookmarkNode> | undefined;
  if (!roots) return [];

  const rows: BookmarkRow[] = [];
  for (const rootName of ['bookmark_bar', 'other', 'synced']) {
    const root = roots[rootName];
    if (root) {
      rows.push(...flattenChromiumBookmarks(root, rootName, browser, profile));
    }
  }
  return rows;
}

async function queryChromiumBookmarks(browser: BrowserName): Promise<BookmarkRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: BookmarkRow[] = [];

  for (const profile of profiles) {
    const bookmarksPath = chromiumDbPath(profile.path, 'Bookmarks');
    if (!existsSync(bookmarksPath)) continue;

    try {
      const raw = await readFile(bookmarksPath, 'utf8');
      allRows.push(...parseChromiumBookmarksJson(raw, browser, profile.name));
    } catch {
      // Skip on error
    }
  }

  return allRows;
}

// ── Firefox ──────────────────────────────────────────────────────────────────

export function parseFirefoxBookmarkRows(
  rows: Array<Record<string, unknown>>,
  profile: string,
): BookmarkRow[] {
  return rows.map((r) => ({
    browser: 'firefox',
    profile,
    url: String(r['url'] ?? ''),
    title: String(r['title'] ?? ''),
    folder: String(r['folder'] ?? ''),
    date_added: firefoxMicrosToIso(Number(r['dateAdded'] ?? 0)),
  }));
}

async function queryFirefoxBookmarks(): Promise<BookmarkRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: BookmarkRow[] = [];

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
            `SELECT p.url, p.title, b.dateAdded,
                    (SELECT title FROM moz_bookmarks WHERE id = b.parent) AS folder
             FROM moz_bookmarks b
             JOIN moz_places p ON b.fk = p.id
             WHERE b.type = 1
             ORDER BY b.dateAdded DESC`,
          )
          .all() as Array<Record<string, unknown>>;
        allRows.push(...parseFirefoxBookmarkRows(rows, profile.name));
      } finally {
        db.close();
      }
    } catch {
      // Skip this profile
    } finally {
      await tempDb?.cleanup();
    }
  }

  return allRows;
}

// ── Run dispatcher ───────────────────────────────────────────────────────────

async function runBrowserBookmarks(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);

  try {
    const queries: Promise<BookmarkRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxBookmarks());
      } else {
        queries.push(queryChromiumBookmarks(browser));
      }
    }

    const results = await Promise.all(queries);
    const rows = results.flat();

    return buildSuccess(rows, 'browser-bookmarks', platform);
  } catch (err) {
    return buildError(`browser-bookmarks failed: ${String(err)}`, 'EXEC_FAILED', 'browser-bookmarks');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-bookmarks': runBrowserBookmarks,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
