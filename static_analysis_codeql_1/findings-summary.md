# CodeQL Static Analysis — Findings Summary

**Date:** 2026-03-09
**Project:** HakanMCP
**Total Findings:** 53

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| Error (High) | 4 |
| Warning / High Precision | 6 |
| Warning / Medium Precision | 43 |

---

## ERROR Severity (Critical — Fix Immediately)

### 1. Command Line Injection
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 1 | `js/command-line-injection` | `bin/hakanmcp.ts` | 1068 | Command line depends on user-provided values — potential RCE vulnerability |

### 2. Clear-Text Logging of Sensitive Data
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 2 | `js/clear-text-logging` | `scripts/doctor.ts` | 139 | Logs sensitive data from process environment as clear text |
| 3 | `js/clear-text-logging` | `scripts/quick_status.ts` | 34 | Logs sensitive data from process environment as clear text |
| 4 | `js/clear-text-logging` | `scripts/status_board.ts` | 101 | Logs sensitive data from process environment as clear text |

---

## WARNING Severity — High Precision

### 3. Incomplete URL Substring Sanitization
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 5 | `js/incomplete-url-substring-sanitization` | `tests/aiProviders.test.ts` | 113 | `anthropic.com` can appear anywhere in URL; arbitrary hosts may bypass check |
| 6 | `js/incomplete-url-substring-sanitization` | `tests/aiProviders.test.ts` | 116 | `openai.com` can appear anywhere in URL; arbitrary hosts may bypass check |

### 4. Incomplete String Sanitization
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 7 | `js/incomplete-sanitization` | `src/services/aiProviderCooldown.ts` | 1230 | Does not escape backslash characters in the input |
| 8 | `js/incomplete-sanitization` | `src/watch/triggerEngine.ts` | 16 | Does not escape backslash characters in the input |

### 5. Insufficient Password Hashing
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 9 | `js/insufficient-password-hash` | `src/utils/dbPoolManager.ts` | 448 | Password is hashed insecurely (weak algorithm or insufficient iterations) |
| 10 | `js/insufficient-password-hash` | `src/utils/dbPoolManager.ts` | 459 | Password is hashed insecurely (weak algorithm or insufficient iterations) |

---

## WARNING Severity — Medium Precision

### 6. Indirect Command Line Injection
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 11 | `js/indirect-command-line-injection` | `scripts/console_chat.ts` | 719 | Command depends on unsanitized environment variable |
| 12 | `js/indirect-command-line-injection` | `scripts/console_chat.ts` | 798 | Command depends on unsanitized environment variable |
| 13 | `js/indirect-command-line-injection` | `src/tools/github.ts` | 133 | Command depends on unsanitized environment variable |

### 7. File Data in Outbound Network Request
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 14 | `js/file-access-to-http` | `src/tools/aiProviders.ts` | 117 | Outbound network request depends on file data |
| 15 | `js/file-access-to-http` | `src/tools/aiProviders.ts` | 158 | Outbound network request depends on file data |
| 16 | `js/file-access-to-http` | `src/tools/aiProviders.ts` | 211 | Outbound network request depends on file data |
| 17 | `js/file-access-to-http` | `src/tools/postman.ts` | 384 | Outbound network request depends on file data |
| 18 | `js/file-access-to-http` | `src/tools/postman.ts` | 384 | Outbound network request depends on file data |
| 19 | `js/file-access-to-http` | `src/tools/postman.ts` | 384 | Outbound network request depends on file data |

### 8. File System Race Condition (TOCTOU)
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 20 | `js/file-system-race` | `bin/hakanmcp.ts` | 1903 | File may have changed since it was checked |
| 21 | `js/file-system-race` | `bin/hakanmcp.ts` | 1915 | File may have changed since it was checked |
| 22 | `js/file-system-race` | `scripts/cleanup_scheduler_state.ts` | 68 | File may have changed since it was checked |
| 23 | `js/file-system-race` | `src/cli/initCommand.ts` | 86 | File may have changed since it was checked |
| 24 | `js/file-system-race` | `src/cli/initCommand.ts` | 91 | File may have changed since it was checked |
| 25 | `js/file-system-race` | `src/cli/startCommand.ts` | 133 | File may have changed since it was checked |
| 26 | `js/file-system-race` | `src/mission/targetAnalyzer.ts` | 141 | File may have changed since it was checked |
| 27 | `js/file-system-race` | `src/services/aiRouteLogger.ts` | 50 | File may have changed since it was checked |
| 28 | `js/file-system-race` | `src/services/consciousnessService.ts` | 320 | File may have changed since it was checked |
| 29 | `js/file-system-race` | `src/tools/monitoring.ts` | 299 | File may have changed since it was checked |
| 30 | `js/file-system-race` | `src/tools/monitoring.ts` | 300 | File may have changed since it was checked |
| 31 | `js/file-system-race` | `src/tools/selfImprovement.ts` | 39 | File may have changed since it was checked |
| 32 | `js/file-system-race` | `src/tools/selfImprovement.ts` | 386 | File may have changed since it was checked |
| 33 | `js/file-system-race` | `src/tools/selfImprovement.ts` | 448 | File may have changed since it was checked |

### 9. Insecure Temporary File Creation
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 34 | `js/insecure-temporary-file` | `src/services/aiProviderCooldown.ts` | 155 | Insecure file creation in OS temp directory |
| 35 | `js/insecure-temporary-file` | `src/services/aiProviderCooldown.ts` | 248 | Insecure file creation in OS temp directory |
| 36 | `js/insecure-temporary-file` | `src/services/aiProviderCooldown.ts` | 397 | Insecure file creation in OS temp directory |
| 37 | `js/insecure-temporary-file` | `src/services/cacheService.ts` | 83 | Insecure file creation in OS temp directory |
| 38 | `js/insecure-temporary-file` | `src/utils/common.ts` | 66 | Insecure file creation in OS temp directory |
| 39 | `js/insecure-temporary-file` | `tests/common.test.ts` | 174 | Insecure file creation in OS temp directory |
| 40 | `js/insecure-temporary-file` | `tests/common.test.ts` | 191 | Insecure file creation in OS temp directory |
| 41 | `js/insecure-temporary-file` | `tests/console_chat.session.test.ts` | 32 | Insecure file creation in OS temp directory |
| 42 | `js/insecure-temporary-file` | `tests/env.test.ts` | 67 | Insecure file creation in OS temp directory |
| 43 | `js/insecure-temporary-file` | `tests/git.test.ts` | 24 | Insecure file creation in OS temp directory |
| 44 | `js/insecure-temporary-file` | `tests/git.test.ts` | 52 | Insecure file creation in OS temp directory |
| 45 | `js/insecure-temporary-file` | `tests/git.test.ts` | 81 | Insecure file creation in OS temp directory |
| 46 | `js/insecure-temporary-file` | `tests/git.test.ts` | 98 | Insecure file creation in OS temp directory |
| 47 | `js/insecure-temporary-file` | `tests/git.test.ts` | 133 | Insecure file creation in OS temp directory |
| 48 | `js/insecure-temporary-file` | `tests/git.test.ts` | 154 | Insecure file creation in OS temp directory |
| 49 | `js/insecure-temporary-file` | `tests/git.test.ts` | 180 | Insecure file creation in OS temp directory |
| 50 | `js/insecure-temporary-file` | `tests/git.test.ts` | 241 | Insecure file creation in OS temp directory |
| 51 | `js/insecure-temporary-file` | `tests/postman.test.ts` | 93 | Insecure file creation in OS temp directory |
| 52 | `js/insecure-temporary-file` | `tests/postman.test.ts` | 120 | Insecure file creation in OS temp directory |

### 10. Network Data Written to File
| # | Rule ID | File | Line | Description |
|---|---------|------|------|-------------|
| 53 | `js/http-to-file-access` | `src/services/consciousnessService.ts` | 175 | Write to file system depends on untrusted data from network |

---

## Top Priority Remediation

1. **`bin/hakanmcp.ts:1068`** — Command injection: sanitize/validate all user input before passing to shell commands. Use `execFile` instead of `exec`, or use parameterized arguments.
2. **`scripts/doctor.ts:139`, `scripts/quick_status.ts:34`, `scripts/status_board.ts:101`** — Clear-text logging: filter sensitive environment variables (API keys, tokens) before logging.
3. **`src/utils/dbPoolManager.ts:448,459`** — Weak password hashing: use bcrypt/scrypt/argon2 with sufficient rounds instead of MD5/SHA.
4. **`src/services/consciousnessService.ts:175`** — Untrusted network data written to filesystem: validate and sanitize before writing.

---

## Affected Files Summary

| File | Finding Count |
|------|--------------|
| `tests/git.test.ts` | 8 |
| `src/tools/postman.ts` | 3 |
| `src/services/aiProviderCooldown.ts` | 4 |
| `src/tools/selfImprovement.ts` | 3 |
| `src/tools/aiProviders.ts` | 3 |
| `bin/hakanmcp.ts` | 3 |
| `tests/postman.test.ts` | 2 |
| `tests/common.test.ts` | 2 |
| `src/utils/dbPoolManager.ts` | 2 |
| `src/tools/monitoring.ts` | 2 |
| `src/cli/initCommand.ts` | 2 |
| `scripts/console_chat.ts` | 2 |
| `tests/aiProviders.test.ts` | 2 |
| Other files (1 each) | 15 |
