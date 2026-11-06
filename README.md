<div align="center">

# HakanMCP

**One STDIO MCP server for Claude Code that bundles browser, HTTP, database, search, system and delegation tools.**

[![CI](https://github.com/sudohakan/HakanMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/sudohakan/HakanMCP/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/sudohakan/HakanMCP?style=flat-square)](https://github.com/sudohakan/HakanMCP/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square)](https://www.typescriptlang.org)

</div>

## Features

- **Many tools, one process**: browser and Chrome DevTools automation, HTTP, SQL and MongoDB, GitBook, system intelligence, disk, neural web search, local transcription, Ollama delegation. Most are action-multiplexed: one tool, an `action` parameter.
- **On-demand server catalog**: connect git, filesystem, sqlite, duckdb, playwright, markitdown and more at runtime instead of registering each one permanently.
- **Low-token browser bridge**: drive Chrome through wrappers instead of returning large raw snapshots.
- **Lazy native drivers**: SQL and Mongo drivers load on first call; a missing one stays a placeholder, not a crash.
- **Single-file bundle**: one `dist/src/index.js`, one file read instead of a module graph, which is what startup is paid in on NTFS.

## Installation

Prerequisites: Node.js 20 or newer, npm, and git.

```bash
git clone https://github.com/sudohakan/HakanMCP.git
cd HakanMCP
npm install
npm run build
```

The build produces `dist/src/index.js`, the file the MCP client runs. Register it with Claude Code using its absolute path:

```bash
claude mcp add hakanmcp node /absolute/path/to/HakanMCP/dist/src/index.js
```

Or add it to another MCP client's config by hand (Claude Desktop, Cursor, ...):

```json
{
  "mcpServers": {
    "hakanmcp": {
      "command": "node",
      "args": ["/absolute/path/to/HakanMCP/dist/src/index.js"]
    }
  }
}
```

Verify with `claude mcp list` (it should show `hakanmcp` connected), or call the `health` tool.

### Configuration

Optional. The server runs with no setup. For tools that need a key or an external service, copy `.env.example` to `.env` and fill in only what you need:

- `gitbook`: `GITBOOK_TOKEN`
- `exaSearch`: `EXA_API_KEY`
- `cfbypass`: a running FlareSolverr container (the tool description prints the `docker run` command)
- `ollamaChat`: a local Ollama instance
- `teams`: the teams-browser CLI (`TEAMS_BROWSER_CLI`)
- `gitbook` git sync: `GITBOOK_SYNC_REPO`; catalog servers that run from a local checkout: `INFOSET_MCP_DIR`, `GTASKS_MCP_DIR`
- `db` / `mongo`: install the matching driver (`npm install pg`, `mongodb`, ...); until then the tool shows as a placeholder.

## Usage

| Module | Tool(s) | Purpose |
|---|---|---|
| mcpClient | `mcp`, `browser` | On-demand MCP bridge + Playwright browser automation |
| chromeDevtools | `chrome_*` | Console, network, performance, DOM, JS eval, screenshot |
| http | `http` | HTTP request, file download |
| db | `db` | SQL (Postgres/MySQL/MSSQL/SQLite), lazy-loaded |
| mongodb | `mongo` | MongoDB CRUD, aggregation, indexes, lazy-loaded |
| gitbook | `gitbook` | GitBook API |
| sysint | `sysint` | Cross-platform system intelligence (ports, drivers, USB, Wi-Fi, processes) |
| disk | `disk` | Usage scan, duplicate find, temp/cache/log cleanup |
| cfbypass | `cfbypass` | Cloudflare challenge bypass (FlareSolverr) |
| exaSearch | `exaSearch`, `exaFindSimilar`, `exaGetContents` | Exa neural web search |
| ollamaChat | `ollamaChat`, `ollamaListModels` | Local Ollama delegation |
| transcribeLocal | `transcribeLocal` | Offline faster-whisper speech to text |
| teams | `teams` | The user's own Teams: chats, calendar, calls, files, search, to-do, presence; changes return a draft until confirmed |
| backup | `backup` | Project backup and restore |
| health | `health` | Self-check: native drivers, backend liveness, build mode, uptime, tool error rate |

Native drivers (`pg`, `mysql2`, `mssql`, `sqlite3`, `better-sqlite3`, `mongodb`) are optional. When one is absent its tool still appears in `tools/list` as a placeholder, so the catalog does not shift with the host's install state.

### Development

```bash
npm run build              # tsc, esbuild bundle, tool manifest
npm test                   # Jest
npm run measure:coldstart  # spawn-to-tools/list median
```

| Script | Does |
|---|---|
| `build` | Typecheck, bundle to `dist/src/index.js`, regenerate tool manifest |
| `bundle` | esbuild only |
| `start` | Run `dist/src/index.js` |
| `test` | Jest suite |
| `lint` / `format` | ESLint / Prettier |

Adding a tool module: add a static loader line in `src/index.ts` `TOOL_MODULES`. Adding an on-demand catalog server: edit `src/catalog/servers.json` (a static import, no separate copy-to-`dist` step).

`package.json` `overrides` pins `@azure/msal-node` to `^7.1.1`. It is not a direct dependency: `mssql`, `tedious` and `@azure/identity` pull it in for Azure AD auth, and `@azure/identity` asks for `^6`, which carries a high-severity advisory (GHSA-xcx6-jx8p-x3h5, fails `npm audit --audit-level=high` in CI). Drop the override once `@azure/identity` ships with msal-node 7.

## Project structure

```
src/index.ts        server entry (STDIO transport, ToolRegistry)
src/catalog/        on-demand server catalog (servers.json)
dist/src/index.js   what runs: single-file esbuild bundle
config.yaml         runtime config (Zod-validated; unknown keys dropped, not rejected)
tests/              Jest suite
```

Startup is three-phased: the SDK connects the transport first, tool modules load second, and heavy services (backup, daily health check) are deferred until after `tools/list` can be served, so the handshake is never blocked.

The server ships as a single bundle because it lives on NTFS, where resolving a module graph across the filesystem boundary dominates startup. Keeping it bundleable has two rules: no `import(variable)` specifiers (use a static loader map), and import JSON rather than reading it from disk.

## License

MIT, see [LICENSE](LICENSE).
