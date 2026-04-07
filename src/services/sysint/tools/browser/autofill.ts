/**
 * BRW-06: browser-autofill — Autofill data from Chrome/Edge and Firefox.
 */
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  findBrowserProfiles,
  copyDbToTemp,
  unixSecondsToIso,
  firefoxMicrosToIso,
  parseBrowserArg,
  chromiumDbPath,
  firefoxDbPath,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';
import type { BrowserName } from './shared.js';

export interface AutofillRow {
  browser: string;
  profile: string;
  name: string;
  value: string;
  count: number;
  last_used: string;
}

// ── Chrome / Edge ────────────────────────────────────────────────────────────

export function parseChromiumAutofillRows(
  rows: Array<Record<string, unknown>>,
  browser: string,
  profile: string,
): AutofillRow[] {
  return rows.map((r) => ({
    browser,
    profile,
    name: String(r['name'] ?? ''),
    value: String(r['value'] ?? ''),
    count: Number(r['count'] ?? 0),
    last_used: unixSecondsToIso(Number(r['date_last_used'] ?? r['date_created'] ?? 0)),
  }));
}

async function queryChromiumAutofill(browser: BrowserName): Promise<AutofillRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: AutofillRow[] = [];

  for (const profile of profiles) {
    const dbPath = chromiumDbPath(profile.path, 'Web Data');
    if (!existsSync(dbPath)) continue;

    let tempDb = null;
    try {
      tempDb = await copyDbToTemp(dbPath);
      const db = new Database(tempDb.path, { readonly: true, fileMustExist: true });
      try {
        const rows = db
          .prepare(
            `SELECT name, value, count, date_last_used, date_created
             FROM autofill
             ORDER BY count DESC, date_last_used DESC`,
          )
          .all() as Array<Record<string, unknown>>;
        allRows.push(...parseChromiumAutofillRows(rows, browser, profile.name));
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

export function parseFirefoxAutofillRows(
  rows: Array<Record<string, unknown>>,
  profile: string,
): AutofillRow[] {
  return rows.map((r) => ({
    browser: 'firefox',
    profile,
    name: String(r['fieldname'] ?? ''),
    value: String(r['value'] ?? ''),
    count: Number(r['timesUsed'] ?? 0),
    last_used: firefoxMicrosToIso(Number(r['lastUsed'] ?? 0)),
  }));
}

async function queryFirefoxAutofill(): Promise<AutofillRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: AutofillRow[] = [];

  for (const profile of profiles) {
    const dbPath = firefoxDbPath(profile.path, 'formhistory.sqlite');
    if (!existsSync(dbPath)) continue;

    let tempDb = null;
    try {
      tempDb = await copyDbToTemp(dbPath);
      const db = new Database(tempDb.path, { readonly: true, fileMustExist: true });
      try {
        const rows = db
          .prepare(
            `SELECT fieldname, value, timesUsed, lastUsed
             FROM moz_formhistory
             ORDER BY timesUsed DESC, lastUsed DESC`,
          )
          .all() as Array<Record<string, unknown>>;
        allRows.push(...parseFirefoxAutofillRows(rows, profile.name));
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

async function runBrowserAutofill(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);

  try {
    const queries: Promise<AutofillRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxAutofill());
      } else {
        queries.push(queryChromiumAutofill(browser));
      }
    }

    const results = await Promise.all(queries);
    const rows = results.flat();

    return buildSuccess(rows, 'browser-autofill', platform);
  } catch (err) {
    return buildError(`browser-autofill failed: ${String(err)}`, 'EXEC_FAILED', 'browser-autofill');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-autofill': runBrowserAutofill,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
