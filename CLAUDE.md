# HakanMCP — Claude Code Configuration

> MCP tool server for Claude Code. ESM, Node >= 20.

## Project Overview

HakanMCP is a STDIO Model Context Protocol server: one process exposing the
tools Claude Code reaches for (browser and Chrome DevTools, HTTP, SQL and
MongoDB, GitBook, system intelligence, disk, search, local transcription,
Ollama delegation), plus an on-demand catalog that connects to external
auth-free MCP servers at runtime instead of registering them permanently.

It used to carry a second role — a Mission Agent CLI with watch, scheduled,
assistant and reactive modes, and its own AI provider orchestration. Both were
removed in v3.0.0: the autonomy layer (`auto`, `claude-autonomy.timer`),
`/loop`, `/goal` and cron cover that ground, and Claude Code itself does the
model orchestration. The package has no `bin` entry; `npm start` runs the
server.

## Architecture

```
src/index.ts          Server entry (STDIO transport, ToolRegistry)
dist/src/index.js        What actually runs — single-file esbuild bundle
config.yaml           Runtime configuration (Zod-validated)
.env                  Secrets & env overrides (never committed)
```

Startup runs in three phases so the handshake is never blocked: the SDK
connects the transport first, tool modules load second, and heavy services
(backup, daily tool health check) are deferred to a `setImmediate` after
`tools/list` can already be served.

`ToolRegistry` registers core tools eagerly and feature tools (`db`, `mongo`)
lazily on first call when their native dependency is present. When a dependency
is missing the tool still appears in `tools/list` as a placeholder, so the
catalog a client sees does not change with the host's install state.

### The bundle is the point, not an optimization

The repo lives on `/mnt/c` (NTFS). Node resolving a dependency graph across the
WSL boundary dominates startup — every module is a separate cross-boundary
read, and the server used to answer `tools/list` in tens of seconds. One file
is one read. `npm run build` compiles with `tsc`, then bundles `src/index.ts`
into `dist/src/index.js` via `scripts/bundle.mjs`.

Native addons stay external: they load their own `.node` binaries at runtime
and cannot be inlined, and they are optional, so a missing one must stay a
resolve-time failure the placeholder path already handles.

Two things keep the bundle possible, and breaking either silently un-bundles
the server:
- **No template-literal imports.** `import('./tools/' + x + '.js')` is
  unresolvable at build time. The sysint dispatcher uses an explicit
  `CATEGORY_LOADERS` map; adding a category means adding a line.
- **JSON is imported, not read from disk.** `src/catalog/servers.json` and
  `chromeDevtools.tools.json` are static imports. A `readFileSync` against
  `__dirname` would both break bundling and resurrect the old two-step trap
  where editing the source left `dist/` stale and the server looked like it had
  lost a catalog entry.

Measure with `npm run measure:coldstart` — it reports the median of N runs,
because a single run on NTFS swings with the page cache.

## Directory Structure

```
src/
  index.ts              Server bootstrap & tool registration
  config.ts             YAML + env config loading, Zod validation
  toolRegistry.ts       Lazy-load tool registry with placeholder support
  dependencyResolver.ts Native dependency detection
  catalog/              On-demand MCP server catalog (servers.json)
  tools/                MCP tool modules (one file per domain)
  services/             backupService, toolHealthCheck, disk, sysint
  utils/                logger, httpClient, dbPoolManager, processRegistry, …
  types/                TypeScript type definitions
scripts/
  bundle.mjs            esbuild single-file bundle
  measure-coldstart.mjs Spawn-to-tools/list timing
  generate-tool-manifest.ts
data/sysint/catalog.json  sysint tool catalog (97 tools, 9 categories)
tests/                  Jest suite
```

## MCP Tools

13 modules → 46 tools. Most are action-multiplexed: one tool with an `action`
parameter rather than a tool per verb.

| Module | Tool Name(s) | Purpose |
|--------|--------------|---------|
| mcpClient.ts | `mcp`, `browser` | On-demand MCP bridge + Playwright browser automation |
| chromeDevtools.ts | `chrome_*` (29) | Chrome DevTools proxy — console, network, perf, DOM, JS eval, screenshot |
| http.ts | `http` | HTTP request, downloadFile |
| db.ts | `db` | SQL operations (feature tool, lazy-loaded) |
| mongodb.ts | `mongo` | MongoDB CRUD, aggregation, indexes (feature tool, lazy-loaded) |
| gitbook.ts | `gitbook` | GitBook API operations |
| sysint.ts | `sysint` | Cross-platform system intelligence (ports, drivers, USB, Wi-Fi, processes) |
| disk.ts | `disk` | Disk usage scan, duplicate find, temp/cache/log cleanup |
| cfbypass.ts | `cfbypass` | Cloudflare challenge bypass (FlareSolverr) |
| exaSearch.ts | `exaSearch`, `exaFindSimilar`, `exaGetContents` | Exa neural web search |
| ollamaChat.ts | `ollamaChat`, `ollamaListModels` | Local Ollama delegation |
| transcribeLocal.ts | `transcribeLocal` | Local faster-whisper STT (offline) |
| backup.ts | `backup` | Project backup/restore |

`mcpClient.ts` exposes only `mcp` + `browser`; the individual handlers in the
internal `_mcpLegacyTools` array are delegation targets, not registered tools.

### What is deliberately absent

Tools removed in v3.0.0 after six months of session history showed near-zero
use: `ai` / `ai_provider_chat` (Claude Code orchestrates models itself),
`env`, `cache`, `crypto`, `gdocs`, ElevenLabs audio, academic search,
`hermesDelegate`, and the sysint credential-reading category.

That last one is not only a usage call. The sysint credential-reading category
plus the `kali` catalog entry ("offensive security — recon, scanning,
exploitation") made the repo read as offensive-security tooling, and working on
it tripped the model safety classifier — the repo became unopenable with the
strongest model. Both are gone: the credential category is deleted, and `kali`
is no longer advertised in `src/catalog/servers.json`.

**Keep this repo free of offensive-security framing.** Pentest has its own
channel in the stack (the `kali-mcp-server` repo, the `pentest-*` agents, and a
direct `mcp.connect` with explicit command/args when genuinely needed) — it does
not belong in this server's catalog or tool set. Do not reintroduce the
credential category, the `kali` catalog row, a `shodan*` recon tool, or any tool
described in terms of exploitation, vulnerability scanning or credential
harvesting. `cfbypass` stays: it fetches Cloudflare-protected pages for
price-comparison scraping, which is ordinary web access, not evasion of a
security control.

### The bar for adding a tool

A new tool is a cost, not a default — each one spends context tokens in every
session that loads this server, and a native-backed one spends startup time.
Before adding one, it must clear this gate:

1. **Recurrence.** The need has shown up at least three times, not once. A
   one-off belongs in a script or an inline call, not a permanent tool.
2. **The catalog doesn't already cover it.** If an auth-free MCP server exists,
   add a line to `src/catalog/servers.json` and reach it with
   `mcp.connectFromCatalog` — that costs nothing until used. A new tool is only
   justified when no catalog server fits and the capability is genuinely this
   server's job (a thin wrapper over a backend it already owns, like `db` or
   `browser`).
3. **It isn't something Claude Code already does** (model orchestration, web
   fetch, file ops) or something with its own dedicated channel in the stack
   (pentest, email, Infoset).

If a candidate fails any point, it does not go in. Measure the dumb path first
(a script, a catalog line, an inline call) and only promote to a tool when that
path is demonstrably worse.

## Tech Stack

- **Runtime:** Node.js >= 20, ESM (`"type": "module"`)
- **Language:** TypeScript 5.x (`tsc -p tsconfig.build.json`)
- **Bundler:** esbuild (single-file server output)
- **MCP SDK:** `@modelcontextprotocol/sdk` (STDIO transport)
- **Config:** YAML (js-yaml) + Zod schema validation + dotenv
- **Logging:** Winston with daily-rotate-file
- **Testing:** Jest with ts-jest (experimental VM modules)
- **Optional native drivers:** pg, mysql2, mssql, sqlite3, better-sqlite3, mongodb

## Consumers

HCD (`/mnt/c/dev/hakans-claude-dashboard`) spawns this server over stdio
JSON-RPC from `packages/backend/src/lib/hakanmcp-client.ts` and discovers tools
dynamically through `tools/list` — it holds no hardcoded tool names. Changing
the tool set does not break it; changing the entry path or the stdio contract
would. The client points at `dist/src/index.js`.

Claude Code registers the server in both `.claude.json` files (WSL and
Windows). Cold start is charged on every session that loads it.

## Config

Unknown keys in `config.yaml` are dropped on load rather than rejected, so a
file carrying blocks from an older schema still boots. Live keys: `serverName`,
`logLevel`, `cacheTtl`, `retryCount`, `gitbookToken`, `mongoDbUrl`, `github`,
`monitoring`, `backup`, `system`.

## Coding Conventions

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER proactively create documentation files unless explicitly requested
- NEVER save working files or tests to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Use `src/` for source, `tests/` for tests, `scripts/` for build scripts
