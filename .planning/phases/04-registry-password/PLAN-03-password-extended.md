# Plan 03: Password Tools Extended + Integration (PWD-06..10)

**Phase:** 04-registry-password
**Requirements:** PWD-06, PWD-07, PWD-08, PWD-09, PWD-10
**Depends on:** PLAN-02 (password/shared.ts, consent mechanism)

## Files to Create

```
src/services/sysint/tools/password/
  rdp.ts             — PWD-06: rdp-credentials
  vnc.ts             — PWD-07: vnc-passwords
  mail.ts            — PWD-08: mail-passwords
  lsa.ts             — PWD-09: lsa-secrets (admin required)
  network-creds.ts   — PWD-10: network-passwords (admin required)

src/services/sysint/__tests__/password-plan03.test.ts
```

## Catalog Entries to Add

5 new entries in `data/sysint/catalog.json` — category: "password", native: true:

| id | platforms | adminRequired |
|----|-----------|--------------|
| rdp-credentials | ["win32","wsl"] | false |
| vnc-passwords | ["win32","linux","wsl"] | false |
| mail-passwords | ["win32","linux","wsl"] | false |
| lsa-secrets | ["win32","wsl"] | true |
| network-passwords | ["win32","wsl"] | true |

## Implementation Notes

### PWD-06: rdp-credentials (Windows-only)
- Registry path: `HKCU\SOFTWARE\Microsoft\Terminal Server Client\Servers`
- Each subkey = hostname, `UsernameHint` value = saved username
- Saved passwords via DPAPI in Windows Credential Manager (target: `TERMSRV/hostname`)
  - Same PowerShell DPAPI approach as PWD-01
- Output row: `{ host, username, _sensitive: true, hasPassword: boolean }`
- Note: actual password decryption requires same-user context

### PWD-07: vnc-passwords (cross-platform)
- Known VNC password file locations:
  - Windows: `%APPDATA%\RealVNC\VNC Server\config.d\Server.ini`, `%APPDATA%\TightVNC\tvnserver.ini`
  - Linux: `~/.vnc/passwd`, `/etc/vnc/config.d/*.conf`
- VNC password DES decryption: fixed key `[0xE8, 0x4A, 0xD6, 0x60, 0xC4, 0x72, 0x1A, 0xE0]`
  - Bit-reversal on key bytes + DES ECB mode — use Node.js `crypto.createDecipheriv('des-ecb', ...)`
  - This is a well-documented, publicly known "encryption" scheme
- Output row: `{ app, configFile, _sensitive: true, password: '...' }`

### PWD-08: mail-passwords (cross-platform)
- Thunderbird: same NSS approach as Firefox (PWD-02) — reuse `decodeFirefoxLogins()`
  - Profiles: `%APPDATA%\Thunderbird\Profiles` (Windows) / `~/.thunderbird` (Linux)
- Outlook: credentials stored in Windows Credential Manager
  - Reuse credential-manager approach (PWD-04)
  - Filter for targets starting with `MicrosoftOffice16_Data:*`
- Output row: `{ client, profile, server, username, _sensitive: true, password: '...' }`

### PWD-09: lsa-secrets (Windows-only, admin)
- Approach: PowerShell + `reg save HKLM\SECURITY\Policy\Secrets <tempfile>` (admin required)
- Parse binary SECURITY hive for well-known secret names (DPAPI_SYSTEM, NL$KM, etc.)
- LSA secret values are AES-256 encrypted — decryption requires SYSTEM key from SYSTEM hive
- Implementation: enumerate secret names only if full decryption not possible without SYSTEM context
- Output row: `{ secretName, encrypted: true, hint: '...' }`
- Admin guard via privilegeHelper.requirePrivilege
- Linux: PLATFORM_UNSUPPORTED

### PWD-10: network-passwords (Windows-only, admin)
- `cmdkey /list` filtered for `Domain Password`, `Generic`, network credential types
- PowerShell: `[System.Net.NetworkCredential]::new('', $cred.Password).Password`
- Output row: `{ target, credentialType, user, _sensitive: true, password: '...' }`
- Admin guard via privilegeHelper.requirePrivilege
- Linux: PLATFORM_UNSUPPORTED

## Integration: Complete password/index.ts

Update `password/index.ts` to dispatch all 10 PWD tool IDs:

```typescript
const MODULE_MAP = {
  'browser-chrome-passwords': chromeRun,
  'browser-firefox-passwords': firefoxRun,
  'wifi-passwords': wifiRun,
  'credential-manager': credmanRun,
  'windows-vault': vaultRun,
  'rdp-credentials': rdpRun,
  'vnc-passwords': vncRun,
  'mail-passwords': mailRun,
  'lsa-secrets': lsaRun,
  'network-passwords': networkCredsRun,
};
```

## Test Plan

- VNC DES decryption: unit test with known VNC password bytes → expected plaintext
- Thunderbird: reuse Firefox NSS mock — same decodeFirefoxLogins() function
- Outlook: mock cmdkey output with `MicrosoftOffice16_Data:` prefix entries
- LSA: platform guard returns PLATFORM_UNSUPPORTED on Linux
- Network-passwords: platform guard returns PLATFORM_UNSUPPORTED on Linux
- Admin guard: lsa-secrets and network-passwords return PRIVILEGE_REQUIRED when not admin
- index.ts: all 10 tool IDs dispatch to correct handler (no EXEC_FAILED for unknown tool)

## Phase 4 Integration Verification

After PLAN-03 complete, run full phase verification:

1. Catalog has all 18 new tools (8 registry + 10 password) with native: true
2. All Windows-only tools return PLATFORM_UNSUPPORTED on Linux
3. Consent mechanism works for all password tools
4. VNC DES decryption produces correct output
5. Firefox/Thunderbird NSS decoder works with mock data
6. `npx jest registry-plan01 password-plan02 password-plan03` — all pass

## Success Criteria

1. All 10 PWD tools have catalog entries and working dispatchers
2. VNC DES decryption correct (unit tested with known fixture)
3. Thunderbird reuses Firefox NSS decoder (no code duplication)
4. Admin-required tools fail fast with PRIVILEGE_REQUIRED
5. Tests pass: `npx jest password-plan03`
