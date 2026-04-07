/**
 * Browser Phase 3 integration tests — BRW-07, BRW-08, BRW-10 + full suite
 * Tests all 10 browser tools via dispatcher route.
 */

// ── Imports ──────────────────────────────────────────────────────────────────

let parseChromiumSearchRows: (rows: unknown[], browser: string, profile: string) => unknown[];
let parseFirefoxSearchRows: (rows: unknown[], profile: string) => unknown[];
let searchRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parseChromiumProfileRows: (rows: unknown[], browser: string, profile: string) => unknown[];
let parseChromiumCreditCardRows: (rows: unknown[], browser: string, profile: string) => unknown[];
let parseFirefoxFormRows: (rows: unknown[], profile: string) => unknown[];
let formsRun: (toolId: string, args?: string[]) => Promise<unknown>;

let cacheRun: (toolId: string, args?: string[]) => Promise<unknown>;

let browserIndexRun: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const searchMod = await import('../tools/browser/search.js');
  parseChromiumSearchRows = searchMod.parseChromiumSearchRows as unknown as typeof parseChromiumSearchRows;
  parseFirefoxSearchRows = searchMod.parseFirefoxSearchRows as unknown as typeof parseFirefoxSearchRows;
  searchRun = searchMod.run as unknown as typeof searchRun;

  const formsMod = await import('../tools/browser/forms.js');
  parseChromiumProfileRows = formsMod.parseChromiumProfileRows as unknown as typeof parseChromiumProfileRows;
  parseChromiumCreditCardRows = formsMod.parseChromiumCreditCardRows as unknown as typeof parseChromiumCreditCardRows;
  parseFirefoxFormRows = formsMod.parseFirefoxFormRows as unknown as typeof parseFirefoxFormRows;
  formsRun = formsMod.run as unknown as typeof formsRun;

  const cacheMod = await import('../tools/browser/cache.js');
  cacheRun = cacheMod.run as unknown as typeof cacheRun;

  const indexMod = await import('../tools/browser/index.js');
  browserIndexRun = indexMod.run as unknown as typeof browserIndexRun;
});

// ── Search history parsers ───────────────────────────────────────────────────

describe('parseChromiumSearchRows', () => {
  it('extracts query and detects search engine', () => {
    const raw = [
      { term: 'typescript generics', url: 'https://www.google.com/search?q=typescript', last_visit_time: 13300000000000000 },
      { term: 'nodejs docs', url: 'https://www.bing.com/search?q=nodejs', last_visit_time: 13300000000100000 },
    ];
    const rows = parseChromiumSearchRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!['query']).toBe('typescript generics');
    expect(rows[0]!['engine']).toBe('google');
    expect(rows[1]!['engine']).toBe('bing');
    expect(rows[0]!['browser']).toBe('chrome');
  });

  it('handles unknown URL domains', () => {
    const raw = [{ term: 'test', url: 'not-a-url', last_visit_time: 0 }];
    const rows = parseChromiumSearchRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows[0]!['engine']).toBe('unknown');
  });
});

describe('parseFirefoxSearchRows', () => {
  it('maps Firefox input history rows', () => {
    const raw = [
      { input: 'duckduckgo privacy', url: 'https://duckduckgo.com/?q=privacy', last_visit_date: Date.now() * 1000 },
    ];
    const rows = parseFirefoxSearchRows(raw as unknown[], 'default-release') as Array<Record<string, unknown>>;
    expect(rows[0]!['query']).toBe('duckduckgo privacy');
    expect(rows[0]!['engine']).toBe('duckduckgo');
    expect(rows[0]!['browser']).toBe('firefox');
  });
});

// ── Forms parsers ────────────────────────────────────────────────────────────

describe('parseChromiumProfileRows', () => {
  it('extracts non-empty address fields', () => {
    const raw = [
      {
        full_name: 'John Doe',
        company_name: 'Acme Corp',
        street_address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zipcode: '62701',
        country_code: 'US',
      },
    ];
    const rows = parseChromiumProfileRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const fieldNames = rows.map((r) => r['field_name']);
    expect(fieldNames).toContain('full_name');
    expect(fieldNames).toContain('city');
  });

  it('skips empty fields', () => {
    const raw = [{ full_name: 'Alice', company_name: '', city: '' }];
    const rows = parseChromiumProfileRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    const fieldNames = rows.map((r) => r['field_name']);
    expect(fieldNames).toContain('full_name');
    expect(fieldNames).not.toContain('company_name');
  });
});

describe('parseChromiumCreditCardRows', () => {
  it('extracts non-sensitive card fields only', () => {
    const raw = [
      { name_on_card: 'JOHN DOE', last_four: '4242', expiration_month: '12', expiration_year: '2027' },
    ];
    const rows = parseChromiumCreditCardRows(raw as unknown[], 'chrome', 'Default') as Array<Record<string, unknown>>;
    const fieldNames = rows.map((r) => r['field_name']);
    expect(fieldNames).toContain('card_last4');
    expect(fieldNames).toContain('card_holder');
    expect(fieldNames).toContain('card_expiry');
    // No full PAN
    for (const r of rows) {
      expect(r['field_name']).not.toBe('full_card_number');
    }
  });
});

describe('parseFirefoxFormRows', () => {
  it('filters for address-like fields', () => {
    const raw = [
      { fieldname: 'email', value: 'user@example.com', timesUsed: 5 },
      { fieldname: 'searchterm', value: 'typescript', timesUsed: 10 },
      { fieldname: 'firstname', value: 'Jane', timesUsed: 3 },
    ];
    const rows = parseFirefoxFormRows(raw as unknown[], 'default-release') as Array<Record<string, unknown>>;
    const fieldNames = rows.map((r) => r['field_name']);
    expect(fieldNames).toContain('email');
    expect(fieldNames).toContain('firstname');
    // 'searchterm' should be filtered out as it doesn't match address patterns
    expect(fieldNames).not.toContain('searchterm');
  });
});

// ── Browser index dispatcher tests ───────────────────────────────────────────

const ALL_BROWSER_TOOLS = [
  'browser-history',
  'browser-bookmarks',
  'browser-cookies',
  'browser-downloads',
  'browser-extensions',
  'browser-autofill',
  'browser-cache',
  'browser-search-history',
  'browser-profiles',
  'browser-forms',
];

describe('browser index dispatcher', () => {
  it.each(ALL_BROWSER_TOOLS)('%s: routes through index and returns SysIntResult', async (toolId) => {
    const result = await browserIndexRun(toolId, []) as Record<string, unknown>;
    expect(result).toBeDefined();
    // Must be either SysIntSuccess or SysIntError — never throw
    const isSuccess = 'rows' in result && 'tool' in result;
    const isError = 'error' in result && 'code' in result;
    expect(isSuccess || isError).toBe(true);
    if (isSuccess) {
      expect(result['tool']).toBe(toolId);
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(typeof result['count']).toBe('number');
      expect(typeof result['timestamp']).toBe('string');
      expect(typeof result['platform']).toBe('string');
    }
  });

  it('returns EXEC_FAILED for unknown tool', async () => {
    const result = await browserIndexRun('browser-nonexistent', []) as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });
});

// ── Integration: cache and search ────────────────────────────────────────────

describe('browser-cache integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await cacheRun('browser-cache', []) as Record<string, unknown>;
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-cache');
      // Validate row shape if any rows returned
      if ((result['rows'] as unknown[]).length > 0) {
        const first = (result['rows'] as Array<Record<string, unknown>>)[0]!;
        expect(typeof first['browser']).toBe('string');
        expect(typeof first['size']).toBe('number');
        expect(typeof first['last_accessed']).toBe('string');
      }
    }
  });
});

describe('browser-search-history integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await searchRun('browser-search-history', []) as Record<string, unknown>;
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-search-history');
    }
  });
});

describe('browser-forms integration', () => {
  it('returns SysIntResult shape', async () => {
    const result = await formsRun('browser-forms', []) as Record<string, unknown>;
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
      expect(result['tool']).toBe('browser-forms');
    }
  });
});

// ── WAL lock safety: missing DB returns empty rows ────────────────────────────

describe('WAL lock safety', () => {
  it('browser-history with non-existent browser returns empty rows not crash', async () => {
    // Force a specific browser that almost certainly has no profile in CI
    const result = await browserIndexRun('browser-history', ['--browser', 'edge']) as Record<string, unknown>;
    // Must not throw — either empty success or error shape
    expect(result).toBeDefined();
    if ('rows' in result) {
      expect(Array.isArray(result['rows'])).toBe(true);
    } else {
      expect(typeof result['error']).toBe('string');
    }
  });
});
