# Plan 02: Cookies + Downloads + Extensions + Autofill
**Phase 3 — BRW-03, BRW-04, BRW-05, BRW-06**

## Goal
Implement cookie reader, download history, extension listing, and autofill data across Chrome/Edge/Firefox.

## Steps

### Step 1: Implement cookies.ts (BRW-03)
- Chrome/Edge: query `Cookies` SQLite DB, table `cookies`
  - Fields: host_key, name, value (plaintext, DPAPI-encrypted value skipped — Phase 4), path, expires_utc, is_secure, is_httponly
  - Expires timestamp: WebKit epoch conversion
- Firefox: query `cookies.sqlite`, table `moz_cookies`
  - Fields: host, name, value, path, expiry (Unix seconds), isSecure, isHttpOnly
- Unified row: `{ browser, profile, domain, name, value, path, expiry, secure, httpOnly }`
- Note: Chrome cookie `value` column is plaintext for some cookies; encrypted_value is skipped (Phase 4 handles DPAPI)

### Step 2: Implement downloads.ts (BRW-04)
- Chrome/Edge: query `History` SQLite DB, table `downloads` joined with `downloads_url_chains`
  - Fields: current_path, target_path, total_bytes, start_time (WebKit epoch), state, tab_url
  - State codes: 0=in_progress, 1=complete, 2=cancelled, 3=interrupted
- Firefox: query `places.sqlite`, table `moz_annos` filtered for `downloads/` annotations + `moz_places`
  - Alternative: parse downloads.json if places approach is complex
- Unified row: `{ browser, profile, url, filename, path, size, start_time, state }`

### Step 3: Implement extensions.ts (BRW-05)
- Chrome/Edge: scan `Extensions/` directory in profile
  - Each subdirectory = extension ID
  - Read `manifest.json` from latest version subdirectory
  - Fields from manifest: name, version, description, permissions (array)
  - Enabled state: read `Preferences` JSON file, `extensions.settings[id].state` (1=enabled)
- Firefox: query `extensions.json` file in profile root (JSON, not SQLite)
  - Fields: id, name, version, active, permissions
- Unified row: `{ browser, profile, id, name, version, enabled, permissions, description }`

### Step 4: Implement autofill.ts (BRW-06)
- Chrome/Edge: query `Web Data` SQLite DB, table `autofill`
  - Fields: name, value, count, date_created, date_last_used (Unix seconds)
- Firefox: query `formhistory.sqlite`, table `moz_formhistory`
  - Fields: fieldname, value, timesUsed, lastUsed (Unix microseconds)
- Unified row: `{ browser, profile, name, value, count, last_used }`
- Args: `--field NAME` to filter by field name

### Step 5: Tests for Plan 02
File: `src/services/sysint/__tests__/browser-plan02.test.ts`
- Cookies: parser unit tests, integration shape test, missing DB → empty rows
- Downloads: parser unit tests, state code mapping, integration shape test
- Extensions: Chrome manifest.json parsing unit test (fixture), Firefox extensions.json parsing, integration shape
- Autofill: parser unit tests, integration shape test

### Fixtures needed
- `browser-chrome-downloads.json` — sample Chrome downloads table rows
- `browser-firefox-extensions.json` — sample Firefox extensions.json fragment
- `browser-chrome-manifest.json` — sample Chrome extension manifest.json

## Acceptance Criteria
- [ ] Cookies tool returns unified rows, missing browser → empty
- [ ] Downloads tool maps state codes correctly
- [ ] Extensions tool parses Chrome manifest and Firefox extensions.json
- [ ] Autofill tool returns name/value/count rows
- [ ] All BRW-03, BRW-04, BRW-05, BRW-06 tests pass
