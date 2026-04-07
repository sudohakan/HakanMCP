# Plan 02: Outlook + Audio Tools (OTL-01..03, AUD-01..03)

**Phase:** 05-polish-stragglers
**Requirements:** OTL-01, OTL-02, OTL-03, AUD-01, AUD-02, AUD-03
**Created:** 2026-04-07

## Goal

Implement Outlook (PST-adjacent, stub if too complex) and Audio category modules.
Audio tools are simple system command wrappers. Outlook tools use PowerShell where Outlook
is available and graceful stubs otherwise.

## Files to Create

```
src/services/sysint/tools/outlook.ts             — category shim
src/services/sysint/tools/outlook/
  index.ts    — dispatcher
  shared.ts   — platform guard, execPs re-export
  attachments.ts — OTL-01: attachment listing
  mailboxstats.ts — OTL-02: mailbox statistics
  addressbook.ts  — OTL-03: address book reader

src/services/sysint/tools/audio.ts              — category shim
src/services/sysint/tools/audio/
  index.ts    — dispatcher
  shared.ts   — platform helpers, execCmd, execPs
  devices.ts  — AUD-01: audio device listing
  volume.ts   — AUD-02: volume getter/setter
  codecs.ts   — AUD-03: codec listing

src/services/sysint/__tests__/phase5-outlook-audio.test.ts
```

## Catalog Changes

Update `data/sysint/catalog.json` — set `native: true` for:
- `outlook-attachments` (OTL-01), `outlook-stats` (OTL-02), `outlook-addressbook` (OTL-03)
- `audio-devices` (AUD-01), `audio-volume` (AUD-02), `audio-codecs` (AUD-03)

## Outlook Implementation

### Decision: PowerShell COM + graceful stub

PST binary parsing is a 500+ line endeavor with MAPI format complexity.
Decision: use PowerShell Outlook COM object (works when Outlook is installed),
fall back to a structured stub message when Outlook is not available.
This satisfies OTL requirements in the majority real-world case (Outlook installed on Windows).

### OTL-01: outlook-attachments
```powershell
$ol = New-Object -ComObject Outlook.Application
$ns = $ol.GetNamespace("MAPI")
# Walk all folders, collect attachments
```
Returns: `{ folder, subject, sender, date, attachmentName, attachmentSize }`
Args: `--folder <name>` (default: all), `--limit <n>` (default 100)
If Outlook COM fails → return stub with `{ note: "Outlook not installed or not available" }`

### OTL-02: outlook-stats
PowerShell COM walk: count messages, total size per folder.
Returns: `{ folder, messageCount, totalSizeMB, unreadCount }`
Same fallback pattern as OTL-01.

### OTL-03: outlook-addressbook
```powershell
$ol = New-Object -ComObject Outlook.Application
$ns = $ol.GetNamespace("MAPI")
$ab = $ns.AddressLists
```
Returns: `{ displayName, email, company, phone, addressList }`
Same fallback pattern.

All Outlook tools: Windows/WSL only. Return PLATFORM_UNSUPPORTED on pure Linux.

## Audio Implementation

### AUD-01: audio-devices
- Windows: `Get-CimInstance Win32_SoundDevice` via PowerShell + `Get-AudioDevice` if available
- Linux: `pactl list sinks` + `pactl list sources` (primary), `aplay -l` (fallback)
- Returns: `{ name, driver, type, isDefault, status, channels, sampleRate }`
- type: `output` | `input`

### AUD-02: audio-volume
- Windows: PowerShell SoundMixer COM or `[Audio.CoreAudioApi]` via AudioDeviceCmdlets
- Linux: `pactl get-sink-volume @DEFAULT_SINK@` (output), `pactl get-source-volume @DEFAULT_SOURCE@` (input)
- Returns: `{ device, volumePercent, isMuted, channel }`
- Args: `--set <0-100>` (optional — if provided, sets volume), `--device <name>`
- Read-only default; set only if --set provided

### AUD-03: audio-codecs
- Windows: `Get-CimInstance Win32_CodecFile` via PowerShell
- Linux: check `/proc/asound/pcm` + `aplay --list-pcms` + `cat /proc/asound/cards`
- Returns: `{ name, description, path, version, type }` where type: `audio|video|acm|acm-audio`

## Test Strategy

Tests run on Linux CI:
1. Outlook platform guards: all 3 OTL tools return PLATFORM_UNSUPPORTED on plain Linux
2. Audio: AUD-01/02/03 on Linux — test that pactl/aplay path is attempted or graceful failure
3. Parser functions for all tools (tabular output parsing)
4. Both category dispatchers handle unknown tool IDs with EXEC_FAILED
5. Audio devices: mock exec output, verify parse functions

## Success Criteria

- All 6 tool IDs callable through their category dispatchers
- OTL tools: PLATFORM_UNSUPPORTED on Linux, graceful stub fallback on Windows
- AUD tools: attempt Linux audio system commands, return structured rows or graceful error
- Test coverage for parser functions and platform guards
