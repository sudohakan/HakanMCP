<div align="center">

# HakanMCP

**MCP tool server for Claude Code**

46 MCP tools · on-demand server catalog · single-file bundle

[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square)](https://www.typescriptlang.org)

[Install](#install) · [Tools](#tools) · [Architecture](#architecture) · [Development](#development)

</div>

---

## What it does

HakanMCP is a single STDIO Model Context Protocol server. It exposes the tools
an MCP client reaches for — browser and Chrome DevTools automation, HTTP, SQL
and MongoDB, GitBook, system intelligence, disk, neural web search, local
transcription, Ollama delegation — behind one process, plus a catalog that
connects to external auth-free MCP servers at runtime instead of registering
each one permanently.

| What you get | Details |
|:---|:---|
| **46 MCP tools, 13 modules** | Most are action-multiplexed — one tool, an `action` parameter |
| **On-demand server catalog** | Connect git, filesystem, sqlite, duckdb, playwright, markitdown and more at runtime |
| **Low-token browser bridge** | Drive Chrome through wrappers instead of returning large raw snapshots |
| **Lazy native drivers** | SQL/Mongo drivers load on first call; a missing one stays a placeholder, not a crash |
| **Single-file bundle** | One `dist/src/index.js` — one file read instead of a module graph, which is what startup is paid in on NTFS |

---

## Install

Register with Claude Code:

```bash
claude mcp add hakanmcp node /path/to/HakanMCP/dist/src/index.js
```

Or add to your client config:

```json
{
  "mcpServers": {
    "hakanmcp": {
      "command": "node",
      "args": ["/path/to/HakanMCP/dist/src/index.js"]
    }
  }
}
```

Build first: `npm install && npm run build`.

---

## Tools

| Module | Tool(s) | Purpose |
|:---|:---|:---|
| mcpClient | `mcp`, `browser` | On-demand MCP bridge + Playwright browser automation |
| chromeDevtools | `chrome_*` (29) | Console, network, performance, DOM, JS eval, screenshot |
| http | `http` | HTTP request, file download |
| db | `db` | SQL (Postgres/MySQL/MSSQL/SQLite), lazy-loaded |
| mongodb | `mongo` | MongoDB CRUD, aggregation, indexes, lazy-loaded |
| gitbook | `gitbook` | GitBook API |
| sysint | `sysint` | Cross-platform system intelligence (ports, drivers, USB, Wi-Fi, processes) |
| disk | `disk` | Usage scan, duplicate find, temp/cache/log cleanup |
| cfbypass | `cfbypass` | Cloudflare challenge bypass (FlareSolverr) |
| exaSearch | `exaSearch`, `exaFindSimilar`, `exaGetContents` | Exa neural web search |
| ollamaChat | `ollamaChat`, `ollamaListModels` | Local Ollama delegation |
| transcribeLocal | `transcribeLocal` | Offline faster-whisper STT |
| backup | `backup` | Project backup/restore |

Native drivers (`pg`, `mysql2`, `mssql`, `sqlite3`, `better-sqlite3`, `mongodb`)
are optional. When one is absent its tool still appears in `tools/list` as a
placeholder, so the catalog does not shift with the host's install state.

---

## Architecture

```
src/index.ts          Server entry (STDIO transport, ToolRegistry)
dist/src/index.js        What runs — single-file esbuild bundle
config.yaml           Runtime config (Zod-validated; unknown keys dropped, not rejected)
```

Startup is three-phased: the SDK connects the transport first, tool modules
load second, and heavy services (backup, daily health check) are deferred until
after `tools/list` can be served, so the handshake is never blocked.

The server ships as a single bundle because it lives on NTFS, where resolving a
module graph across the filesystem boundary dominates startup. Keeping it
bundleable has two rules: no `import(variable)` specifiers (use a static loader
map), and import JSON rather than reading it from disk. `npm run measure:coldstart`
reports spawn-to-`tools/list` timing.

---

## Development

```bash
npm install
npm run build              # tsc → esbuild bundle → tool manifest
npm test                   # Jest
npm run measure:coldstart  # spawn-to-tools/list median
```

| Script | Does |
|:---|:---|
| `build` | Typecheck, bundle to `dist/src/index.js`, regenerate tool manifest |
| `bundle` | esbuild only |
| `start` | Run `dist/src/index.js` |
| `test` | Jest suite |
| `lint` / `format` | ESLint / Prettier |

Adding a tool module: add a static loader line in `src/index.ts` `TOOL_MODULES`.
Adding an on-demand catalog server: edit `src/catalog/servers.json` (a static
import — no separate copy-to-`dist` step).

---

## License

MIT
