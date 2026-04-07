/**
 * BRW-03: browser-cookies — Cookie reader for Chrome, Edge, and Firefox.
 * Note: Chrome/Edge encrypted_value (DPAPI) is skipped — Phase 4 handles decryption.
 * Plaintext value column is read as-is.
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
  unixSecondsToIso,
  parseBrowserArg,
  chromiumDbPath,
  firefoxDbPath,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';
import type { BrowserName } from './shared.js';

export interface CookieRow {
  browser: string;
  profile: string;
  domain: string;
  name: string;
  value: string;
  path: string;
  expiry: string;
  secure: boolean;
  httpOnly: boolean;
}

// ── Chrome / Edge ────────────────────────────────────────────────────────────

export function parseChromiumCookieRows(
  rows: Array<Record<string, unknown>>,
  browser: string,
  profile: string,
): CookieRow[] {
  return rows.map((r) => ({
    browser,
    profile,
    domain: String(r['host_key'] ?? ''),
    name: String(r['name'] ?? ''),
    // value is plaintext for non-encrypted cookies; encrypted_value skipped
    value: String(r['value'] ?? ''),
    path: String(r['path'] ?? ''),
    expiry: webkitToIso(Number(r['expires_utc'] ?? 0)),
    secure: Boolean(r['is_secure'] ?? false),
    httpOnly: Boolean(r['is_httponly'] ?? false),
  }));
}

async function queryChromiumCookies(browser: BrowserName): Promise<CookieRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: CookieRow[] = [];

  for (const profile of profiles) {
    // Cookies DB is in "Network" subdirectory in newer Chrome/Edge versions
    const cookiesPathNetwork = chromiumDbPath(profile.path, 'Network/Cookies');
    const cookiesPathDirect = chromiumDbPath(profile.path, 'Cookies');
    const dbPath = existsSync(cookiesPathNetwork) ? cookiesPathNetwork : cookiesPathDirect;

    if (!existsSync(dbPath)) continue;

    let tempDb = null;
    try {
      tempDb = await copyDbToTemp(dbPath);
      const db = new Database(tempDb.path, { readonly: true, fileMustExist: true });
      try {
        const rows = db
          .prepare(
            `SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly
             FROM cookies
             ORDER BY host_key`,
          )
          .all() as Array<Record<string, unknown>>;
        allRows.push(...parseChromiumCookieRows(rows, browser, profile.name));
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

// ── Firefox ──────────────────────────────────────────────────────────────────

export function parseFirefoxCookieRows(
  rows: Array<Record<string, unknown>>,
  profile: string,
): CookieRow[] {
  return rows.map((r) => ({
    browser: 'firefox',
    profile,
    domain: String(r['host'] ?? ''),
    name: String(r['name'] ?? ''),
    value: String(r['value'] ?? ''),
    path: String(r['path'] ?? ''),
    expiry: unixSecondsToIso(Number(r['expiry'] ?? 0)),
    secure: Boolean(r['isSecure'] ?? false),
    httpOnly: Boolean(r['isHttpOnly'] ?? false),
  }));
}

async function queryFirefoxCookies(): Promise<CookieRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: CookieRow[] = [];

  for (const profile of profiles) {
    const dbPath = firefoxDbPath(profile.path, 'cookies.sqlite');
    if (!existsSync(dbPath)) continue;

    let tempDb = null;
    try {
      tempDb = await copyDbToTemp(dbPath);
      const db = new Database(tempDb.path, { readonly: true, fileMustExist: true });
      try {
        const rows = db
          .prepare(
            `SELECT host, name, value, path, expiry, isSecure, isHttpOnly
             FROM moz_cookies
             ORDER BY host`,
          )
          .all() as Array<Record<string, unknown>>;
        allRows.push(...parseFirefoxCookieRows(rows, profile.name));
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

async function runBrowserCookies(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);

  try {
    const queries: Promise<CookieRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxCookies());
      } else {
        queries.push(queryChromiumCookies(browser));
      }
    }

    const results = await Promise.all(queries);
    const rows = results.flat();

    return buildSuccess(rows, 'browser-cookies', platform);
  } catch (err) {
    return buildError(`browser-cookies failed: ${String(err)}`, 'EXEC_FAILED', 'browser-cookies');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-cookies': runBrowserCookies,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
