# Plan 01: Registry Tools (REG-01..08)

**Phase:** 04-registry-password
**Requirements:** REG-01, REG-02, REG-03, REG-04, REG-05, REG-06, REG-07, REG-08
**Platform:** Windows-only (win32/wsl). Linux returns PLATFORM_UNSUPPORTED.

## Files to Create

```
src/services/sysint/tools/registry/
  shared.ts          — winreg wrapper, platform guard, PowerShell exec helper
  search.ts          — REG-01: registry-search
  snapshot.ts        — REG-02: registry-snapshot-diff
  hive.ts            — REG-03: registry-hive
  startup.ts         — REG-04: registry-startup
  uninstall.ts       — REG-05: registry-uninstall
  usb.ts             — REG-06: registry-usb
  associations.ts    — REG-07: registry-associations
  mru.ts             — REG-08: registry-mru
  index.ts           — category dispatcher

src/services/sysint/tools/registry.ts  — shim: re-exports run from ./registry/index.js

src/services/sysint/__tests__/registry-plan01.test.ts
```

## Catalog Entries to Add

8 new entries in `data/sysint/catalog.json` — category: "registry", native: true, platforms: ["win32", "wsl"]:

| id | adminRequired |
|----|--------------|
| registry-search | false |
| registry-snapshot-diff | false |
| registry-hive | false |
| registry-startup | false |
| registry-uninstall | false |
| registry-usb | false |
| registry-associations | false |
| registry-mru | false |

## Implementation Notes

### shared.ts
- `execPs(script)`: run PowerShell -NoProfile -NonInteractive, return stdout, normalize CRLF
- `PLATFORM_UNSUPPORTED_ERROR`: pre-built error object constant
- `assertWindows(toolId)`: return PLATFORM_UNSUPPORTED if process.platform === 'linux' (non-WSL)
- winreg-based `readKey(hive, keyPath)`: enumerate values under a key
- winreg-based `enumKeys(hive, keyPath)`: list subkey names

### REG-01: registry-search
- Args: `--pattern <regex>` (required), `--hive <HKLM|HKCU|HKCR|HKU|HKCC>` (default: all), `--depth <N>` (default 3)
- Use PowerShell `Get-ChildItem -Recurse` with Where-Object filter
- Output row: `{ hive, key, valueName, valueType, valueData }`

### REG-02: registry-snapshot-diff
- Args: `--snapshot1 <path>` `--snapshot2 <path>` OR `--take-snapshot --output <path>`
- Snapshot: JSON file with all keys/values under specified root
- Diff: added/removed/changed rows
- Output row: `{ change: 'added'|'removed'|'changed', key, valueName, before, after }`

### REG-03: registry-hive
- Args: `--hive-file <path>` (offline .hiv file), `--key <path>` (optional subkey)
- Uses `reg load TMP_HIVE <path>` + query + `reg unload` — child_process
- Fallback: PowerShell `Get-RegSubKey` via reg.exe
- Output row: `{ key, valueName, valueType, valueData }`

### REG-04: registry-startup
- Reads: HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run(Once)
         HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run(Once)
- Output row: `{ hive, key, name, command, runOnce }`

### REG-05: registry-uninstall
- Key: HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall and Wow6432Node variant
- Output row: `{ displayName, publisher, version, installDate, installLocation, uninstallString }`

### REG-06: registry-usb
- Keys: HKLM\SYSTEM\CurrentControlSet\Enum\USB and USBSTOR
- Output row: `{ deviceClass, deviceId, friendlyName, manufacturer, service, lastConnected }`

### REG-07: registry-associations
- Key: HKCR (file extension → ProgID → shell\open\command)
- Args: `--ext <.pdf>` (optional filter)
- Output row: `{ extension, progId, description, command }`

### REG-08: registry-mru
- Key: HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\RecentDocs
- Output row: `{ extension, slot, path, timestamp }`

## Test Plan

All tests run on Linux (CI environment) — tests must pass without Windows.

- Platform guard: every tool returns PLATFORM_UNSUPPORTED on Linux
- Parser unit tests with mock registry output strings (no real registry needed)
- Snapshot diff logic: unit test with two mock JSON objects
- MRU binary decode: unit test with known hex fixture
- Integration: `registry.ts` shim exports `run`, dispatches all 8 tool IDs

## Success Criteria

1. All 8 tools in catalog with native: true, platforms: ["win32", "wsl"]
2. All 8 tools return PLATFORM_UNSUPPORTED when called on Linux
3. Parser functions tested with mock data — 100% of parsers have unit tests
4. Snapshot diff produces correct added/removed/changed output
5. Tests pass: `npx jest registry-plan01`
