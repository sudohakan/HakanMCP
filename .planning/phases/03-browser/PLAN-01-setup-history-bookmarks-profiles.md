# Plan 01: Setup + Profile Discovery + History + Bookmarks
**Phase 3 — BRW-01, BRW-02, BRW-09**

## Goal
Install better-sqlite3, add native browser tool IDs to catalog.json, implement browser profile discovery, browsing history, and bookmarks across Chrome/Edge/Firefox.

## Steps

### Step 1: Install better-sqlite3
- `npm install better-sqlite3 @types/better-sqlite3`
- Verify it appears in package.json dependencies

### Step 2: Add native tool IDs to catalog.json
Add the following entries with `"native": true` to catalog.json under browser category:
- `browser-history` — BRW-01
- `browser-bookmarks` — BRW-02
- `browser-cookies` — BRW-03
- `browser-downloads` — BRW-04
- `browser-extensions` — BRW-05
- `browser-autofill` — BRW-06
- `browser-cache` — BRW-07
- `browser-search-history` — BRW-08
- `browser-profiles` — BRW-09
- `browser-forms` — BRW-10

### Step 3: Create shim and directory structure
- `src/services/sysint/tools/browser.ts` — shim (re-exports run from ./browser/index.js)
- `src/services/sysint/tools/browser/` directory with:
  - `shared.ts` — shared utilities (buildSuccess, buildError, getPlatformName, profileFinder, dbCopy)
  - `index.ts` — dispatcher (MODULE_MAP)
  - `profiles.ts` — BRW-09
  - `history.ts` — BRW-01
  - `bookmarks.ts` — BRW-02

### Step 4: Implement shared.ts
- `ProfileInfo` type: `{ browser, name, path, isDefault }`
- `findBrowserProfiles(browser)` — scans profile directories for Chrome/Edge/Firefox on Windows/Linux
- `copyDbToTemp(srcPath)` — copies .db + -wal + -shm to os.tmpdir(), returns temp path
- `cleanupTemp(tempPath)` — removes temp files after use
- Browser paths per platform (use env vars: LOCALAPPDATA, APPDATA, HOME)

### Step 5: Implement profiles.ts (BRW-09)
- For each browser (chrome, edge, firefox): find profiles directory, list sub-directories
- Return rows: `{ browser, name, path, isDefault }`
- Missing browser directory → empty rows (not error)

### Step 6: Implement history.ts (BRW-01)
- Chrome/Edge: query `History` SQLite DB, table `urls` joined with `visits`
  - Timestamp conversion: WebKit epoch (microseconds since 1601-01-01) → Unix ms
  - Formula: `(webkit_ts / 1000) - 11644473600000` → Date
- Firefox: query `places.sqlite`, table `moz_places` joined with `moz_historyvisits`
  - Timestamp: microseconds since Unix epoch → Date
- Unified row: `{ browser, profile, url, title, visit_time, visit_count }`
- Args: `--limit N` (default 100), `--browser chrome|firefox|edge|all`
- Copy DB to temp before opening (WAL lock safety)

### Step 7: Implement bookmarks.ts (BRW-02)
- Chrome/Edge: parse `Bookmarks` JSON file (not SQLite)
  - Traverse `roots.bookmark_bar.children`, `roots.other.children`, `roots.synced.children`
  - WebKit timestamp conversion for `date_added`
- Firefox: query `places.sqlite`, table `moz_bookmarks` joined with `moz_places`
- Unified row: `{ browser, profile, url, title, folder, date_added }`

### Step 8: Tests for Plan 01
File: `src/services/sysint/__tests__/browser-plan01.test.ts`
- Parser unit tests with fixture data
- Profile discovery integration test (shape only)
- History integration test (returns array)
- Bookmarks integration test (returns array)
- Browser not installed → empty rows
- DB locked (file doesn't exist) → empty rows not crash

## Acceptance Criteria
- [ ] better-sqlite3 in package.json
- [ ] 10 native tool IDs in catalog.json
- [ ] browser.ts shim exists
- [ ] profiles, history, bookmarks tools return valid SysIntResult
- [ ] All BRW-01, BRW-02, BRW-09 tests pass
