# Phase 3: Browser - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

10 native cross-platform browser artifact tools (BRW-01..10). Read browser data (history, bookmarks, cookies, downloads, extensions, autofill, cache, search, profiles, form data) from Chrome, Firefox, and Edge in unified JSON format.

</domain>

<decisions>
## Implementation Decisions

### Browser data access
- Chrome/Edge: SQLite databases in user profile directory (History, Cookies, Web Data, Bookmarks JSON)
- Firefox: SQLite databases in profile directory (places.sqlite, cookies.sqlite, formhistory.sqlite)
- Use `better-sqlite3` for SQLite access (already in research recommendation)
- CRITICAL: Always copy DB to temp before reading — browser holds WAL locks while running
- Copy -wal and -shm files alongside the main DB for consistency

### Profile discovery
- Chrome: Windows `%LOCALAPPDATA%/Google/Chrome/User Data/`, Linux `~/.config/google-chrome/`
- Edge: Windows `%LOCALAPPDATA%/Microsoft/Edge/User Data/`, Linux `~/.config/microsoft-edge/`
- Firefox: Windows `%APPDATA%/Mozilla/Firefox/Profiles/`, Linux `~/.mozilla/firefox/`
- Profile listing: scan profile directories, return name + path + browser type
- Multi-profile support: default to first profile, accept profile parameter

### Unified output format
- History: `{ browser, url, title, visit_time, visit_count }`
- Bookmarks: `{ browser, url, title, folder, date_added }`
- Cookies: `{ browser, domain, name, value, path, expiry, secure, httpOnly }`
- Downloads: `{ browser, url, filename, path, size, start_time, state }`
- Extensions: `{ browser, name, version, enabled, permissions, id }`
- Autofill: `{ browser, name, value, count, last_used }`
- Cache: `{ browser, url, content_type, size, last_accessed }` (metadata only, not content)
- Search: `{ browser, query, timestamp, engine }`
- Form data: `{ browser, field_name, value, count }`

### Error handling
- Browser not installed: return empty rows array (not error) with `note: "browser not installed"`
- DB locked (copy failed): retry once, then return error
- Corrupt DB: return partial results with warning

### Claude's Discretion
- Exact SQLite query structure
- Temp file cleanup timing
- Chrome timestamp epoch conversion (WebKit epoch: 1601-01-01)
- Firefox timestamp epoch conversion (microseconds since Unix epoch)

</decisions>

<specifics>
## Specific Ideas

- Multi-browser aggregation is the key differentiator — single call returns unified data from all installed browsers
- Chrome/Edge share Chromium codebase so DB schema is nearly identical — share parsing logic
- Bookmarks in Chrome/Edge are JSON files, not SQLite — different parsing path
- Extensions in Chrome/Edge: parse manifest.json from extension directories

</specifics>

<deferred>
## Deferred Ideas

- Cookie decryption (DPAPI on Windows) — Phase 4 handles credentials
- Session restore data — v2 requirement
- IndexedDB reading — v2 requirement

</deferred>

---

*Phase: 03-browser*
*Context gathered: 2026-04-07*
