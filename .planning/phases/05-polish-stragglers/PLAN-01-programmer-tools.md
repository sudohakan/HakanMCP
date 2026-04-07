# Plan 01: Programmer Tools (PRG-01..06)

**Phase:** 05-polish-stragglers
**Requirements:** PRG-01, PRG-02, PRG-03, PRG-04, PRG-05, PRG-06
**Created:** 2026-04-07

## Goal

Implement the programmer category module with 6 tools covering DLL/SO export listing,
PE/ELF header parsing, batch file hashing, .NET assembly info, resource extraction, and GAC viewer.

## Files to Create

```
src/services/sysint/tools/programmer.ts          — category shim
src/services/sysint/tools/programmer/
  index.ts    — dispatcher
  shared.ts   — platform helpers, execCmd, execPs
  exports.ts  — PRG-01: DLL/SO export listing
  headers.ts  — PRG-02: PE/ELF header reader
  hashbatch.ts — PRG-03: file hash batch mode
  dotnet.ts   — PRG-04: .NET assembly info
  resources.ts — PRG-05: resource extractor
  gac.ts      — PRG-06: GAC viewer
src/services/sysint/__tests__/programmer-plan01.test.ts
```

## Catalog Changes

Update `data/sysint/catalog.json` — set `native: true` for these tool IDs:
- `dll-exports` (PRG-01)
- `pe-headers` (PRG-02)
- `hash-batch` (PRG-03)
- `dotnet-info` (PRG-04)
- `resource-extract` (PRG-05)
- `gac-viewer` (PRG-06)

Add entries if missing (category: `programmer`, adminRequired: false, timeout: 30000).

## Implementation Details

### PRG-01: dll-exports
- Windows: `dumpbin.exe /exports <file>` (if available) else PowerShell Get-PEExports workaround
- Linux: `nm -D <file>` or `readelf -Ws <file>` (prefers nm for broad availability)
- Parse output → rows: `{ symbol, address, ordinal, type }`
- Requires `--file <path>` arg

### PRG-02: pe-headers
- Read first 512 bytes of binary with `fs.readFileSync`
- Windows PE: detect MZ signature (0x4D5A), then PE offset at bytes 0x3C-0x3F, then PE\0\0 (0x5045 0x0000)
- Linux ELF: detect magic \x7FELF (bytes 0-3), parse e_type, e_machine, e_entry from ELF header
- Returns: `{ format, architecture, entryPoint, subsystem, isDll, is64Bit, linkerVersion }`
- Cross-platform: PE parsing works on Linux too (reading any binary)

### PRG-03: hash-batch
- Wraps existing `disk/hash.ts` logic for batch directory mode
- Args: `--dir <path>` (required), `--algo <md5|sha1|sha256>` (default sha256), `--pattern <glob>`
- Recursively scan directory, compute hash for each file
- Rows: `{ file, size, hash, algo }`
- Reuse `crypto.createHash` — zero dependency

### PRG-04: dotnet-info
- Windows/WSL: PowerShell `[System.Reflection.Assembly]::ReflectionOnlyLoadFrom()`
- Linux: `monodis --assembly <file>` if monodis available, else parse PE metadata directly
- Fallback: parse .NET metadata tables from PE file (offset 0x14 in PE optional header for CLR header RVA)
- Returns: `{ name, version, culture, publicKeyToken, targetFramework, isStrongNamed }`
- Args: `--file <path>`

### PRG-05: resource-extract
- Windows: PowerShell with `[System.Reflection.Assembly]` or `icacls`; use `Get-WinEvent` workaround
- Cross-platform: use `node-fetch` approach — read PE resource section (RVA from PE data directory[2])
- Actually: parse PE RSRC section to list resources (strings, icons, version info)
- Returns: `{ type, name, language, size }` rows (list, not extract to disk by default)
- Args: `--file <path>`, `--type <icon|string|version|all>`

### PRG-06: gac-viewer
- Windows: scan `%WINDIR%\assembly` and `%WINDIR%\Microsoft.NET\assembly` directories
- Linux: scan `/usr/lib/mono/gac` or `~/.config/mono/gac` for mono GAC
- Parse directory structure: `AssemblyName/Version__PublicKeyToken/`
- Returns: `{ name, version, publicKeyToken, path, runtime }`

## Test Strategy

All tests run on Linux CI. Tests cover:
1. Platform guards (Windows-only tools return PLATFORM_UNSUPPORTED on pure Linux)
2. Parser functions with fixture input (pure unit, no I/O)
3. Run functions: error cases (missing args, bad file path)
4. Category dispatcher: all 6 tool IDs dispatched correctly

## Success Criteria

- All 6 tool IDs callable through programmer category dispatcher
- PRG-01 and PRG-02 parse functions tested with sample data
- PRG-03 hash-batch works cross-platform (uses Node.js crypto)
- Platform guards return correct error codes
- Test file < 400 lines
