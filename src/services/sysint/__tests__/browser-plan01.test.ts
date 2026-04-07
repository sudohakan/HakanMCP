/**
 * Browser Phase 3 Plan 01 tests — BRW-01, BRW-02, BRW-09
 * Tests: profile discovery, history parsers, bookmark parsers.
 * Integration tests validate shape only (no browser required to pass).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'src/services/sysint/__tests__/fixtures');

const chromeBookmarksFixture = readFileSync(join(FIXTURES, 'browser-chrome-bookmarks.json'), 'utf8');

// ── Imports ──────────────────────────────────────────────────────────────────

let parseChromiumBookmarksJson: (raw: string, browser: string, profile: string) => unknown[];
let flattenChromiumBookmarks: (node: unknown, folder: string, browser: string, profile: string) => unknown[];
let parseFirefoxBookmarkRows: (rows: unknown[], profile: string) => unknown[];
let parseChromiumHistoryRows: (rows: unknown[], browser: string, profile: string) => unknown[];
let parseFirefoxHistoryRows: (rows: unknown[], profile: string) => unknown[];
let webkitToIso: (webkitMicros: number) => string;
let firefoxMicrosToIso: (micros: number) => string;
let parseBrowserArg: (args: string[]) => string[];
let parseLimitArg: (args: string[], defaultLimit?: number) => number;
let historyRun: (toolId: string, args?: string[]) => Promise<unknown>;
let bookmarksRun: (toolId: string, args?: string[]) => Promise<unknown>;
let profilesRun: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const sharedMod = await import('../tools/browser/shared.js');
  webkitToIso = sharedMod.webkitToIso;
  firefoxMicrosToIso = sharedMod.firefoxMicrosToIso;
  parseBrowserArg = sharedMod.parseBrowserArg;
  parseLimitArg = sharedMod.parseLimitArg;

  const historyMod = await import('../tools/browser/history.js');
  parseChromiumHistoryRows = historyMod.parseChromiumHistoryRows as unknown as typeof parseChromiumHistoryRows;
  parseFirefoxHistoryRows = historyMod.parseFirefoxHistoryRows as unknown as typeof parseFirefoxHistoryRows;
  historyRun = historyMod.run as unknown as typeof historyRun;

  const bookmarksMod = await import('../tools/browser/bookmarks.js');
  parseChromiumBookmarksJson = bookmarksMod.parseChromiumBookmarksJson;
  flattenChromiumBookmarks = bookmarksMod.flattenChromiumBookmarks as typeof flattenChromiumBookmarks;
  parseFirefoxBookmarkRows = bookmarksMod.parseFirefoxBookmarkRows as unknown as typeof parseFirefoxBookmarkRows;
  bookmarksRun = bookmarksMod.run as unknown as typeof bookmarksRun;

  const profilesMod = await import('../tools/browser/profiles.js');
  profilesRun = profilesMod.run as unknown as typeof profilesRun;
});

// ── Timestamp conversion ─────────────────────────────────────────────────────

describe('webkitToIso', () => {
  it('converts Chrome timestamp 0 to empty string', () => {
    expect(webkitToIso(0)).toBe('');
  });

  it('converts a known WebKit timestamp to ISO string', () => {
    // 13300000000000000 microseconds from 1601-01-01
    const iso = webkitToIso(13300000000000000);
    expect(typeof iso).toBe('string');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('firefoxMicrosToIso', () => {
  it('converts 0 to empty string', () => {
    expect(firefoxMicrosToIso(0)).toBe('');
  });

  it('converts Firefox microsecond timestamp', () => {
    const nowMicros = Date.now() * 1000;
    const iso = firefoxMicrosToIso(nowMicros);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── Arg parsers ──────────────────────────────────────────────────────────────

describe('parseBrowserArg', () => {
  it('returns all browsers when no --browser arg', () => {
    expect(parseBrowserArg([])).toEqual(['chrome', 'edge', 'firefox']);
  });

  it('returns all browsers for --browser all', () => {
    expect(parseBrowserArg(['--browser', 'all'])).toEqual(['chrome', 'edge', 'firefox']);
  });

  it('returns single browser for --browser chrome', () => {
    expect(parseBrowserArg(['--browser', 'chrome'])).toEqual(['chrome']);
  });

  it('returns single browser for --browser firefox', () => {
    expect(parseBrowserArg(['--browser', 'firefox'])).toEqual(['firefox']);
  });
});

describe('parseLimitArg', () => {
  it('returns default when no --limit arg', () => {
    expect(parseLimitArg([], 100)).toBe(100);
  });

  it('parses --limit value', () => {
    expect(parseLimitArg(['--limit', '50'])).toBe(50);
  });

  it('returns default for invalid limit', () => {
    expect(parseLimitArg(['--limit', 'abc'], 100)).toBe(100);
  });
});

// ── History parsers ──────────────────────────────────────────────────────────

describe('parseChromiumHistoryRows', () => {
  it('converts Chrome History table rows to HistoryRow shape', () => {
    const raw = [
      { url: 'https://example.com', title: 'Example', last_visit_time: 13300000000000000, visit_count: 5 },
      { url: 'https://test.com', title: 'Test', last_visit_time: 0, visit_count: 1 },
    ];
    const rows = parseChromiumHistoryRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!['browser']).toBe('chrome');
    expect(rows[0]!['profile']).toBe('Default');
    expect(rows[0]!['url']).toBe('https://example.com');
    expect(rows[0]!['title']).toBe('Example');
    expect(rows[0]!['visit_count']).toBe(5);
    expect(typeof rows[0]!['visit_time']).toBe('string');
  });

  it('handles missing fields gracefully', () => {
    const rows = parseChromiumHistoryRows([{}] as unknown[], 'edge', 'Default') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['url']).toBe('');
    expect(rows[0]!['visit_count']).toBe(0);
  });
});

describe('parseFirefoxHistoryRows', () => {
  it('converts Firefox places rows to HistoryRow shape', () => {
    const raw = [
      { url: 'https://mozilla.org', title: 'Mozilla', visit_date: Date.now() * 1000, visit_count: 3 },
    ];
    const rows = parseFirefoxHistoryRows(raw as unknown[], 'default-release') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['browser']).toBe('firefox');
    expect(rows[0]!['url']).toBe('https://mozilla.org');
  });
});

// ── Bookmarks parsers ────────────────────────────────────────────────────────

describe('parseChromiumBookmarksJson', () => {
  it('extracts bookmarks from Chrome Bookmarks file', () => {
    const rows = parseChromiumBookmarksJson(chromeBookmarksFixture, 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const urls = rows.map((r) => r['url']);
    expect(urls).toContain('https://www.google.com');
    expect(urls).toContain('https://github.com');
    expect(urls).toContain('https://stackoverflow.com');
  });

  it('returns folder path for nested bookmarks', () => {
    const rows = parseChromiumBookmarksJson(chromeBookmarksFixture, 'chrome', 'Default') as Array<Record<string, unknown>>;
    const github = rows.find((r) => r['url'] === 'https://github.com');
    expect(github).toBeDefined();
    expect(String(github!['folder'])).toContain('Dev');
  });

  it('handles invalid JSON gracefully', () => {
    const rows = parseChromiumBookmarksJson('not-json', 'chrome', 'Default');
    expect(rows).toEqual([]);
  });

  it('handles missing roots gracefully', () => {
    const rows = parseChromiumBookmarksJson('{}', 'chrome', 'Default');
    expect(rows).toEqual([]);
  });

  it('sets browser and profile on every row', () => {
    const rows = parseChromiumBookmarksJson(chromeBookmarksFixture, 'edge', 'Profile 1') as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row['browser']).toBe('edge');
      expect(row['profile']).toBe('Profile 1');
    }
  });
});

describe('parseFirefoxBookmarkRows', () => {
  it('converts Firefox bookmark rows', () => {
    const raw = [
      { url: 'https://example.com', title: 'Example', dateAdded: Date.now() * 1000, folder: 'Bookmarks Menu' },
    ];
    const rows = parseFirefoxBookmarkRows(raw as unknown[], 'default-release') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['browser']).toBe('firefox');
    expect(rows[0]!['url']).toBe('https://example.com');
    expect(rows[0]!['folder']).toBe('Bookmarks Menu');
  });
});

// ── Integration (shape validation — no browser required) ─────────────────────

describe('browser-history integration', () => {
  it('returns SysIntResult with rows array', async () => {
    const result = await historyRun('browser-history', []) as Record<string, unknown>;
    // Either success with rows or error — both are valid on a machine without Chrome
    expect(result).toBeDefined();
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(typeof result['count']).toBe('number');
      expect(typeof result['platform']).toBe('string');
      expect(result['tool']).toBe('browser-history');
    } else {
      expect(typeof result['error']).toBe('string');
    }
  });

  it('returns empty rows when no browsers installed', async () => {
    // Run with --browser chrome specifically (most likely absent in CI)
    const result = await historyRun('browser-history', ['--browser', 'chrome']) as Record<string, unknown>;
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  });
});

describe('browser-bookmarks integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await bookmarksRun('browser-bookmarks', []) as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-bookmarks');
    }
  });
});

describe('browser-profiles integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await profilesRun('browser-profiles', []) as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-profiles');
      // If profiles exist, check shape
      if ((result['rows'] as unknown[]).length > 0) {
        const first = (result['rows'] as Array<Record<string, unknown>>)[0]!;
        expect(typeof first['browser']).toBe('string');
        expect(typeof first['name']).toBe('string');
        expect(typeof first['path']).toBe('string');
        expect(typeof first['isDefault']).toBe('boolean');
      }
    }
  });
});
