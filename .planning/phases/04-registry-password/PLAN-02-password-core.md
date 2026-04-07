# Plan 02: Password Tools Core (PWD-01..05)

**Phase:** 04-registry-password
**Requirements:** PWD-01, PWD-02, PWD-03, PWD-04, PWD-05
**Depends on:** PLAN-01 (registry/shared.ts PowerShell helper reused)

## Files to Create

```
src/services/sysint/tools/password/
  shared.ts          — temp file helper (chmod 600), audit logger, platform guards
  chrome.ts          — PWD-01: browser-chrome-passwords (Windows DPAPI)
  firefox.ts         — PWD-02: browser-firefox-passwords (NSS, cross-platform)
  wifi.ts            — PWD-03: wifi-passwords (netsh + NetworkManager)
  credman.ts         — PWD-04: credential-manager (Windows Credential Manager)
  vault.ts           — PWD-05: windows-vault (Web Credentials)
  index.ts           — category dispatcher

src/services/sysint/tools/password.ts  — shim: re-exports run from ./password/index.js

src/services/sysint/__tests__/password-plan02.test.ts
```

## Catalog Entries to Add

5 new entries in `data/sysint/catalog.json` — category: "password", native: true:

| id | platforms | adminRequired |
|----|-----------|--------------|
| browser-chrome-passwords | ["win32","wsl"] | false |
| browser-firefox-passwords | ["win32","linux","wsl"] | false |
| wifi-passwords | ["win32","linux","wsl"] | false |
| credential-manager | ["win32","wsl"] | false |
| windows-vault | ["win32","wsl"] | false |

## Security Measures (all tools)

- Never pass credentials via CLI args (`ps aux` visibility)
- Temp files: `writeTempSecure(data)` → writes to `/tmp/sysint-XXXXXX`, chmod 600, returns path + cleanup()
- Audit log: `logCredentialAccess(toolId, platform)` → append to `~/.sysint-audit.log`
- All tools require `--allow-credentials` flag OR return consent warning row
- Sensitive output rows: mark with `_sensitive: true` for caller filtering

## Implementation Notes

### shared.ts
- `writeTempSecure(content: string)`: mkstemp equivalent, chmod 0o600, returns { path, cleanup }
- `logCredentialAccess(toolId: string)`: append JSON line to audit log
- `requireCredentialConsent(args: string[], toolId: string)`: check for `--allow-credentials` flag
- `WINDOWS_ONLY_TOOLS` and `assertWindowsOrLinux(toolId, platforms)` guards

### PWD-01: browser-chrome-passwords (Windows-only)
- Read `%LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\Login Data` (SQLite)
- Copy to temp (WAL-safe, same as browser phase)
- Encrypted_value column: PowerShell `[System.Security.Cryptography.ProtectedData]::Unprotect()`
  - Write encrypted bytes to temp file, PowerShell reads and decrypts, writes result to another temp file
  - Never pipe credentials through stdout
- Output row: `{ browser, profile, url, username, _sensitive: true, password: '...' }`
- Linux: PLATFORM_UNSUPPORTED

### PWD-02: browser-firefox-passwords (cross-platform — crown jewel)
- Profiles: `~/.mozilla/firefox` (Linux) or `%APPDATA%\Mozilla\Firefox\Profiles` (Windows)
- `key4.db`: NSS key database (SQLite)
- `logins.json`: encrypted credentials
- Approach: child_process calling `python3 -c` with inline script OR direct JS crypto
  - key4.db uses password-based encryption (master password or empty)
  - With empty master password: PBKDF2/SHA1 → DES3 decryption — pure JS via Node.js crypto
- Output row: `{ profile, url, username, _sensitive: true, password: '...' }`
- Empty master password only — skip profiles with non-empty master password (return warning row)

### PWD-03: wifi-passwords (cross-platform)
- Windows: `netsh wlan show profiles` → list SSIDs, then `netsh wlan show profile name=X key=clear`
  - Parse "Key Content" line from output
- Linux: read `/etc/NetworkManager/system-connections/*.nmconnection` (INI format, requires root)
         fallback: `/etc/wpa_supplicant/wpa_supplicant.conf` (psk= values)
- Output row: `{ ssid, security, _sensitive: true, password: '...' }`

### PWD-04: credential-manager (Windows-only)
- `cmdkey /list` for enumeration
- PowerShell CredentialManager for value retrieval:
  ```powershell
  [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
  ```
- Output row: `{ target, type, user, _sensitive: true, credential: '...' }`
- Linux: PLATFORM_UNSUPPORTED

### PWD-05: windows-vault (Windows-only)
- Web Credentials vault: `vaultcmd /listcreds:"Web Credentials"`
- PowerShell fallback for decryption
- Output row: `{ resource, username, _sensitive: true, password: '...' }`
- Linux: PLATFORM_UNSUPPORTED

## Test Plan

All tests run on Linux without real credentials.

- `requireCredentialConsent`: returns warning without `--allow-credentials`
- `writeTempSecure`: creates file with 0o600 permissions
- Chrome parser: unit test with mock SQLite row (encrypted_value = Buffer)
- Firefox key4.db decoder: unit test with known plaintext → encrypted → decrypted cycle
- Firefox logins.json parser: unit test with mock JSON structure
- Wi-Fi Windows parser: unit test with known `netsh` output string
- Wi-Fi Linux parser: unit test with mock `.nmconnection` file content
- Platform guards: chrome-passwords, credential-manager, vault return PLATFORM_UNSUPPORTED on Linux
- Firefox passwords: returns rows (empty, no Firefox installed) on Linux without crashing

## Success Criteria

1. `--allow-credentials` consent mechanism works
2. Firefox decoder tested with mock NSS-encrypted data
3. Wi-Fi parser handles both Windows netsh and Linux NM formats
4. Windows-only tools return PLATFORM_UNSUPPORTED on Linux
5. No credentials appear in process arguments (verified by test)
6. Tests pass: `npx jest password-plan02`
