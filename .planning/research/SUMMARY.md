# Research Summary: SysInt

## Recommended Stack

| Layer | Package | Version | Role |
|-------|---------|---------|------|
| Runtime | Node.js LTS | 20.x | Already required by HakanMCP |
| Types | TypeScript | 5.9+ | Strict mode, ESM target ES2022 |
| Validation | Zod | 4.1+ | Schema validation (already in deps) |
| System info | systeminformation | 5.31.5+ | CPU, memory, network, disk, processes — covers ~50 tools |
| Registry | winreg | 1.2.4+ | Windows registry reads, no native deps |
| Browser DBs | better-sqlite3 | 11.0.0+ | Sync SQLite, fastest, zero native deps |
| Windows APIs | child_process (built-in) | — | PowerShell for WMI/DPAPI; avoids node-ffi |
| Linux metrics | fs + child_process (built-in) | — | Direct /proc and /sys reading |

**Avoid:** node-gyp/node-ffi-napi (build complexity), raw `exec()` with string concat (injection risk), systeminformation in async mode for simple queries (slower).

---

## Feature Priorities

### Table Stakes (always build)

| Category | Tools | Portability | Complexity |
|----------|-------|-------------|------------|
| Network | 63 | 85% | Low–Med |
| Disk | 17 | 70% | Low–Med |
| Process | 11 | 60% | Low–Med |
| Browser (history/bookmarks/extensions) | ~15 of 24 | 80% | Low–Med |

### Differentiators (cross-platform value-add)

- Multi-browser history aggregation (Chrome + Firefox + Edge → single JSON)
- Process↔TCP connection correlation (not just `netstat` dump)
- Hash-based duplicate file detection
- Aggregated DNS with WHOIS enrichment
- Installed apps aggregated across package managers (Windows + Linux)

### Windows-Only (build, label clearly)

| Category | Tools | Notes |
|----------|-------|-------|
| Registry | 10 | Low complexity, forensics value |
| System telemetry | ~30 of 74 | Event Log, WER, product keys |
| Password (DPAPI) | ~19 of 21 | DPAPI blocker on Linux; Firefox NSS is portable |

### Skip or Stub

- Audio (4 tools) — audio subsystem too fragmented across platforms
- Programmer tools (15) — mostly Windows PE/COM, low value
- Outlook (6) — forensics niche only; build if explicitly requested
- Password DPAPI tools — return "Windows-only" error on Linux, do not stub silently

---

## Architecture

### Three Layers

```
src/services/sysint/
├── platforms/          # AbstractSysIntPlatform + Windows/Linux/WSL impls
├── tools/              # Category modules (network/, process/, disk/, browser/, ...)
└── utils/              # outputFormatter, privilegeHelper, pathHelper

data/sysint/
├── catalog.json        # 250 tool definitions (authoritative source)
└── schemas/            # Zod output schemas per tool

src/tools/sysint.ts     # MCP dispatcher (list / info / run actions)
```

### Platform Adapter Pattern

`AbstractSysIntPlatform` defines the interface (getProcessList, getNetworkConnections, getDrives, etc.). `WindowsPlatform` uses PowerShell + WMI. `LinuxPlatform` reads /proc + /sys directly and falls back to ss/ip/lsof. `WSLBridge extends LinuxPlatform` — prefers Linux native tools, falls back to PowerShell for registry/services.

### Lazy Loading (three phases)

1. **Startup** — only `catalog.json` loaded (~50 KB)
2. **First tool use** — category module imported and cached (e.g., network: ~150 KB)
3. **Handler invocation** — platform singleton + args → normalized JSON

### Coexistence with NirSoft Binary Wrapper

Keep `src/tools/nirsoft.ts` unchanged. Add `src/tools/sysint.ts` alongside. Unified dispatcher tries native SysInt first; falls back to binary NirSoft if tool not yet implemented. Register via existing `FEATURE_TOOL_MAP`.

### Output Contract

Every tool returns:
```json
{ "schema_version": "1.0", "rows": [...], "count": N, "timestamp": "ISO8601", "platform": "win32|linux" }
```

---

## Critical Pitfalls

| # | Pitfall | Impact | Fix |
|---|---------|--------|-----|
| 1 | **Browser DB file lock** — Chrome holds read-lock while running | Silent failure or crash | Always copy DB to temp first; copy `-wal` and `-shm` files too |
| 2 | **DPAPI scope mismatch** — decrypt as wrong user or in container | Garbled/empty output | Shell to PowerShell for DPAPI; skip gracefully on Linux/WSL |
| 3 | **Path normalization** — hardcoded separators break on NTFS↔ext4 | Cross-platform failures | `path.join()` everywhere; normalize UNC paths; cache WSL detection |
| 4 | **Credential exposure via args** — passwords visible in `ps aux` | Security leak | Pass sensitive data via temp file (chmod 0600), never via CLI arg |
| 5 | **Admin detection race** — tools fail silently when unprivileged | Invisible errors | Check privilege before execution; fail fast with clear message, not mid-operation |

Honorable mentions: CRLF in PowerShell output (normalize immediately), child process spawn overhead in WSL (batch calls, prefer /proc reads), browser schema drift across Chrome versions (version-detect at runtime).

---

## Phase Order Consensus

All four documents align on the same foundation-first sequence. Differences are in granularity:

| Phase | What | Basis |
|-------|------|-------|
| **0 — Foundation** | Platform abstraction layer, catalog loader, output formatter, sysint.ts dispatcher | All 4 docs agree: nothing else works without this |
| **1 — Process + Network** | Process listing, TCP/UDP connections, network interfaces, routing | STACK says network P2, ARCHITECTURE says process P2a then network P2b, FEATURES ranks network P1 — consensus: do both together |
| **2 — Disk + System (subset)** | Disk space/SMART/opened files, top-20 system tools (CPU, memory, services, startup programs) | FEATURES ranks disk P2, ARCHITECTURE ranks system P2d but scoped to 20 of 74 |
| **3 — Browser** | Multi-browser history, bookmarks, extensions; cookies (Windows DPAPI deferred) | FEATURES P4, ARCHITECTURE P3a, STACK P3 — consistent |
| **4 — Registry + Password** | All 10 Windows registry tools; Firefox NSS password extractor; DPAPI tools Windows-only | Security audit required before release; ARCHITECTURE flags as security-sensitive |
| **5 — Polish + Stragglers** | Outlook PST reader (if needed), programmer DLL viewer (if needed), E2E tests, perf benchmarks | All docs agree: opportunistic, only if demand |

---

## Open Questions

| # | Question | Options | Stakes |
|---|----------|---------|--------|
| 1 | **Scope: MVP tool count vs full 250** | 50 high-value tools vs complete NirSoft parity | Timeline; FEATURES doc warns about feature-parity trap |
| 2 | **Password tools: include or exclude?** | Skip DPAPI entirely / Windows-only with audit / include Firefox NSS only | Security review cost; legal exposure on corporate networks |
| 3 | **Unified dispatcher vs separate sysint prefix** | Agents call `nirsoft` and get native impl transparently vs explicit `sysint` action | Agent prompt engineering; backward compatibility |
| 4 | **Admin escalation UX** — UAC dialog on Windows acceptable? | Silent fail / warn user / auto-escalate via `Start-Process -Verb RunAs` | User experience for tools requiring elevation |
| 5 | **Browser tools on Linux** — cookies are plaintext; build or skip? | Skip (low value vs Windows DPAPI complexity) / always build for Linux | Scope vs completeness |
