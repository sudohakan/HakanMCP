# HakanMCP — Architecture

This document describes the system design, directory structure, tool registration, configuration, and runtime behavior of HakanMCP.

## High-Level Overview

HakanMCP is a Model Context Protocol (MCP) server that exposes **203 tools** to AI agents over STDIO transport. It also ships a standalone CLI (`hakanmcp`) for interactive chat and administration.

```
                 ┌──────────────────────────────┐
                 │   AI Client (Claude Desktop, │
                 │   Claude Code, Cursor, etc.) │
                 └──────────┬───────────────────┘
                            │ STDIO (JSON-RPC)
                            v
                 ┌──────────────────────────────┐
                 │   MCP Server (index.ts)      │
                 │   - tools/list               │
                 │   - tools/call               │
                 │   - withLogging wrapper       │
                 └──────────┬───────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          v                 v                  v
   ┌─────────────┐  ┌─────────────┐   ┌─────────────┐
   │  27 Tool    │  │  Services   │   │  Utilities  │
   │  Modules    │  │  (backup,   │   │  (logger,   │
   │  (203 tools)│  │  cache,     │   │  dbPool,    │
   │             │  │  scheduler) │   │  httpClient)│
   └─────────────┘  └─────────────┘   └─────────────┘
```

---

## Directory Structure

```
HakanMCP/
├── bin/
│   └── hakanmcp.ts              # CLI entry point (Commander.js)
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── config.ts                # YAML config loader with Zod validation
│   ├── tools/                   # 27 tool modules (203 tools total)
│   │   ├── aiProviders.ts       # Claude Code, Codex, Gemini direct API calls
│   │   ├── aiTools.ts           # Multi-provider AI chat with conversation history
│   │   ├── api.ts               # OpenAPI spec, rate limits, webhooks
│   │   ├── backup.ts            # ZIP backup create/list/restore/stats
│   │   ├── cache.ts             # In-memory key-value cache (node-cache)
│   │   ├── db.ts                # PostgreSQL, MySQL, MSSQL, SQLite
│   │   ├── dbMonitoring.ts      # Query duration tracking and slow query detection
│   │   ├── dx.ts                # Developer experience (scaffold, hot reload tips)
│   │   ├── encryption.ts        # AES-256-GCM encrypt/decrypt values and files
│   │   ├── env.ts               # Environment variable management
│   │   ├── flow.ts              # Workflow/recipe engine with versioning + connections
│   │   ├── git.ts               # Git operations via simple-git
│   │   ├── gitbook.ts           # GitBook page fetch, search, headings
│   │   ├── github.ts            # GitHub remote setup, push, pull, repo creation
│   │   ├── http.ts              # HTTP client with auth helpers
│   │   ├── knowledgeGraph.ts    # In-memory entity/relation graph
│   │   ├── mcpClient.ts         # Connect to and call other MCP servers
│   │   ├── mongodb.ts           # MongoDB CRUD, aggregation, indexing
│   │   ├── monitoring.ts        # Cross-instance health, auto-heal, sync
│   │   ├── parser.ts            # YAML/JSON/XML/CSV parsing and conversion
│   │   ├── performance.ts       # CPU benchmark
│   │   ├── postman.ts           # Postman collection CRUD and execution
│   │   ├── scheduler.ts         # Cron-based task scheduling
│   │   ├── selfImprovement.ts   # Controlled code modification with approval
│   │   ├── system.ts            # File system ops, process management, system info
│   │   ├── systemOptimization.ts# Windows system optimization (16 tools)
│   │   └── template.ts          # Handlebars template render/compile
│   ├── services/
│   │   ├── aiProviderCooldown.ts    # Rate limit cooldown tracking per provider
│   │   ├── aiProviderWarmup.ts      # Provider order warmup + last-success caching
│   │   ├── aiRouteLogger.ts         # AI provider route selection logging
│   │   ├── backupService.ts         # Automatic backup scheduling and management
│   │   ├── cacheService.ts          # In-memory cache layer (node-cache)
│   │   ├── conversationHistory.ts   # Conversation persistence (JSONL on disk)
│   │   ├── characterProfile.ts      # AI character/persona configuration
│   │   ├── chatSettings.ts          # CLI chat settings (Ollama, API keys)
│   │   ├── common.ts               # deepMerge, atomicWriteFileSync, path safety
│   │   ├── connections.ts           # Flow engine connection/secret storage
│   │   ├── dbPoolManager.ts         # Database connection pool management
│   │   ├── httpClient.ts            # Shared HTTP client with retry logic
│   │   ├── logger.ts               # Winston-based structured logger
│   │   ├── peerSync.ts             # Cross-instance file synchronization
│   │   └── toolFactory.ts          # Tool definition helper/factory
│   └── utils/                       # (alias: some utils also in services/)
├── scripts/
│   ├── console_chat.ts          # Interactive chat script (used by CLI)
│   ├── status_board.ts          # Status dashboard script
│   ├── quick_status.ts          # Quick status check
│   ├── doctor.js                # Health check diagnostics
│   └── observe_24h.js           # 24-hour metrics observation
├── tests/                       # Jest test suites
├── config.yaml                  # Runtime configuration (Zod-validated)
├── .env                         # Environment secrets
├── package.json                 # Project metadata, scripts, dependencies
├── tsconfig.build.json          # TypeScript build configuration
└── tsconfig.json                # TypeScript base configuration
```

---

## Entry Points

### MCP Server (`src/index.ts`)

The primary entry point. Starts an MCP server using `@modelcontextprotocol/sdk` with `StdioServerTransport`.

**Startup sequence:**
1. Imports and aggregates all 27 tool modules into a single `allTools` array
2. Wraps every tool handler with `withLogging()` (structured logging + configurable timeout)
3. Registers `tools/list` and `tools/call` MCP request handlers
4. Loads conversation history from disk
5. Syncs Ollama model list to `config.yaml` (main instance only)
6. Starts the automatic backup service
7. Starts the Guardian loop for cross-instance monitoring
8. Registers graceful shutdown handlers (SIGINT, SIGTERM)

### CLI (`bin/hakanmcp.ts`)

A premium terminal UI built with Commander.js, Chalk, Boxen, Ora, and gradient-string. Features animated ASCII art logo, gradient themes, and boxed output.

**Available modes:**
- Default/`chat` -- Interactive AI chat with multi-provider routing
- `--cli` / `-c` -- Use CLI/API providers only (no MCP)
- `--direct` / `-d "prompt"` -- One-shot query
- Subcommands: `doctor`, `tools`, `status`, `backup`, `config`, `limits`, `logs`, `ralph`

---

## Tool System

### Module Structure

Each tool module in `src/tools/` exports an array of tool definitions:

```typescript
export const exampleTools = [
  {
    name: 'tool_name',
    description: 'What the tool does',
    inputSchema: {
      type: 'object',
      properties: { /* JSON Schema */ },
      required: ['param1'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({ /* Zod schema */ }).parse(args);
      // ... implementation
      return {
        content: [{ type: 'text', text: 'result' }],
      };
    },
  },
];
```

### 27 Tool Modules

| Module | File | Tools | Category |
|--------|------|-------|----------|
| `aiTools` | `aiTools.ts` | 5 | AI Chat & Generation |
| `aiProviderTools` | `aiProviders.ts` | 3 | AI Provider Direct Access |
| `dbTools` | `db.ts` | 18 | Database (PG/MySQL/MSSQL/SQLite) |
| `mongoTools` | `mongodb.ts` | 14 | MongoDB |
| `gitTools` | `git.ts` | 11 | Git Operations |
| `githubTools` | `github.ts` | 5 | GitHub Integration |
| `httpTools` | `http.ts` | 6 | HTTP Client |
| `systemTools` | `system.ts` | 17 | Filesystem & System |
| `systemOptimizationTools` | `systemOptimization.ts` | 16 | Windows System Optimization |
| `backupTools` | `backup.ts` | 7 | Backup Management |
| `schedulerTools` | `scheduler.ts` | 10 | Task Scheduling (cron) |
| `monitoringTools` | `monitoring.ts` | 7 | Instance Monitoring & Healing |
| `cacheTools` | `cache.ts` | 5 | In-Memory Cache |
| `envTools` | `env.ts` | 6 | Environment Variables |
| `encryptionTools` | `encryption.ts` | 4 | AES-256-GCM Encryption |
| `parserTools` | `parser.ts` | 6 | Data Format Parsing |
| `templateTools` | `template.ts` | 2 | Handlebars Templates |
| `gitbookTools` | `gitbook.ts` | 7 | GitBook Integration |
| `postmanTools` | `postman.ts` | 10 | Postman Collections |
| `mcpClientTools` | `mcpClient.ts` | 5 | MCP Client |
| `flowTools` | `flow.ts` | 11 | Flow/Recipe Orchestration + Connections |
| `knowledgeGraphTools` | `knowledgeGraph.ts` | 9 | Knowledge Graph |
| `selfImprovementTools` | `selfImprovement.ts` | 3 | Self-Improvement |
| `dbMonitoringTools` | `dbMonitoring.ts` | 4 | Database Query Monitoring |
| `apiTools` | `api.ts` | 4 | REST API / OpenAPI / Webhooks |
| `dxTools` | `dx.ts` | 2 | Developer Experience |
| `performanceTools` | `performance.ts` | 1 | Benchmarking |

### Tool Naming Convention

Tools use a `prefix_actionTarget` pattern:
- `db_queryPostgres` -- Database category, query action, Postgres target
- `git_status` -- Git category, status action
- `mongo_find` -- MongoDB category, find action
- `fs_readFile` -- Filesystem category, readFile action
- `sys_runCommand` -- System category, runCommand action

### Validation Pattern

Every tool uses **Zod** for runtime input validation. Invalid inputs are rejected before the handler executes.

### withLogging Wrapper

All tools are wrapped with `withLogging()` which provides:
- Structured logging via Winston (tool name, args, success/failure)
- Configurable timeout (`system.commandTimeout` in config.yaml, default 60s)
- Promise.race between the handler and a timeout rejection

---

## AI Provider System

### Multi-Provider Routing

The AI system implements a waterfall strategy with automatic failover:

```
Phase 1 - CLI Providers (in warmed order):
  Codex CLI -> Claude CLI -> Gemini CLI -> Cursor CLI

Phase 2 - API Providers (with API keys):
  Codex API -> Claude API -> Gemini API

Phase 3 - Local Fallback:
  Ollama (configurable models with retry chain)
```

### Provider Components

| Component | File | Purpose |
|-----------|------|---------|
| `aiTools.ts` | `src/tools/` | Main AI tools (ai_chat, ai_generate, etc.) |
| `aiProviders.ts` | `src/tools/` | Direct provider access + API key resolution |
| `aiProviderCooldown.ts` | `src/services/` | Rate limit detection and cooldown management |
| `aiProviderWarmup.ts` | `src/services/` | Provider order warmup (prioritize last success) |
| `conversationHistory.ts` | `src/services/` | Persistent conversation state |

### Cooldown & Rate Limit Handling

When a provider hits a rate limit:
1. Parses the limit message for a cooldown duration
2. Sets the provider in cooldown (skipped in future calls until expiry)
3. Falls through to the next provider in the chain
4. CLI and API limits tracked separately with daily/weekly counters

---

## Services Layer

### backupService
Automatic ZIP backup system. Configurable interval (default 6h) and retention (default 72h). Excludes `node_modules/` and sensitive files. Auto-starts with the MCP server.

### conversationHistory
Manages multi-turn conversation state for `ai_chat`. Persists to disk in JSONL format. Configurable max messages and persistence frequency.

### schedulerManager
Cron-based task scheduling using `node-cron`. Persists tasks to `scheduler-state.json`. History tracking with configurable retention. Concurrent task limit enforcement.

### databasePoolManager
Connection pool management for PostgreSQL (pg), MySQL (mysql2), MSSQL (mssql). Automatic pool creation/reuse. Pool statistics and graceful shutdown via `db_closeConnections`.

### cacheService
In-memory key-value cache using `node-cache`. Configurable TTL per key or global default from `config.cacheTtl`.

---

## Configuration

### config.yaml

Primary configuration file at the project root. Validated against a Zod schema (`configSchema`) on load and every update.

| Section | Purpose |
|---------|---------|
| `serverName` | MCP server identifier |
| `ollamaUrl` / `ollamaModel` | Local model configuration |
| `aiProviders` | API key encryption, local model toggle |
| `backup` | Interval, retention, compression, path |
| `scheduler` | Task limits, persistence path |
| `monitoring` | Peer instance path, health check endpoints |
| `github` | Remote sync configuration |
| `conversations` | Storage path, max messages |
| `cli` / `api` | Daily/weekly usage limits |

### .env

Environment variables for sensitive data. Loaded via `dotenv` on startup. Auto-created from `.env.example` if missing.

### Secret Management

API keys can be stored as:
1. **Environment variables** -- `CODEX_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
2. **Encrypted in config.yaml** -- Using `aiProviders.*KeyEncrypted` fields, decrypted at runtime with `AI_KEY_PASSWORD`
3. **`.env` file** -- Loaded via dotenv

---

## Guardian System

The server runs a background Guardian loop that monitors a peer MCP instance:

1. Periodically checks peer health (file existence, build status)
2. If unhealthy, triggers auto-heal (file sync from healthy instance)
3. Configurable interval (minimum 30s, default 300s)
4. Can be disabled via `GUARDIAN_LOOP_ENABLED=0`
5. File-focused checks to avoid false alarms from external endpoints

---

## Build System

```
TypeScript Sources          Build Output
├── src/                    ├── dist/src/
│   ├── index.ts       ->  │   ├── index.js
│   ├── config.ts           │   ├── config.js
│   ├── tools/              │   ├── tools/
│   ├── services/           │   ├── services/
│   └── utils/              │   └── utils/
├── bin/                    ├── dist/bin/
│   └── hakanmcp.ts    ->  │   └── hakanmcp.js
└── tsconfig.build.json
```

- **Compiler:** `tsc` with `tsconfig.build.json`
- **Module system:** ESM (`"type": "module"`)
- **Target:** ES2022
- **Linting:** ESLint + Prettier with `lint-staged`
- **Testing:** Jest with `ts-jest` and `--experimental-vm-modules`

### npm Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | TypeScript compilation |
| `npm start` | Start MCP server |
| `npm run dev` | Development mode (ts-node/esm) |
| `npm test` | Full test suite |
| `npm run test:smoke` | Quick smoke tests |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier formatting |
| `npm run check:quick` | Build + smoke tests |

---

## Dependencies

### Runtime

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol server implementation |
| `zod` | Schema validation (inputs, config) |
| `simple-git` | Git operations |
| `pg` / `mysql2` / `mssql` / `sqlite3` | SQL database drivers |
| `mongodb` | MongoDB driver |
| `node-fetch` | HTTP client |
| `node-cron` | Cron-based task scheduling |
| `node-cache` | In-memory caching |
| `winston` / `winston-daily-rotate-file` | Structured logging |
| `js-yaml` | YAML parsing |
| `handlebars` | Template engine |
| `xml2js` | XML parsing |
| `csv-parse` / `csv-stringify` | CSV processing |
| `dotenv` | Environment variable loading |
| `commander` | CLI framework |
| `chalk` / `boxen` / `ora` / `gradient-string` | Terminal UI |
| `jsdom` | HTML/DOM parsing (GitBook tools) |
| `semver` | Version comparison |

### Optional

| Package | Purpose |
|---------|---------|
| `agentdb` | Vector search with HNSW (alpha, native dep issues) |
