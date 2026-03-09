# HakanMCP — Claude Code Configuration

> Unified MCP Server + Mission Agent CLI. v1.3.0, ESM, Node >= 20.

## Project Overview

HakanMCP serves two roles:
1. **MCP Server** — STDIO-based Model Context Protocol server with 131 tools for Claude Code
2. **Mission Agent CLI** — Autonomous task execution via markdown mission files with 4 operating modes (Watch, Scheduled, Assistant, Reactive)

## Architecture

```
src/index.ts          MCP Server entry (STDIO transport, ToolRegistry)
bin/hakanmcp.ts       CLI entry (Commander.js)
config.yaml           Runtime configuration (Zod-validated)
.env                  Secrets & env overrides (never committed)
```

The MCP server uses a `ToolRegistry` with lazy loading: core tools are eagerly registered, feature tools (db, mongo, git) load on first call if native deps are available. Placeholder metadata is registered when deps are missing so `tools/list` always returns the full catalog.

## Directory Structure

```
src/
  index.ts              MCP server bootstrap & tool registration
  config.ts             YAML + env config loading, Zod validation
  toolRegistry.ts       Lazy-load tool registry with placeholder support
  dependencyResolver.ts Native dependency detection
  tools/                MCP tool modules (one file per domain)
  services/             Business logic (agentic loop, backup, cache, consciousness, etc.)
  utils/                Shared utilities (logger, httpClient, dbPoolManager, etc.)
  types/                TypeScript type definitions
  cli/                  CLI command handlers (init, start, stop, mission, report, watch, scheduled, reactive)
  mission/              Mission loading, running, state tracking, report generation
  watch/                File watcher mode (chokidar-based)
  scheduled/            Cron/interval scheduled execution
  reactive/             Unified event bus combining watch + scheduled
  flows/                Flow execution runner
bin/
  cli.ts                Compiled CLI entry point
  hakanmcp.ts           Premium CLI with gradient UI (Commander.js)
tests/                  Jest test suite
scripts/          Build scripts (tool manifest generator)
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `hakanmcp init` | Initialize workspace (config + mission templates) |
| `hakanmcp start [--daemon]` | Start mission agent (foreground or background) |
| `hakanmcp stop` | Stop running agent |
| `hakanmcp mission` | Show current mission status |
| `hakanmcp report [-n N]` | Show recent execution reports |
| `hakanmcp watch` | File watcher mode |
| `hakanmcp scheduled` | Cron/interval task mode |
| `hakanmcp reactive` | Combined watch + scheduled mode |
| `hakanmcp chat` | Interactive AI chat with mission context |

## MCP Tools (src/tools/)

| Module | Tool Prefix | Purpose |
|--------|-------------|---------|
| gitbook.ts | `gb_` | GitBook API integration (search, pages, headings, links) |
| postman.ts | `pm_` | Postman collection/request management |
| system.ts | `sys_` | OS info, process management, run commands |
| systemOptimization.ts | `sysopt_` | System cleanup, optimization, admin ops |
| http.ts | `http_` | HTTP requests, file downloads |
| env.ts | `env_` | Environment variable management |
| parser.ts | `parse` | CSV/JSON/XML/YAML parsing |
| template.ts | `compile_template` | Handlebars template compilation |
| aiTools.ts | `ai_` | AI chat with agentic tool-use loop |
| aiProviders.ts | `ai_provider_` | Multi-provider AI routing (Claude/OpenAI/Gemini/Ollama) |
| aiDefence.ts | `aidefence` | Input scanning, PII detection |
| backup.ts | `backup` | Project backup/restore |
| cache.ts | `cache_` | In-memory cache management |
| db.ts | `db_` | SQL database operations (PostgreSQL, MySQL, MSSQL, SQLite) |
| dbMonitoring.ts | `db_` | Database pool stats, monitoring |
| mongodb.ts | `mongo_` | MongoDB CRUD, aggregation, indexes |
| git.ts | `git_` | Git operations (add, commit, checkout, sync) |
| github.ts | `github_` | GitHub repo management (create, push, pull) |
| encryption.ts | `crypto_` | File/value encryption |
| monitoring.ts | `monitor_` | Health checks, auto-heal, peer sync |
| selfImprovement.ts | `self_` | Self-modification proposals |
| scheduler.ts | `scheduler_` | Cron task scheduling |
| api.ts | `api_` | Rate limiting, webhook handling |
| performance.ts | `perf_` | Benchmarking |
| dx.ts | `dx_` | Developer experience (tool scaffolding) |
| flow.ts | `flow_` | Multi-step flow execution & versioning |
| knowledgeGraph.ts | `kg_` | Entity/relation knowledge graph |
| swarm.ts | `swarm_` | Multi-agent coordination |
| consensus.ts | `consensus_` | Distributed consensus protocols |
| ruvector.ts | `ruvector_` | Vector similarity search |
| moeRouter.ts | `moe_` | Mixture-of-experts routing |
| guidance.ts | `guidance_` | Code guidance rules, auditing |
| mcpClient.ts | `mcp_` | MCP-to-MCP bridge (connect to other MCP servers) |

Feature tools (`db`, `mongo`, `git`) require optional native dependencies — they register as placeholders when deps are missing.

## Tech Stack

- **Runtime:** Node.js >= 20, ESM (`"type": "module"`)
- **Language:** TypeScript 5.x (compiled via `tsc -p tsconfig.build.json`)
- **MCP SDK:** `@modelcontextprotocol/sdk` (STDIO transport)
- **CLI Framework:** Commander.js with chalk, boxen, ora, gradient-string
- **Config:** YAML (js-yaml) + Zod schema validation + dotenv
- **Logging:** Winston with daily-rotate-file
- **Testing:** Jest with ts-jest (experimental VM modules)
- **Linting:** ESLint + Prettier + lint-staged
- **Optional DB Drivers:** pg, mysql2, mssql, sqlite3, mongodb (lazy-loaded)
- **Optional:** simple-git for git tools

## Coding Conventions

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER proactively create documentation files unless explicitly requested
- NEVER save working files or tests to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Use `src/` for source, `tests/` for tests, `scripts/` for build scripts
- All tool modules export an array of `ToolDefinition` objects
- Handler functions return `{ content: [{ type: 'text', text: string }], isError?: boolean }`
- Config changes go through `updateConfig()` which validates and atomically writes

## Environment Variables (.env)

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub API access (required if github tools enabled) |
| `CODEX_API_KEY` / `OPENAI_API_KEY` | OpenAI API key |
| `CLAUDE_CODE_API_KEY` / `ANTHROPIC_API_KEY` | Anthropic API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `AI_KEY_PASSWORD` | Decrypt encrypted API keys in config.yaml |
| `LOG_LEVEL` / `HAKANMCP_LOG_LEVEL` | Override log level (debug/info/warn/error/none) |
| `CACHE_TTL` / `HAKANMCP_CACHE_TTL` | Override cache TTL in seconds |
| `GITBOOK_URL` | GitBook instance URL |
| `MONITORING_PEER_INSTANCE` | Peer instance path for guardian sync |
| `SCHEDULER_ENABLED` | Enable/disable scheduler |
| `HAKANMCP_PROJECT_ROOT` | Override detected project root |

## Repository Cleanliness

- NEVER commit generated artifacts, test outputs, or temp files to the repo
- All test artifacts must use `fs.mkdtempSync()` for temp directories (no predictable paths)
- Runtime state files (`.ai-provider-*.json`, `scheduler-state.json`, logs/) are gitignored — never commit them
- Before adding new directories, check `.gitignore` and add entries for any generated/runtime content
- Periodically audit for dead code, unused placeholders, and orphaned files — remove them promptly
- Empty directories without a clear documented purpose should be removed

## Config Change Rule

When modifying config schema (`src/config.ts`), config.yaml defaults, or adding/removing config fields:
1. Update `CONFIG_INFO` in `bin/hakanmcp.ts` — the `config info <category>` descriptions must reflect current fields
2. Update the status board display in `runStatus()` if the field is user-visible
3. Ensure `config.yaml.example` has the new field with a sensible default
4. If a config field exists in schema but is never read at runtime, either wire it up or remove it
5. If the field is overridable via `.env`, ensure it exists in both `.env.example` and `config.yaml.example`

## CLI Change Rule

When adding, removing, or renaming CLI commands or subcommands:
1. Update the help menu in `bin/hakanmcp.ts` (`showHelp()` function) — every command must appear
2. Update the CLI Commands table in this file (`CLAUDE.md`)
3. If a command has category-level info (e.g. `config info`), update the corresponding `CONFIG_INFO` or similar constant

## Build & Run

```bash
npm run build          # TypeScript compile + generate tool manifest
npm run dev            # Run with ts-node (development)
npm start              # Run compiled server
npm test               # Run Jest test suite
npm run check:quick    # Build + smoke tests
```
