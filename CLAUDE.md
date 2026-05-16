# HakanMCP — Claude Code Configuration

> Unified MCP Server + Mission Agent CLI. v2.2.1, ESM, Node >= 20.

## Project Overview

HakanMCP serves two roles:
1. **MCP Server** — STDIO-based Model Context Protocol server with 63 tools for Claude Code + on-demand MCP catalog (9 auth-free servers)
2. **Mission Agent CLI** — Autonomous task execution via markdown mission files with 4 operating modes (Watch, Scheduled, Assistant, Reactive)

## Architecture

```
src/index.ts          MCP Server entry (STDIO transport, ToolRegistry)
bin/hakanmcp.ts       CLI entry (Commander.js)
config.yaml           Runtime configuration (Zod-validated)
.env                  Secrets & env overrides (never committed)
```

The MCP server uses a `ToolRegistry` with lazy loading: core tools are eagerly registered, feature tools (db, mongo) load on first call if native deps are available. Placeholder metadata is registered when deps are missing so `tools/list` always returns the full catalog. An on-demand MCP catalog (`src/catalog/servers.json`) allows dynamic connections to external auth-free MCP servers (git, filesystem, memory, etc.).

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
  cli/                  CLI command handlers
    cliUtils.ts         Shared rendering utilities (headers, dividers)
    configValidator.ts  Workspace config schema (Zod) with WorkspaceEntrySchema
    initCommand.ts      Interactive workspace setup (@inquirer/prompts)
    missionCommand.ts   Workspace dashboard & detailed status
    startCommand.ts     Workspace execution modes (--workspace, --all, --parallel)
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
| `hakanmcp init` | Interactive workspace setup (config + mission via Q&A) |
| `hakanmcp init --remove <name>` | Remove a workspace (config, files, state) |
| `hakanmcp start` | Start mission agent (default workspace) |
| `hakanmcp start --workspace <name>` | Start specific workspace |
| `hakanmcp start --all` | Start all workspaces |
| `hakanmcp stop` | Stop running agent |
| `hakanmcp mission` | Workspace dashboard (all workspaces overview) |
| `hakanmcp mission --workspace <name>` | Detailed status for one workspace |
| `hakanmcp report [-n N]` | Show recent execution reports |
| `hakanmcp watch` | File watcher mode |
| `hakanmcp scheduled` | Cron/interval task mode |
| `hakanmcp reactive` | Combined watch + scheduled mode |
| `hakanmcp doctor` | Health check (version, build, config, tools) |
| `hakanmcp doctor fix` | AI-driven auto-repair |
| `hakanmcp health` | Alias for doctor |
| `hakanmcp status` | Status dashboard (version, uptime, backup) |
| `hakanmcp tools` | List registered MCP tools (reads `dist/tool-manifest.json`) |
| `hakanmcp backup [run]` | Backup info / force a backup |
| `hakanmcp config [yaml [help]]` | View/edit config.yaml |
| `hakanmcp journal` | Consciousness journal entries |
| `hakanmcp providers` | AI provider status |
| `hakanmcp ralph` | Ralph autonomous loop control |
| `hakanmcp logs` | Tail server logs |

Interactive menu: run `hakanmcp` with no args.

### CLI Launcher (Windows)

The CLI needs **Node >= 18** (`import ... with { type: 'json' }`). The user's
nvm4w default is `16.20.2` (Finekra React builds), so the npm-generated
`hakanmcp.cmd`/`.ps1` shims in `%APPDATA%\npm` are repointed to a fixed
Node 24 install — they do not follow the nvm-active version:

```
"C:\Users\Hakan\AppData\Local\nvm\v24.11.1\node.exe" "C:\dev\HakanMCP\dist\bin\cli.js" %*
```

After `npm install -g .` (which regenerates npm's ambient-Node shims),
re-apply the Node-24 pin to `hakanmcp.cmd` and `hakanmcp.ps1`.

## MCP Tools (src/tools/)

23 modules → 63 registered tools. Most are action-multiplexed (one tool, `action` parameter).

| Module | Tool Name(s) | Purpose |
|--------|--------------|---------|
| gitbook.ts | `gitbook` | GitBook API operations (listSpaces, getPage, updatePage, search...) |
| http.ts | `http` | HTTP request, downloadFile |
| env.ts | `env` | Environment variable management |
| aiTools.ts | `ai` | AI chat, generate, listModels, history |
| aiProviders.ts | `ai_provider_chat` | Multi-provider AI routing (codex/claude/gemini) |
| backup.ts | `backup` | Project backup/restore |
| cache.ts | `cache` | In-memory cache (get, set, delete, clear, stats) |
| encryption.ts | `crypto` | File/value encryption |
| disk.ts | `disk` | Disk usage scan, duplicate find, temp/cache/log cleanup |
| sysint.ts | `sysint` | Cross-platform native system intelligence (ports, drivers, USB, Wi-Fi, processes) |
| cfbypass.ts | `cfbypass` | Cloudflare challenge bypass (FlareSolverr) |
| chromeDevtools.ts | `chrome_*` (29) | Chrome DevTools proxy — console, network, perf, DOM, JS eval, screenshot |
| exaSearch.ts | `exaSearch`, `exaFindSimilar`, `exaGetContents` | Exa neural web search |
| academicSearch.ts | `arxivSearch`, `semanticScholarSearch`, `paperDetails` | Academic paper search |
| elevenlabs.ts | `ttsGenerate`, `listVoices`, `transcribe`, `voiceClone` | ElevenLabs TTS / STT / voice clone |
| shodanRecon.ts | `shodanHostInfo`, `shodanSearch`, `shodanDnsResolve` | Shodan recon |
| ollamaChat.ts | `ollamaChat`, `ollamaListModels` | Local Ollama delegation |
| transcribeLocal.ts | `transcribeLocal` | Local faster-whisper STT (offline) |
| hermesDelegate.ts | `hermesDelegate`, `hermesStatus` | Hermes Agent task delegation |
| googleDocs.ts | `gdocs` | Google Docs operations |
| mcpClient.ts | `mcp`, `browser` | On-demand MCP bridge + Playwright browser automation (action-multiplexed) |
| db.ts | `db` | SQL database operations (feature tool, lazy-loaded) |
| mongodb.ts | `mongo` | MongoDB CRUD, aggregation, indexes (feature tool, lazy-loaded) |

Feature tools (`db`, `mongo`) require optional native dependencies — they register as placeholders when deps are missing.

`mcpClient.ts` exposes only `mcp` + `browser`; the individual `mcp_*` / `mcp_browser*` handlers in the internal `_mcpLegacyTools` array are implementation targets the two multiplexed tools delegate to — they are not registered as MCP tools.

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
