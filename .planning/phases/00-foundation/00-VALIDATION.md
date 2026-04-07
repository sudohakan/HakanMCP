---
phase: 0
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (ts-jest/presets/default-esm) |
| **Config file** | `jest.config.cjs` (existing) |
| **Quick run command** | `npm test -- --testPathPattern=sysint --verbose` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=sysint --verbose`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 0-01-01 | 01 | 1 | FND-01 | unit | `npx vitest run src/services/sysint/platforms/` | ❌ W0 | ⬜ pending |
| 0-01-02 | 01 | 1 | FND-02 | unit | `npx vitest run src/services/sysint/catalog/` | ❌ W0 | ⬜ pending |
| 0-02-01 | 02 | 1 | FND-03 | unit | `npx vitest run src/services/sysint/outputFormatter` | ❌ W0 | ⬜ pending |
| 0-02-02 | 02 | 1 | FND-05 | unit | `npx vitest run src/services/sysint/privilegeHelper` | ❌ W0 | ⬜ pending |
| 0-02-03 | 02 | 1 | FND-06 | unit | `npx vitest run src/services/sysint/pathHelper` | ❌ W0 | ⬜ pending |
| 0-03-01 | 03 | 2 | FND-04 | unit | `npx vitest run src/tools/sysint` | ❌ W0 | ⬜ pending |
| 0-03-02 | 03 | 2 | FND-07 | unit | `npx vitest run src/services/sysint/dispatcher` | ❌ W0 | ⬜ pending |
| 0-03-03 | 03 | 2 | FND-08 | integration | `npx vitest run src/services/sysint/dispatcher` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/sysint/__tests__/platforms.test.ts` — platform detection, getPlatform(), _resetPlatform()
- [ ] `src/services/sysint/__tests__/catalog.test.ts` — loadSysIntCatalog(), tool lookup
- [ ] `src/services/sysint/__tests__/outputFormatter.test.ts` — buildSuccess, buildError, toCSV, platform='wsl' case
- [ ] `src/services/sysint/__tests__/privilegeHelper.test.ts` — requirePrivilege fail-fast, requirePlatform
- [ ] `src/services/sysint/__tests__/pathHelper.test.ts` — toWSLPath, normalizePath, WSL↔Windows conversions
- [ ] `src/tools/__tests__/sysint.test.ts` — list/info/run actions, arg validation, error codes
- [ ] `src/services/sysint/__tests__/dispatcher.test.ts` — native-first + fallback logic
- [ ] `data/sysint/catalog.json` — 250 tool definitions (needed for integration tests)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WSL path converts correctly on live WSL | FND-06 | Requires live WSL environment with wslpath binary | Run `toWindowsPath('/mnt/c/Users/test')` in WSL, verify result is `C:\Users\test` |
| Windows admin detection correct | FND-05 | Requires Windows runtime, can't mock PowerShell reliably | Run `getPrivilegeLevel()` as admin and non-admin user, verify returns 'admin'/'user' |
| sysint registered via MCP | FND-04 | Requires running MCP server | Connect Claude to MCP, call `sysint list`, verify 250 tools returned |
| Catalog startup cost < 200ms | FND-07 | Performance measurement, environment-dependent | `time node -e "require('./dist/tools/sysint.js')"` should complete < 200ms |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
