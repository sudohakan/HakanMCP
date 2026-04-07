/**
 * Browser Phase 3 Plan 02 tests — BRW-03, BRW-04, BRW-05, BRW-06
 * Tests: cookies, downloads, extensions, autofill parsers + integration.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'src/services/sysint/__tests__/fixtures');

const firefoxExtensionsFixture = readFileSync(join(FIXTURES, 'browser-firefox-extensions.json'), 'utf8');
const chromeManifestFixture = readFileSync(join(FIXTURES, 'browser-chrome-manifest.json'), 'utf8');

// ── Imports ──────────────────────────────────────────────────────────────────

let parseChromiumCookieRows: (rows: unknown[], browser: string, profile: string) => unknown[];
let parseFirefoxCookieRows: (rows: unknown[], profile: string) => unknown[];
let cookiesRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parseChromiumDownloadRows: (rows: unknown[], browser: string, profile: string) => unknown[];
let parseFirefoxDownloadRows: (rows: unknown[], profile: string) => unknown[];
let downloadsRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parseChromiumManifest: (raw: string, id: string, browser: string, profile: string, enabled?: boolean) => unknown;
let parseFirefoxExtensionsJson: (raw: string, profile: string) => unknown[];
let extensionsRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parseChromiumAutofillRows: (rows: unknown[], browser: string, profile: string) => unknown[];
let parseFirefoxAutofillRows: (rows: unknown[], profile: string) => unknown[];
let autofillRun: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const cookiesMod = await import('../tools/browser/cookies.js');
  parseChromiumCookieRows = cookiesMod.parseChromiumCookieRows as unknown as typeof parseChromiumCookieRows;
  parseFirefoxCookieRows = cookiesMod.parseFirefoxCookieRows as unknown as typeof parseFirefoxCookieRows;
  cookiesRun = cookiesMod.run as unknown as typeof cookiesRun;

  const downloadsMod = await import('../tools/browser/downloads.js');
  parseChromiumDownloadRows = downloadsMod.parseChromiumDownloadRows as unknown as typeof parseChromiumDownloadRows;
  parseFirefoxDownloadRows = downloadsMod.parseFirefoxDownloadRows as unknown as typeof parseFirefoxDownloadRows;
  downloadsRun = downloadsMod.run as unknown as typeof downloadsRun;

  const extensionsMod = await import('../tools/browser/extensions.js');
  parseChromiumManifest = extensionsMod.parseChromiumManifest;
  parseFirefoxExtensionsJson = extensionsMod.parseFirefoxExtensionsJson;
  extensionsRun = extensionsMod.run as unknown as typeof extensionsRun;

  const autofillMod = await import('../tools/browser/autofill.js');
  parseChromiumAutofillRows = autofillMod.parseChromiumAutofillRows as unknown as typeof parseChromiumAutofillRows;
  parseFirefoxAutofillRows = autofillMod.parseFirefoxAutofillRows as unknown as typeof parseFirefoxAutofillRows;
  autofillRun = autofillMod.run as unknown as typeof autofillRun;
});

// ── Cookies ──────────────────────────────────────────────────────────────────

describe('parseChromiumCookieRows', () => {
  it('maps Chrome cookie fields to unified row', () => {
    const raw = [
      {
        host_key: 'example.com',
        name: 'session',
        value: 'abc123',
        path: '/',
        expires_utc: 13300000000000000,
        is_secure: 1,
        is_httponly: 0,
      },
    ];
    const rows = parseChromiumCookieRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['domain']).toBe('example.com');
    expect(rows[0]!['name']).toBe('session');
    expect(rows[0]!['value']).toBe('abc123');
    expect(rows[0]!['secure']).toBe(true);
    expect(rows[0]!['httpOnly']).toBe(false);
    expect(rows[0]!['browser']).toBe('chrome');
  });

  it('handles missing optional fields', () => {
    const rows = parseChromiumCookieRows([{}] as unknown[], 'edge', 'Default') as Array<Record<string, unknown>>;
    expect(rows[0]!['domain']).toBe('');
    expect(rows[0]!['expiry']).toBe('');
  });
});

describe('parseFirefoxCookieRows', () => {
  it('maps Firefox cookie fields to unified row', () => {
    const raw = [
      {
        host: '.mozilla.org',
        name: '_ga',
        value: 'GA1.2.123456',
        path: '/',
        expiry: 1900000000,
        isSecure: 1,
        isHttpOnly: 1,
      },
    ];
    const rows = parseFirefoxCookieRows(raw as unknown[], 'default-release') as Array<Record<string, unknown>>;
    expect(rows[0]!['domain']).toBe('.mozilla.org');
    expect(rows[0]!['browser']).toBe('firefox');
    expect(rows[0]!['secure']).toBe(true);
    expect(typeof rows[0]!['expiry']).toBe('string');
  });
});

// ── Downloads ────────────────────────────────────────────────────────────────

describe('parseChromiumDownloadRows', () => {
  it('maps download state codes correctly', () => {
    const raw = [
      { target_path: '/home/user/Downloads/file.pdf', total_bytes: 1024, start_time: 13300000000000000, state: 1, tab_url: 'https://example.com/file.pdf' },
      { target_path: '/home/user/Downloads/img.png', total_bytes: 512, start_time: 13300000000100000, state: 2, tab_url: '' },
    ];
    const rows = parseChromiumDownloadRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows[0]!['state']).toBe('complete');
    expect(rows[1]!['state']).toBe('cancelled');
    expect(rows[0]!['filename']).toBe('file.pdf');
    expect(rows[0]!['size']).toBe(1024);
  });

  it('handles state 0 as in_progress', () => {
    const raw = [{ target_path: '/tmp/dl', total_bytes: 0, start_time: 0, state: 0 }];
    const rows = parseChromiumDownloadRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows[0]!['state']).toBe('in_progress');
  });

  it('handles unknown state codes', () => {
    const raw = [{ target_path: '/tmp/dl', total_bytes: 0, start_time: 0, state: 99 }];
    const rows = parseChromiumDownloadRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows[0]!['state']).toBe('unknown');
  });
});

describe('parseFirefoxDownloadRows', () => {
  it('parses Firefox download annotation content', () => {
    const raw = [
      {
        url: 'https://mozilla.org/firefox.exe',
        content: JSON.stringify({ file: 'file:///C:/Users/user/Downloads/firefox.exe', fileSize: 50000000, state: 1 }),
        dateAdded: Date.now() * 1000,
      },
    ];
    const rows = parseFirefoxDownloadRows(raw as unknown[], 'default-release') as Array<Record<string, unknown>>;
    expect(rows[0]!['browser']).toBe('firefox');
    expect(rows[0]!['filename']).toBe('firefox.exe');
    expect(rows[0]!['size']).toBe(50000000);
    expect(rows[0]!['state']).toBe('complete');
  });

  it('handles malformed content JSON', () => {
    const raw = [{ url: 'https://example.com', content: 'not-json', dateAdded: 0 }];
    const rows = parseFirefoxDownloadRows(raw as unknown[], 'default-release') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['filename']).toBe('');
  });
});

// ── Extensions ───────────────────────────────────────────────────────────────

describe('parseChromiumManifest', () => {
  it('parses Chrome extension manifest.json', () => {
    const row = parseChromiumManifest(
      chromeManifestFixture,
      'fmkadmapgofadopljbjfkapdkoienihi',
      'chrome',
      'Default',
    ) as Record<string, unknown>;
    expect(row).not.toBeNull();
    expect(row!['name']).toBe('React Developer Tools');
    expect(row!['version']).toBe('4.28.4');
    expect(row!['enabled']).toBe(true);
    expect(Array.isArray(row!['permissions'])).toBe(true);
    expect((row!['permissions'] as string[])).toContain('storage');
  });

  it('returns null for invalid JSON', () => {
    const row = parseChromiumManifest('not-json', 'test-id', 'chrome', 'Default');
    expect(row).toBeNull();
  });

  it('respects enabled parameter', () => {
    const row = parseChromiumManifest(chromeManifestFixture, 'test-id', 'chrome', 'Default', false) as Record<string, unknown>;
    expect(row!['enabled']).toBe(false);
  });
});

describe('parseFirefoxExtensionsJson', () => {
  it('parses Firefox extensions.json', () => {
    const rows = parseFirefoxExtensionsJson(firefoxExtensionsFixture, 'default-release') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!['name']).toBe('uBlock Origin');
    expect(rows[0]!['version']).toBe('1.55.0');
    expect(rows[0]!['enabled']).toBe(true);
    expect(Array.isArray(rows[0]!['permissions'])).toBe(true);
    expect(rows[1]!['enabled']).toBe(false);
  });

  it('returns empty for invalid JSON', () => {
    const rows = parseFirefoxExtensionsJson('bad', 'profile');
    expect(rows).toEqual([]);
  });

  it('sets browser to firefox', () => {
    const rows = parseFirefoxExtensionsJson(firefoxExtensionsFixture, 'test') as Array<Record<string, unknown>>;
    for (const r of rows) {
      expect(r['browser']).toBe('firefox');
    }
  });
});

// ── Autofill ─────────────────────────────────────────────────────────────────

describe('parseChromiumAutofillRows', () => {
  it('maps Chrome autofill fields', () => {
    const raw = [
      { name: 'email', value: 'test@example.com', count: 10, date_last_used: 1700000000, date_created: 1600000000 },
    ];
    const rows = parseChromiumAutofillRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows[0]!['name']).toBe('email');
    expect(rows[0]!['value']).toBe('test@example.com');
    expect(rows[0]!['count']).toBe(10);
    expect(typeof rows[0]!['last_used']).toBe('string');
  });
});

describe('parseFirefoxAutofillRows', () => {
  it('maps Firefox formhistory fields', () => {
    const raw = [
      { fieldname: 'username', value: 'john', timesUsed: 5, lastUsed: Date.now() * 1000 },
    ];
    const rows = parseFirefoxAutofillRows(raw as unknown[], 'default') as Array<Record<string, unknown>>;
    expect(rows[0]!['name']).toBe('username');
    expect(rows[0]!['count']).toBe(5);
    expect(rows[0]!['browser']).toBe('firefox');
  });
});

// ── Integration ──────────────────────────────────────────────────────────────

describe('browser-cookies integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await cookiesRun('browser-cookies', []) as Record<string, unknown>;
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-cookies');
    } else {
      expect(typeof result['error']).toBe('string');
    }
  });
});

describe('browser-downloads integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await downloadsRun('browser-downloads', []) as Record<string, unknown>;
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-downloads');
    }
  });
});

describe('browser-extensions integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await extensionsRun('browser-extensions', []) as Record<string, unknown>;
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-extensions');
    }
  });
});

describe('browser-autofill integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await autofillRun('browser-autofill', []) as Record<string, unknown>;
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-autofill');
    }
  });
});
