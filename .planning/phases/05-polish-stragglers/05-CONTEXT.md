# Phase 5: Polish + Stragglers - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

12 remaining tools: programmer (PRG-01..06), Outlook (OTL-01..03), audio (AUD-01..03). Plus E2E test coverage and performance benchmarks across all 117 requirements.

</domain>

<decisions>
## Implementation Decisions

### Programmer tools
- DLL/SO export listing (PRG-01): Windows `dumpbin /exports` or PowerShell, Linux `nm -D` or `readelf -Ws`
- PE/ELF header reader (PRG-02): Parse first bytes for magic numbers and header info, Windows PE format, Linux ELF format
- File hash batch (PRG-03): Reuse DSK-13 hash calculator in batch mode (directory scan)
- .NET assembly info (PRG-04): Windows `[System.Reflection.Assembly]::LoadFrom()` via PowerShell, Linux `monodis` if available
- Resource extractor (PRG-05): Windows `ResourceExtract` via PowerShell, Linux `binutils objcopy`
- GAC viewer (PRG-06): Windows `gacutil -l` or scan `%WINDIR%\assembly`, Linux mono GAC

### Outlook tools
- PST reader (OTL-01): Pure JS PST parsing (MAPI format) — no Outlook dependency
- Mailbox stats (OTL-02): Parse PST for folder counts, message counts, sizes
- Address book (OTL-03): Parse PST contacts folder or WAB file
- If PST parsing too complex: use `node-pst` npm package or stub with clear "not yet implemented"

### Audio tools
- Device listing (AUD-01): Windows `Get-AudioDevice` PowerShell module or WMI, Linux `pactl list sinks/sources` or `aplay -l`
- Volume control (AUD-02): Windows `Get-AudioDevice -PlaybackVolume`, Linux `amixer` or `pactl`
- Codec listing (AUD-03): Windows `Get-CimInstance Win32_CodecFile`, Linux `aplay --list-pcms` + `ffmpeg -codecs` if available

### E2E and performance
- Integration test: every tool ID callable through dispatcher, returns valid output shape
- Performance: catalog load < 200ms, first tool invocation < 2s
- Test coverage: aim for 90%+ across all sysint modules

### Claude's Discretion
- PST parsing approach (npm package vs manual vs stub)
- Audio subsystem abstraction level
- E2E test organization
- Performance benchmark tooling

</decisions>

<specifics>
## Specific Ideas

- PRG-01 and PRG-02 are the most useful programmer tools — prioritize those
- Outlook PST parsing is niche — acceptable to stub if too complex
- Audio tools can be simple wrappers around system commands

</specifics>

<deferred>
## Deferred Ideas

None — this is the final phase

</deferred>

---

*Phase: 05-polish-stragglers*
*Context gathered: 2026-04-07*
