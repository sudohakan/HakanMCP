# Plan 03: Cache + Search + Form Data + Integration Tests
**Phase 3 — BRW-07, BRW-08, BRW-10**

## Goal
Implement cache metadata viewer, last search queries, saved form data, and write the full integration test suite.

## Steps

### Step 1: Implement cache.ts (BRW-07)
- Chrome/Edge: cache stored in `Cache/Cache_Data/` (LRU cache format, not SQLite)
  - Use `index` file directory listing approach — list files, stat for size/mtime
  - Metadata only: no content reading
  - Return file entries with estimated URL if derivable from filename
  - Fallback: scan `Cache/` directory, return file metadata rows
- Firefox: cache stored in `cache2/entries/` directory
  - Each file is an entry; filename = hash
  - Stat files for size/mtime metadata
- Unified row: `{ browser, profile, url, content_type, size, last_accessed }`
  - URL/content_type may be `unknown` for binary cache formats
- Note: Cache metadata only — do not read file contents

### Step 2: Implement search.ts (BRW-08)
- Chrome/Edge: query `History` SQLite DB, table `keyword_search_terms` joined with `urls`
  - Fields: url, term, last_visit_time (WebKit epoch)
  - Engine detection from url domain
- Firefox: query `places.sqlite`, table `moz_inputhistory` joined with `moz_places`
  - Fields: input (search term), place_id, use_count
  - Alternative: parse moz_annos for search annotations
- Unified row: `{ browser, profile, query, timestamp, engine, url }`
- Args: `--limit N` (default 50)

### Step 3: Implement forms.ts (BRW-10)
- Chrome/Edge: query `Web Data` SQLite DB, table `autofill_profile` and `autofill_profile_names` / `autofill_profile_emails` / `autofill_profile_phones`
  - Fields: full_name, email, phone, company, address, city, state, zip, country
  - Also query `credit_cards` table for non-sensitive fields (last4, name, expiry month/year)
- Firefox: query `formhistory.sqlite`, same as autofill but filtered for address fields
- Unified row: `{ browser, profile, field_name, value, count }`
- Credit card row: `{ browser, profile, field_name: 'card_last4', value, count: null }`

### Step 4: Update index.ts with all 10 tools
Add all remaining tools to MODULE_MAP in `browser/index.ts`:
- `browser-cache` → cacheRun
- `browser-search-history` → searchRun
- `browser-forms` → formsRun

### Step 5: Integration test suite
File: `src/services/sysint/__tests__/browser-integration.test.ts`
- All 10 BRW tools callable via dispatcher `runTool()`
- Each returns `SysIntSuccess` shape (has `rows`, `count`, `timestamp`, `platform`, `tool`)
- Non-installed browsers return empty rows, not errors
- DB WAL lock safety: tool survives when browser is "open" (simulate with locked file)
- Dispatcher route: `run('browser-history')` → MODULE_MAP → history.ts → SysIntResult
- Cross-browser aggregation: `--browser all` returns rows from all installed browsers

### Step 6: Final verification
- Run `npx jest --testPathPatterns='browser' --no-coverage`
- Run `npx jest --testPathPatterns='sysint' --no-coverage` for full suite
- Check no TypeScript errors: `npx tsc --noEmit`

## Acceptance Criteria
- [ ] Cache tool returns file metadata rows (not content)
- [ ] Search tool returns query + engine rows
- [ ] Forms tool returns address/card field rows
- [ ] All 10 BRW tools in MODULE_MAP
- [ ] Integration test: all 10 tools return SysIntSuccess shape
- [ ] All BRW-07, BRW-08, BRW-10 tests pass
- [ ] Full sysint test suite passes
