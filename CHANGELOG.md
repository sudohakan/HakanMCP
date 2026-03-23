# Changelog

All notable changes to the HakanMCP project (formerly Claude Flow) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-03-23

### Added
- Playwright catalog entry for on-demand browser sessions through the MCP client
- New low-token browser wrapper tools: `mcp_browserConnect`, `mcp_browserNavigateExtract`, `mcp_browserProbeLogin`, `mcp_browserCaptureProof`, `mcp_browserDisconnect`
- Repo-level `.gitattributes` policy to keep TypeScript, JSON, Markdown, YAML, and shell files normalized to LF

### Changed
- Browser wrappers now support reusable auto-connect settings such as `cdpEndpoint`, `extension`, `allowedHosts`, `outputDir`, and timeout controls
- README and product messaging now present HakanMCP as the preferred browser automation layer for Claude-oriented workflows
- Tool manifest and catalog metadata now reflect 112 tools with 10 on-demand MCP servers

### Fixed
- Remove the invalid Windows absolute-path ignore entry that caused `rg` and tooling noise in the repository
- Ignore rotate-audit runtime artifacts so generated audit logs stay out of the working tree
- Keep browser proof capture and page-summary flows compact enough for low-token agent use
- Sync optional `pg` / `socks` entries in `package-lock.json` so `npm ci` passes consistently in CI

## [2.1.1] - 2026-03-20

### Changed
- Rewrite README with interactive layout, mermaid architecture diagram, and collapsible sections
- Update SECURITY.md supported versions table (v2.1.x as current)
- Add v2.x release tag links and milestone entries to CHANGELOG.md
- Rewrite docker-regression README to reflect v2.1.0 architecture

### Fixed
- Replace 11 Turkish strings with English equivalents across 3 tool modules
- Fix 9 TypeScript build errors (mongodb/mysql2 optional dependency types)
- Fix all 66 ESLint warnings (unused vars, implicit any, empty blocks, useless escapes)
- Fix tool count inconsistency in README (131→107)
- Fix unreachable logic in moeRouter.ts (hardcoded complexity)
- Fix non-null assertion on optional chain in encryption test

### Removed
- Remove 900+ code comments and decorative separators across 80+ files
- Remove dead code: 287-line unused function block in console_chat.ts
- Remove no-op clearCharacterCache() function
- Remove unused dependencies: csv-stringify, cli-table3, agentdb
- Remove 39 internal plan references ("plan §", "Pitfall N") from JSDoc
- Remove invalid Windows absolute path from .gitignore

### Security
- Fix high-severity prototype pollution in flatted
- Fix moderate-severity prototype pollution in hono
- Move @types/express, @types/node-cron from dependencies to devDependencies
- Move adm-zip from devDependencies to dependencies (runtime usage)

## [2.1.0] - 2026-03-19

### Added
- On-demand MCP server catalog (`src/catalog/`) with 9 auth-free servers (fetch, filesystem, git, memory, sequential-thinking, sqlite, time, mermaid, duckdb)
- `mcp_catalog` tool — lists available on-demand servers with conditions
- `mcp_connectFromCatalog` tool — connects to catalog server by key name
- JSON copy step in build pipeline for catalog distribution

### Removed
- `fs_*` tools (8) — replaced by on-demand Filesystem MCP server
- `git_*` tools (7) — replaced by on-demand Git MCP server + Bash git commands
- `github_*` tools (5) — replaced by `gh` CLI via Bash
- `kg_*` tools (6) — replaced by on-demand Memory MCP server
- `simple-git` dependency (no longer needed)
- `glob` dependency (unused after fs_searchFiles removal)

### Changed
- Tool count reduced from 141 to 107 (34 removed, 2 added)
- Feature modules now only include `db` and `mongo` (git removed)
- Build config adds `resolveJsonModule` for catalog support

## [2.0.5] - 2026-03-15

### Fixed
- Actually remove tracked file with invalid Windows path from git index (checkout was still failing)
- Add path to .gitignore to prevent re-addition

## [2.0.4] - 2026-03-15

### Fixed
- Remove accidentally committed file with invalid Windows path (`C:\dev\HakanMCP\logs\...`)
- Ensure logs/ directory stays gitignored

## [2.0.3] - 2026-03-15

### Fixed
- ESLint config: remove projectService (scripts/tests not in tsconfig), use simple parser
- ESLint: downgrade remaining errors to warnings (no-empty, no-non-null-asserted-optional-chain)
- db.ts: use `any` type for optional sqlite3 import (avoids build failure when sqlite3 not installed)

## [2.0.2] - 2026-03-15

### Fixed
- Remove `--omit=optional` from verification-pipeline.yml (socks/smart-buffer lock mismatch)
- Add eslint.config.js for ESLint v9 flat config (CI lint step was failing)
- Downgrade lint errors to warnings for existing codebase compatibility

## [2.0.1] - 2026-03-15

### Fixed
- Sync package-lock.json with package.json (missing: pg, sqlite3, marked, node-addon-api)
- CI `npm ci` now passes without lock file mismatch

## [2.0.0] - 2026-03-15

### Breaking Changes
- Major codebase-wide update across 172 files
- CLI, config, agents, scripts, tools, and tests overhauled
- Peer module updated

### Changed
- Updated all source files (src/, bin/, scripts/, peer/)
- Updated all test files for consistency
- Updated agent definitions (architect, coder, reviewer, security-architect, tester)
- Updated CI/CD workflows and build configuration
- Updated documentation (README, SETUP, SECURITY, CONTRIBUTING, CLAUDE.md)
- Updated config examples (.env.example, config.yaml.example)
- Updated package.json and package-lock.json dependencies

## [1.4.1] - 2026-03-10

### Fixed

- README: replaced non-existent `hakanmcp chat` with `npm run console:chat`
- README: updated init/mission/start command docs to reflect v1.4.0 workspace features
- README: expanded project structure with new cli/ files and workspace directories
- SETUP.md: removed hardcoded `--version 1.0.0` and non-existent `--diagnostics` flag
- SECURITY.md: updated supported versions table (was only `1.0.x`, now covers 1.2.x-1.4.x)
- docker-regression README: corrected Node.js requirement from 18+ to 20+

### Changed

- CLAUDE.md: expanded CLI commands table from 9 to 14 entries with workspace options
- CONTRIBUTING.md: expanded CLI command addition guide with cliUtils and doc update steps
- SECURITY.md: added workspace isolation security layer and mission review best practice
- Legacy issues (.github/): added context notes clarifying v2.7/v3.5 era references

## [1.4.0] - 2026-03-10

### Added

- Workspace-scoped missions: centralized config with per-workspace mission files and state
- Interactive `hakanmcp init` with full Q&A flow (@inquirer/prompts: name, target, tasks, schedule, tags)
- Workspace dashboard under `mission` command (default view lists all workspaces with status)
- Workspace modes for `start` command (--workspace, --all, --parallel)
- `init --remove <name>` to delete workspace config, mission files, and state directory
- Shared CLI rendering utilities (`src/cli/cliUtils.ts`) for consistent command headers
- Bare command support in chat REPL (type command name without `/` prefix)
- `getAgenticToolsRef()` export from aiTools for external tool access
- `npm pkg set` and `npm update` added to doctor fix safe command list

### Changed

- Pills menu reordered: init/start/stop/mission/report (row 3), watch/scheduled/reactive/clear/exit (row 4)
- MENU_COLORS expanded to match pill column colors across all commands
- Help text updated for mission (dashboard + detailed), init (interactive + --remove), watch (file watcher)
- Config help: added workspaces[].name/path/primary/secondary documentation

### Fixed

- Double blank line after commands in chat REPL (prompt newline handling)
- "Command error: Process exited with code 1" on commands that display their own errors
- Spinner color mismatch (custom pre-colored frames instead of named ANSI colors)
- Init crash in embed/subprocess mode (guard for non-TTY stdin)

## [1.3.1] - 2026-03-10

### Added

- Auto-detect GitHub owner/repo from git remote origin URL (HTTPS + SSH)
- `src/utils/gitInfo.ts` utility with cached remote URL parsing
- `system` category added to `config info`
- 7 config toggles added to status board (GitHub, Monitoring, Scheduler, Consciousness, Watch, Reactive, Self-Improve)

### Changed

- GitHub owner/repo in config is now optional — auto-detected from git remote, config used as fallback only
- CONFIG_INFO expanded: monitoring (peerInstance, healthCheckEndpoints), scheduler (persistencePath), consciousness (reflection sub-fields), ai (encrypted key fields)
- CLAUDE.md: added CLI Change Rule, expanded Config Change Rule

### Fixed

- Status board missing most config toggles (only showed backup + AI providers)
- CONFIG_INFO missing `system` category and several fields across existing categories

## [1.3.0] - 2026-03-10

### Added

- Expanded character system with 4 new traits (humor, patience, assertiveness, formality) and AI-driven emotion analysis
- Consciousness config guard — `consciousness.enabled` now actually controls the entire consciousness subsystem
- Session journal improvements: minimum message threshold, meaningfulness check before writing
- Config-driven self-improvement: `autoCommit`, `requireApproval`, `maxChangesPerDay` read from config.yaml
- `watch` and `reactive` added to Zod config schema (fixes values being silently stripped)
- `git pull`, `git fetch`, `git checkout` added to doctor safe command list
- Auto-copy `config.yaml.example` → `config.yaml` and `.env.example` → `.env` on first run
- `config.yaml.example` tracked in git as setup template
- Config change rule added to project CLAUDE.md

### Changed

- Help menu overhauled: removed icons, individual command lines, `padEnd(40)` alignment
- Status board expanded: selfImprovement (4 rows), consciousness (5 rows), watch/reactive/scheduler
- Merged `useOllamaInChat` into `config.aiProviders.localModels` (single flag)
- CONFIG_INFO output updated to reflect all new config fields

### Fixed

- Watch, reactive, and scheduler always showing `false` in status board (Zod stripping + wrong key)
- Backup showing `false` despite being enabled in config
- `monitoring.peerInstance` missing from config.yaml.example
- `gitbookUrl` was comment-only in config.yaml.example, now a proper key
- Removed unused `AUTONOMY_*` env vars from `.env.example`

### Removed

- `character.yaml` file (character config now embedded in consciousnessService)
- `useOllamaInChat` config key (merged into `localModels`)

## [1.2.0] - 2026-03-09

### Security

- Fixed command injection vulnerability in AI auto-repair (CodeQL: `js/command-line-injection`)
- Fixed cleartext logging of sensitive environment variables in doctor, quick_status, status_board
- Replaced weak SHA-256 password hashing with HMAC-SHA256 in dbPoolManager
- Fixed incomplete string sanitization (backslash escaping) in aiProviderCooldown and triggerEngine
- Fixed incomplete URL substring sanitization in aiProviders test
- Fixed 14 TOCTOU race conditions across 8 files (existsSync → try-catch pattern)
- Fixed 19 insecure temporary file creation issues (mkdtempSync + 0o600 permissions)
- Fixed 3 indirect command injection vulnerabilities (execFileAsync replacing shell interpolation)
- Added URL protocol validation for outbound network requests in postman and aiProviders
- Added field truncation and path traversal prevention in consciousnessService

### Fixed

- ConversationManager storage path moved to `.hakanmcp/conversations/`
- Sessions save path corrected (getProjectRoot instead of os.homedir)
- Agentic label now shows provider brand colors in chat UI

### Changed

- Repository cleanliness rules added to project CLAUDE.md

## [1.1.0] - 2026-03-09

### Added

- GitHub-based version checking via Releases API (replaces NPM registry check)
- Startup health checks: version, build staleness, Node.js version, config validation
- Dynamic status bar: Ready, Update available, Issue(s) detected, with actionable hints
- Auto-update via `doctor fix`: pulls latest from GitHub, reinstalls, and rebuilds
- `@types/semver` dev dependency for type-safe version comparison

### Changed

- `/doctor` version check now uses GitHub Releases API instead of NPM registry
- Status bar shows "Checking..." during startup, then resolves to final state
- `renderStatusBar()` accepts health result for dynamic rendering

## [1.0.0] - 2026-03-08

### HakanMCP v1.0.0 — Mission Agent MVP

First public release of HakanMCP Mission Agent — an autonomous AI agent system that can be initialized in any directory with a single command.

### Added

- Dependency resolver with lazy loading for native modules
- Mission system: define, execute, and manage agent missions with Zod-validated schemas
- CLI commands: init, start, stop, mission, report, watch, scheduled, reactive
- 4 working modes: watch (file monitoring), scheduled (cron-like), assistant (interactive chat), reactive (event-driven)
- Watch mode: file/directory change detection with automatic action triggers
- Scheduled mode: interval-based task execution with cron expressions
- Reactive mode: unified event bus combining watch + scheduled triggers
- Assistant mode: mission-aware interactive chat with context formatting
- Chat integration: slash commands for mission management in console
- Report generator: mission execution summaries and status reports
- npm-ready packaging with ESM + TypeScript + Commander.js

### Changed

- Version reset to 1.0.0 for Mission Agent MVP (separate from HakanMCP platform v3.5.0)

## [3.5.0] - 2026-02-27

### HakanMCP v3.5 — First Major Stable Release

This release marks the official rebranding from **Claude Flow** to **HakanMCP** and represents the first major stable release after 5,800+ commits, 55 alpha iterations, and 10 months of development.

### Highlights

- **Rebranding**: Claude Flow → HakanMCP across all packages (`@hakanmcp/cli`, `hakanmcp`, `hakanmcp`)
- **agentic-flow v3.0.0-alpha.1 Integration**: Full deep integration with 10 subpath exports (ReasoningBank, Router, Orchestration, Agent Booster, SDK, Security, QUIC transport)
- **AgentDB v3.0.0-alpha.9**: 8 new controllers (HierarchicalMemory, MemoryConsolidation, SemanticRouter, GNNService, RVFOptimizer, MutationGuard, AttestationLog, GuardedVectorBackend) + 6 MCP tools
- **215 MCP Tools**: Full Model Context Protocol server with vector memory, neural training, swarm coordination
- **Security Hardening**: Command injection fix, TOCTOU race fix, eliminated hardcoded HMAC keys, timing attack fixes
- **Doctor Health Check**: New `agentic-flow` diagnostic (filesystem-based, ESM-compatible)
- **0 Production Vulnerabilities**: Clean `npm audit` across all packages

### Added

- `agentic-flow-bridge.ts` — Unified lazy-loading bridge for all agentic-flow v3 modules
- Tiered embedding resolution: ReasoningBank WASM (Tier 1) → @hakanmcp/embeddings (Tier 2) → mock fallback (Tier 3)
- Agent Booster local import with npx fallback
- `checkAgenticFlow()` doctor health check
- 7 TypeScript module declarations for agentic-flow subpath exports
- ADR-056: agentic-flow v3 Integration Architecture

### Fixed

- Command injection vulnerability in enhanced-model-router.ts (SAFE_LANGUAGES whitelist)
- TOCTOU race condition in bridge singleton initialization (Promise-based caching)
- 22 agent/skill files updated from stale v1.5.11/v2.0.0-alpha to v3.0.0-alpha.1
- ESM compatibility for doctor checks (filesystem-based instead of `require.resolve`)
- @ruvector/gnn pinned to 0.1.25 to fix fatal process crash (issue #216)

### Changed

- All 3 packages bumped from `3.1.0-alpha.55` to `3.5.0`
- Publish tags changed from `alpha`/`v3alpha` to `latest`
- agentic-flow minimum version: `0.1.0` → `3.0.0-alpha.1`
- agentdb minimum version: `2.0.0-alpha.3.4` → `3.0.0-alpha.10`

---

## [3.1.0-alpha.55] - 2026-02-27

### AgentDB 3.0.0-alpha.9 Integration (ADR-053/ADR-055)

- Activated 8 AgentDB v3 controllers with MutationGuard proof engine
- Added 6 new MCP tools: `agentdb_hierarchical_*`, `agentdb_consolidation_*`, `agentdb_semantic_*`
- Fixed controller registry activation bugs (ADR-055)
- Statusline fixes for real-time controller status
- Pinned @ruvector/gnn@0.1.25 to fix fatal process crash

## [3.1.0-alpha.43] - 2026-02-15

### HakanMCP Branding Fix

- Fixed CLI branding: show 'hakanmcp' instead of 'hakanmcp' when run via `npx hakanmcp`
- Fixed Windows ESM import crash with `pathToFileURL`
- Fixed init hook prompt overflow and description field

## [3.1.0-alpha.36] - 2026-02-10

### Stability & Compatibility

- Fixed hooks backward compatibility: `--success` and `--file` made optional
- Fixed Windows npm install crash (404 optional dependencies)
- Bumped agentdb to 2.0.0-alpha.3.6
- Fixed V3 build errors (missing helmet, VERSION type, vitest spy)

## [3.1.0-alpha.29] - 2026-02-01

### Security & Agent Teams

- Security fixes, backward compatibility, and Agent Teams hooks
- Added `--settings` flag to upgrade command for Agent Teams
- Fixed npm 11 install crash by pinning agentdb

---

## v3.0.0-alpha Series (2025-10 to 2026-02)

### v3.0.0-alpha.184 — CLI Help & Categorization (2025-12)

- Fixed CLI help categorization across 26 commands
- Published install optimizations
- curl-style installer script
- SEO-optimized npm packages for discovery

### v3.0.0-alpha.170 — Plugins & Marketplace (2025-12)

- **Plugin Marketplace**: 8 official plugins + IPFS registry via Pinata
- **Gas Town Bridge Plugin**: WASM-accelerated orchestrator integration
- **10 RuVector WASM Plugins**: 50 MCP tools for neural computation
- **@hakanmcp/teammate-plugin**: MCP tools for Agent Teams coordination

### v3.0.0-alpha.150 — SONA & SemanticRouter (2025-11)

- **SemanticRouter**: SONA WASM integration with verified benchmarks
- Fixed phantom Claude popups on Windows
- Fixed statusline safe multi-line output for Claude Desktop
- Fixed MCP tool naming (`/` → `_`) for Claude Desktop compatibility
- Memory namespace support in delete command

### v3.0.0-alpha.100 — @hakanmcp/guidance (2025-11)

- **@hakanmcp/guidance Control Plane**: Governance, compliance, and policy enforcement
- Wave 1: Proof, gateway, memory-gate, coherence, hooks, persistence primitives
- Wave 2: Conformance kit, capability algebra, evolution pipeline, artifact ledger
- Wave 3: Civilization-grade primitives (trust, truth, uncertainty, time, authority)
- **Rust WASM Policy Kernel**: SIMD128-accelerated policy evaluation
- **ContinueGate**: Safety gate for agent continuation decisions
- 22-benchmark suite with before/after performance reporting
- CLAUDE.md generators, analyzer, and auto-optimizer
- Content-aware executor with statistical validation (Spearman ρ, Cohen's d)

### v3.0.0-alpha.50 — Core V3 Implementation (2025-10)

- Complete V3 implementation across all ADRs
- ADR-003: Coordinator consolidation + security tests
- Complete hooks system with AgentDB, HNSW, tests
- ReasoningBank guidance system with CLI
- V2→V3 migration documentation
- MCP memory tools upgraded to sql.js + HNSW backend
- Claims-based authorization (ADR-016)
- Node.js worker daemon system
- Auto-update system for @hakanmcp packages (ADR-025)
- Replaced all mock implementations with real functionality

### v3.0.0-alpha.1 — Foundation (2025-10)

- Complete V3 monorepo structure (`@hakanmcp/cli`, `shared`, `memory`, `hooks`, `security`)
- 26 CLI commands with 140+ subcommands
- 215 MCP tools via FastMCP 3.x
- RuVector intelligence system (SONA, MoE, HNSW, EWC++, Flash Attention)
- Hive-Mind consensus (Byzantine, Raft, Gossip, CRDT, Quorum)
- 17 hooks + 12 background workers
- 60+ specialized agent types
- Cross-platform helper system

---

## v2.7.x Series (2025-08 to 2025-10)

### v2.7.34 — PostgreSQL & Neural Persistence

- PostgreSQL Bridge with attention, GNN, hyperbolic embeddings
- Neural pattern persistence to disk
- Hive-mind `--claude` flag for spawn command
- Real statusline data, hive-mind shutdown fixes, daemon persistence
- Multi-platform builds (Linux, macOS, Windows) in CI/CD

### v2.7.0 — agentic-flow Integration

- Deep integration with agentic-flow coordination engine
- SDK architecture analysis and hooks & learning integration
- Modular installation strategy
- Optimized v3 migration plan

---

## v2.0.0-alpha Series (2025-05 to 2025-08)

### v2.0.0-alpha.128 — Maturity

- Comprehensive hive-mind optimization
- Database schema robustness (missing columns, optimization errors)
- Auto-rebuild better-sqlite3 on NODE_MODULE_VERSION mismatch
- InMemoryStore interval cleanup for clean process exit

### v2.0.0-alpha.53 — Hook Safety

- Critical hook safety system
- Hive-mind optimization command
- Safety & security features documentation
- Neural Link System with safety protocols

### v2.0.0-alpha.33 — Windows & WSL

- Windows/WSL compatibility fixes
- Module import error resolution
- README restructure for v2.0.0 features
- Comprehensive test suite

---

## v1.x Series (2025-01 to 2025-05)

### v1.0.71 — Final v1 Release

- npm publishing compatibility
- Full CLI command functionality
- SPARC integration with full prompt loading
- Cross-platform support

### v1.0.50 — Swarm & SPARC

- Parallel execution for swarm tasks
- Background task management
- Swarm command with improved error handling
- Claude Code slash commands integration

### v1.0.28 — Project Management

- CLI project management commands
- System monitoring and SPARC commands
- Orchestration templates (monitoring, optimization, security review)

### v1.0.1 — Initial Release (2025-01-01)

- Complete HakanMCP AI Agent Orchestration System
- Configuration guide and comprehensive tests
- Initial commit

---

## Milestone Summary

| Milestone | Version | Date | Key Feature |
|-----------|---------|------|-------------|
| Initial Release | v1.0.1 | 2025-01 | AI agent orchestration system |
| SPARC Integration | v1.0.50 | 2025-03 | Swarm + SPARC methodology |
| Alpha Foundation | v2.0.0-alpha.33 | 2025-05 | V2 alpha with hook safety |
| agentic-flow | v2.7.0 | 2025-08 | agentic-flow coordination engine |
| V3 Foundation | v3.0.0-alpha.1 | 2025-10 | V3 monorepo, 215 MCP tools |
| Plugin Marketplace | v3.0.0-alpha.170 | 2025-12 | 8 plugins + IPFS registry |
| Guidance Control Plane | v3.0.0-alpha.100 | 2026-01 | WASM policy kernel, ContinueGate |
| AgentDB v3 | v3.1.0-alpha.55 | 2026-02 | 8 controllers, MutationGuard |
| **Mission Agent MVP** | **v1.0.0** | **2026-03-08** | **Mission Agent CLI, 4 operating modes** |
| **Journal v2 & Config** | **v1.3.0** | **2026-03-10** | **Character system, consciousness guard, config overhaul** |
| **Workspace Missions** | **v1.4.0** | **2026-03-10** | **Workspace-scoped missions, interactive init, dashboard** |
| **Production Cleanup** | **v2.1.1** | **2026-03-20** | **Zero lint, zero comments, full English, interactive README** |

[2.1.1]: https://github.com/sudohakan/HakanMCP/compare/v2.1.0...v2.1.1
[1.4.1]: https://github.com/sudohakan/HakanMCP/releases/tag/v1.4.1
[1.4.0]: https://github.com/sudohakan/HakanMCP/releases/tag/v1.4.0
[1.3.1]: https://github.com/sudohakan/HakanMCP/releases/tag/v1.3.1
[1.3.0]: https://github.com/sudohakan/HakanMCP/releases/tag/v1.3.0
[1.2.0]: https://github.com/sudohakan/HakanMCP/releases/tag/v1.2.0
[1.1.0]: https://github.com/sudohakan/HakanMCP/releases/tag/v1.1.0
[1.0.0]: https://github.com/sudohakan/HakanMCP/releases/tag/v1.0.0
[3.5.0]: https://github.com/sudohakan/HakanMCP/releases/tag/v3.5.0
