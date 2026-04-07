# Phase 4: Registry + Password - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

18 native tools: Windows registry (REG-01..08) and credential extraction (PWD-01..10). Security-sensitive phase — explicit platform guards, privilege checks, no silent failures.

</domain>

<decisions>
## Implementation Decisions

### Registry tools (Windows-only)
- Use `winreg` npm package (no native build deps) for registry reads
- Registry search (REG-01): recursive key/value enumeration with pattern matching
- Change monitor (REG-02): snapshot registry state to JSON, diff two snapshots
- Offline hive (REG-03): binary hive file parsing (REGF format) — complex, use child_process `reg load` + query
- Startup entries (REG-04): read Run/RunOnce keys from HKLM and HKCU
- Uninstall entries (REG-05): enumerate HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
- USB registry (REG-06): enumerate HKLM\SYSTEM\CurrentControlSet\Enum\USB + USBSTOR
- Shell associations (REG-07): HKCR file type associations
- MRU lists (REG-08): HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\RecentDocs
- ALL registry tools on Linux: return PLATFORM_UNSUPPORTED error (not empty result, not crash)

### Password tools
- Firefox NSS (PWD-02): cross-platform, use `nss` libraries via child_process calling `certutil`/`pk12util` or direct SQLite + key3/key4.db decryption
- Chrome DPAPI (PWD-01): Windows-only, PowerShell `[System.Security.Cryptography.ProtectedData]::Unprotect()` on encrypted_value from Cookies/Login Data
- Wi-Fi passwords (PWD-03): Windows `netsh wlan show profile name=X key=clear`, Linux NetworkManager `/etc/NetworkManager/system-connections/`
- Windows Credential Manager (PWD-04): `cmdkey /list` or PowerShell CredentialManager
- Windows Vault (PWD-05): PowerShell `Get-VaultCredential` (Web Credentials vault)
- RDP credentials (PWD-06): Registry + DPAPI for saved RDP passwords
- VNC passwords (PWD-07): known VNC password file locations + DES decryption (fixed key, well-documented)
- Mail passwords (PWD-08): Thunderbird uses Firefox NSS, Outlook stored in Credential Manager
- LSA secrets (PWD-09): Windows admin-only, `reg save` + offline parsing or PowerShell
- Network passwords (PWD-10): Windows `cmdkey /list` filtered for network entries

### Security measures
- Never pass credentials via command line args (visible in ps aux)
- Use temp files with chmod 600 for sensitive data transfer
- Clear sensitive data from memory after use (overwrite buffers)
- All password tools require explicit `--allow-credentials` flag or return warning
- Log credential access attempts (audit trail)

### Platform guards
- Registry tools: check platform before execution, fail fast with PLATFORM_UNSUPPORTED
- DPAPI tools: Windows-only, clear error on Linux
- Firefox NSS: cross-platform (primary differentiator)
- Wi-Fi passwords: platform-specific implementations, both supported

### Claude's Discretion
- Exact NSS key decryption approach (FFI vs child_process vs pure JS)
- Registry snapshot storage format
- VNC DES key handling
- Test approach for credential tools (mock data, never test with real credentials)

</decisions>

<specifics>
## Specific Ideas

- Firefox NSS cross-platform password extraction is the crown jewel — this is what NirSoft can't do on Linux
- Registry snapshot diff should produce human-readable output (added/removed/changed)
- Credential tools should have a dry-run mode that shows what would be extracted without actually decrypting

</specifics>

<deferred>
## Deferred Ideas

- Browser cookie decryption was partially addressed in Phase 3 (plaintext only) — Phase 4 adds DPAPI decryption for Chrome/Edge cookies
- Credential rotation/management — out of scope (read-only tools)

</deferred>

---

*Phase: 04-registry-password*
*Context gathered: 2026-04-07*
