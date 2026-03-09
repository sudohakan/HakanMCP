# HakanMCP v4.0.0

**Unified AI Agent Orchestration & MCP Tool Platform**

HakanMCP is a Model Context Protocol (MCP) server that exposes 199 tools to AI agents. It provides multi-database access, multi-provider AI chat, file system operations, Git/GitHub integration, HTTP requests, monitoring, scheduling, encryption, and more -- all through a single STDIO-based MCP interface.

It also includes a premium CLI (`hakanmcp`) with an animated terminal UI for interactive chat, system diagnostics, backup management, and configuration.

## Quick Start

```bash
# Prerequisites: Node.js >= 20

# Install dependencies
npm install

# Build
npm run build

# Start MCP server (STDIO transport)
npm start

# Or launch the interactive CLI
npx hakanmcp
```

## Feature Highlights

- **199 MCP Tools** across 27 categories -- every tool is Zod-validated and timeout-protected
- **Multi-Database** -- PostgreSQL, MySQL, MSSQL, SQLite, MongoDB (connection pooling included)
- **Multi-Provider AI** -- Codex/OpenAI, Claude/Anthropic, Gemini, Cursor CLI, Ollama (automatic fallback chain)
- **Premium CLI** -- Gradient-powered terminal UI with animated intro, interactive chat, system diagnostics
- **Backup System** -- Automatic ZIP backups with configurable retention and interval
- **Monitoring** -- Cross-instance health checks, auto-heal, deep SHA-256 comparison, sync
- **Scheduler** -- Cron-based task scheduling with AI agent integration
- **Encryption** -- AES-256-GCM encryption for secrets, files, and API keys
- **Knowledge Graph** -- In-memory entity/relation graph for structured knowledge
- **Flow Engine** -- JSON-based workflow recipes with validation, replay, and versioning
- **Self-Improvement** -- Controlled code modification with approval workflow and daily limits
- **System Optimization** -- Windows system analysis, cleanup, RAM optimization, gaming mode (16 tools)

## Tool Count by Category

| Category | Count | Description |
|----------|-------|-------------|
| Database (SQL) | 18 | PostgreSQL, MySQL, MSSQL, SQLite query/schema/backup/restore |
| MongoDB | 14 | Connect, CRUD, aggregation, indexing, collection management |
| System & Filesystem | 17 | File CRUD, process management, system info, scheduled tasks |
| System Optimization | 16 | Windows analysis, cleanup, RAM/SSD/network/gaming optimization |
| Git | 11 | Status, log, diff, branch, add, commit, push, pull, checkout, reset, clone |
| Flow Engine | 11 | Validate, run, history, replay, versioning, connection management |
| Postman | 10 | Collection management, request CRUD, execute, search, clone, markdown |
| Scheduler | 10 | Create, list, update, delete, pause, resume, execute, history, stats |
| Knowledge Graph | 9 | Entity/relation CRUD, observations, graph read, search |
| HTTP | 11 | GET/POST/PUT/PATCH/DELETE, auth (Bearer/Basic/API key), timeout/retry, download |
| GitBook | 7 | Page fetch, link listing, search, headings, outline, metadata |
| Backup | 7 | Create, list, restore, stats, start/stop auto-backup, delete old |
| Monitoring | 7 | Health check, auto-heal, compare, sync, dependency update, self-recover, rollback |
| Environment | 6 | Get/set/list/delete env vars, load/save .env files |
| Parser | 6 | Parse YAML/JSON/XML/CSV, convert YAML<->JSON |
| AI Chat | 5 | Chat with history, generate text, list models, view/clear history |
| GitHub | 5 | Setup remote, push, pull, status, create repo |
| MCP Client | 5 | Connect to other MCP servers, list/call tools, disconnect |
| Cache | 5 | Set, get, delete, clear, stats |
| DB Monitoring | 4 | Record query duration, slow queries, stats, clear |
| API | 4 | OpenAPI spec, rate limit status, REST wrapper info, webhook handler |
| Encryption | 4 | Encrypt/decrypt values and files (AES-256-GCM) |
| AI Providers | 3 | Claude Code, Codex, Gemini API direct calls |
| Self-Improvement | 3 | Propose changes, apply changes, view change log |
| DX (Developer Experience) | 3 | Tool scaffold generator, hot reload tips |
| Template | 2 | Handlebars render and compile |
| Performance | 1 | CPU benchmark |
| **Total** | **199** | |

## Configuration

Configuration is managed through `config.yaml` (Zod-validated) with environment variable overrides for secrets. See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Documentation

- [Quick Start Guide](QUICKSTART.md) -- Get running in 5 minutes
- [CLI Reference](CLI.md) -- All CLI commands documented
- [Tool Catalog](TOOLS.md) -- Complete list of 199 tools with parameters
- [Architecture](ARCHITECTURE.md) -- System design and directory structure

## License

MIT
