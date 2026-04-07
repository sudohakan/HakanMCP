/**
 * BRW-10: browser-forms — Saved form data / address profiles from Chrome, Edge, and Firefox.
 * Chrome/Edge: autofill_profiles, credit_cards (non-sensitive fields only).
 * Firefox: formhistory.sqlite for address-like field data.
 */
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  findBrowserProfiles,
  copyDbToTemp,
  parseBrowserArg,
  chromiumDbPath,
  firefoxDbPath,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';
import type { BrowserName } from './shared.js';

export interface FormRow {
  browser: string;
  profile: string;
  field_name: string;
  value: string;
  count: number | null;
}

// ── Chrome / Edge ────────────────────────────────────────────────────────────

export function parseChromiumProfileRows(
  rows: Array<Record<string, unknown>>,
  browser: string,
  profile: string,
): FormRow[] {
  const result: FormRow[] = [];
  for (const r of rows) {
    const fields: Record<string, unknown> = {
      full_name: r['full_name'],
      company_name: r['company_name'],
      street_address: r['street_address'],
      city: r['city'],
      state: r['state'],
      zipcode: r['zipcode'],
      country_code: r['country_code'],
      email: r['email'],
      phone: r['phone'],
    };
    for (const [fieldName, value] of Object.entries(fields)) {
      if (value && String(value).trim()) {
        result.push({
          browser,
          profile,
          field_name: fieldName,
          value: String(value),
          count: null,
        });
      }
    }
  }
  return result;
}

export function parseChromiumCreditCardRows(
  rows: Array<Record<string, unknown>>,
  browser: string,
  profile: string,
): FormRow[] {
  const result: FormRow[] = [];
  for (const r of rows) {
    // Only non-sensitive fields: last 4 digits, cardholder name, expiry
    if (r['last_four']) {
      result.push({ browser, profile, field_name: 'card_last4', value: String(r['last_four']), count: null });
    }
    if (r['name_on_card']) {
      result.push({ browser, profile, field_name: 'card_holder', value: String(r['name_on_card']), count: null });
    }
    if (r['expiration_month'] && r['expiration_year']) {
      result.push({
        browser,
        profile,
        field_name: 'card_expiry',
        value: `${r['expiration_month']}/${r['expiration_year']}`,
        count: null,
      });
    }
  }
  return result;
}

async function queryChromiumForms(browser: BrowserName): Promise<FormRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: FormRow[] = [];

  for (const profile of profiles) {
    const dbPath = chromiumDbPath(profile.path, 'Web Data');
    if (!existsSync(dbPath)) continue;

    let tempDb = null;
    try {
      tempDb = await copyDbToTemp(dbPath);
      const db = new Database(tempDb.path, { readonly: true, fileMustExist: true });
      try {
        // Try autofill_profiles (may not exist in all Chrome versions)
        try {
          const profileRows = db
            .prepare(
              `SELECT full_name, company_name, street_address, city, state, zipcode, country_code
               FROM autofill_profiles
               LIMIT 500`,
            )
            .all() as Array<Record<string, unknown>>;
          allRows.push(...parseChromiumProfileRows(profileRows, browser, profile.name));
        } catch {
          // Table may not exist in all Chrome versions
        }

        // Try credit_cards (non-sensitive fields)
        try {
          const cardRows = db
            .prepare(
              `SELECT name_on_card, last_four, expiration_month, expiration_year
               FROM credit_cards
               LIMIT 100`,
            )
            .all() as Array<Record<string, unknown>>;
          allRows.push(...parseChromiumCreditCardRows(cardRows, browser, profile.name));
        } catch {
          // Table may not exist
        }
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

// Fields that look like address/name/form data (not search queries)
const ADDRESS_FIELD_PATTERNS = /^(name|email|phone|address|city|state|zip|country|company|first|last|street|postal)/i;

export function parseFirefoxFormRows(
  rows: Array<Record<string, unknown>>,
  profile: string,
): FormRow[] {
  return rows
    .filter((r) => ADDRESS_FIELD_PATTERNS.test(String(r['fieldname'] ?? '')))
    .map((r) => ({
      browser: 'firefox',
      profile,
      field_name: String(r['fieldname'] ?? ''),
      value: String(r['value'] ?? ''),
      count: Number(r['timesUsed'] ?? 0),
    }));
}

async function queryFirefoxForms(): Promise<FormRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: FormRow[] = [];

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
            `SELECT fieldname, value, timesUsed
             FROM moz_formhistory
             ORDER BY timesUsed DESC`,
          )
          .all() as Array<Record<string, unknown>>;
        allRows.push(...parseFirefoxFormRows(rows, profile.name));
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

async function runBrowserForms(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);

  try {
    const queries: Promise<FormRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxForms());
      } else {
        queries.push(queryChromiumForms(browser));
      }
    }

    const results = await Promise.all(queries);
    const rows = results.flat();

    return buildSuccess(rows, 'browser-forms', platform);
  } catch (err) {
    return buildError(`browser-forms failed: ${String(err)}`, 'EXEC_FAILED', 'browser-forms');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-forms': runBrowserForms,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
