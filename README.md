![Version](https://img.shields.io/badge/version-1.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Platform](https://img.shields.io/badge/platform-win%20%7C%20mac%20%7C%20linux-lightgrey)
![Tools](https://img.shields.io/badge/tools-131-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)

# HakanMCP

Comprehensive MCP server with 131 tools for AI-powered development workflows.

Run autonomous AI agents with mission-based task execution, or use as a Model Context Protocol server for Claude Code, Cursor, and other MCP-compatible clients.

---

## Table of Contents

- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [Features](#features)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [CLI Commands](#cli-commands)
- [AI Provider System](#ai-provider-system)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

- **131 MCP tools** covering databases, git, web, file ops, AI, security, monitoring, and more
- **Multi-provider AI** with automatic fallback chain -- Codex, Claude, Gemini, Cursor, Ollama
- **Mission Agent CLI** for autonomous task execution driven by markdown mission files
- **4 operating modes** -- Watch, Scheduled, Assistant, and Reactive -- for flexible automation
- **Agentic mode** -- Multi-turn tool-use loops with automatic provider selection
- **Lazy-loaded dependencies** -- only installs what you actually use
- **Graceful error handling** -- process-level crash protection with clean shutdown
- **Rate limit detection** -- automatic cooldown management across all providers

---

## Quick Start

### As MCP Server (for Claude Code)

Add to your `claude_desktop_config.json` or via Claude Code CLI:

```bash
claude mcp add hakanmcp node /path/to/HakanMCP/dist/src/index.js
```

Or manually in config:

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

### From Source

```bash
git clone https://github.com/sudohakan/HakanMCP.git
cd HakanMCP
npm install
cp .env.example .env    # Add your API keys
npm run build           # Compile TypeScript -> dist/
```

### As Mission Agent CLI

```bash
# Install globally
npm install -g hakanmcp

# Initialize workspace with config and mission templates
hakanmcp init

# Edit your mission file
# (opens PRIMARY_MISSION.md created by init)

# Start the mission agent
hakanmcp start

# Check mission progress
hakanmcp mission

# View reports
hakanmcp report

# Stop the agent
hakanmcp stop
```

Requires **Node.js >= 20.0.0**.

> For detailed installation and configuration, see [SETUP.md](SETUP.md)

---

## Features

<details>
<summary><strong>AI and Language Models</strong></summary>

- **AI Chat** -- Multi-provider AI chat with conversation history and stateful sessions
- **AI Generate** -- Content generation via configurable AI providers
- **AI Provider Chat** -- Direct provider-level chat (Claude, OpenAI, Gemini)
- **AI History** -- Conversation history management with session tracking
- **AI List Models** -- Enumerate available models across all providers
- **AI Defence** -- AI safety, content filtering, and threat detection
- **Agentic Mode** -- Multi-turn tool-use loops where the AI can call MCP tools autonomously
- **Consensus** -- Multi-model consensus reaching across providers
- **MoE Router** -- Mixture of Experts routing for intelligent task delegation
- **Knowledge Graph** -- Entity, observation, and relation management with semantic search
- **Consciousness Service** -- Periodic self-reflection and emotional state tracking

</details>

<details>
<summary><strong>Database Management</strong></summary>

- **PostgreSQL** -- Query, schema inspection, table listing, pool stats
- **MySQL** -- Query execution, schema management
- **MSSQL (SQL Server)** -- Query, schema, connection management
- **SQLite** -- Lightweight local database operations
- **MongoDB** -- Connect, find, insert, update, delete, aggregate, indexing, collection/database listing
- **DB Monitoring** -- Connection pool stats, table schema inspection, backup and restore
- **DB Pool Manager** -- Connection pooling with idle timeout, health checks, and automatic cleanup

Database drivers are optional dependencies -- install only what you need:

```bash
npm install pg        # PostgreSQL
npm install mysql2    # MySQL
npm install mssql     # SQL Server
npm install sqlite3 sqlite  # SQLite
npm install mongodb   # MongoDB
```

</details>

<details>
<summary><strong>DevOps and System</strong></summary>

- **System Info** -- OS, CPU, memory, disk information
- **Process Management** -- List, kill, and monitor system processes
- **System Optimization** -- Analyze, cleanup, optimize, quick status, admin commands, log viewing
- **Monitoring** -- Health checks, auto-healing, dependency updates, sync, rollback, self-recovery
- **Performance** -- Benchmarking and profiling tools
- **Scheduled Tasks** -- Cron-based and interval-based task scheduling with overlap guard
- **Backup Service** -- Automated backup with configurable retention, compression, and restore
- **Tool Health Check** -- Daily automated verification of all registered tools

</details>

<details>
<summary><strong>File and Data Processing</strong></summary>

- **File Operations** -- Read, write, copy, move, delete, search, list directory, make directory
- **Parser** -- CSV, JSON, XML, YAML, and other data format parsing and transformation
- **Template Engine** -- Handlebars-based template compilation and rendering
- **Backup** -- File and directory backup with restore support
- **Cache** -- Entry management, statistics, TTL-based expiration, and cache clearing
- **Environment** -- Environment variable and .env file management

</details>

<details>
<summary><strong>Git and GitHub</strong></summary>

- **Git Operations** -- Add, commit, checkout, reset, sync, repository info
- **GitHub Integration** -- Create repos, push, pull, setup remote, status checks
- **GitBook** -- Find, get page, headings, outline, search content, list links, metadata

</details>

<details>
<summary><strong>Security and Encryption</strong></summary>

- **Encryption** -- File and value encryption/decryption with AES-256
- **AI Defence** -- Content safety filtering and threat detection
- **Guidance Engine** -- Security policy compilation, enforcement, and auditing

</details>

<details>
<summary><strong>Workflow and Automation</strong></summary>

- **Flows** -- Define, validate, run, replay, and version workflow pipelines with execution history
- **Scheduler** -- Task scheduling with cron expressions and interval syntax
- **Swarm** -- Multi-agent swarm creation, agent management, task routing, and reconfiguration
- **Self Improvement** -- Propose and apply changes for self-optimization
- **DX Tooling** -- Developer experience tool scaffolding
- **RuVector** -- Pattern learning, search, add, and remove for rule-based vector operations
- **Postman** -- Collection and request management for API testing
- **HTTP** -- HTTP requests and file downloads
- **API** -- Rate limit status, REST wrapper info, webhook handling
- **MCP Client** -- Connect, disconnect, list connections, list tools, and call tools on remote MCP servers
- **MCP Bridge** -- Proxy remote MCP server tools into agentic mode

</details>

---

## Architecture

```
hakanmcp
├── MCP Server (131 tools via Model Context Protocol)
│   ├── Tool Registry (lazy-loaded, health-checked)
│   ├── Agentic Loop (multi-turn tool-use with any API provider)
│   └── MCP Bridge (proxy remote MCP server tools)
│
├── AI Provider System
│   ├── CLI Chain: codex → claude → gemini → cursor
│   ├── API Chain: codex → claude → gemini
│   ├── Local Fallback: Ollama
│   ├── Rate Limit Detection & Cooldown Management
│   └── Provider Warmup (pre-resolve keys on startup)
│
└── Mission Agent CLI
    ├── Watch Mode      — File system monitoring → AI actions
    ├── Scheduled Mode  — Cron/interval tasks → periodic execution
    ├── Assistant Mode  — Interactive chat with mission context
    └── Reactive Mode   — Watch + Scheduled unified event bus
```

<details>
<summary><strong>Operating Modes</strong></summary>

### Watch Mode

Monitor files and directories for changes, triggering AI-driven actions automatically.

```bash
hakanmcp watch
```

- Uses chokidar for file system monitoring
- Configurable file patterns and triggers
- Actions execute when trigger conditions match (file extension, content pattern, directory filter)

### Scheduled Mode

Run tasks on cron schedules or time intervals.

```bash
hakanmcp scheduled
```

- Supports cron expressions (`0 */6 * * *`)
- Supports interval syntax (`every 30m`, `every 2h`)
- Overlap guard prevents concurrent executions of the same task
- Mission file reloaded fresh on each execution

### Assistant Mode

Interactive chat with full mission context awareness.

```bash
hakanmcp chat
```

- `PRIMARY_MISSION.md` content automatically injected into AI context
- Target files/directories analyzed and included
- Mission state (progress, history) available during conversation

### Reactive Mode

Combines Watch + Scheduled modes in a unified event-driven architecture.

```bash
hakanmcp reactive
```

- Runs file watchers and scheduled tasks simultaneously
- Event bus enables cross-mode communication (watch events can trigger scheduled tasks)
- Single process manages all event sources

</details>

<details>
<summary><strong>Mission System</strong></summary>

HakanMCP uses markdown files to define tasks for autonomous execution.

### Mission File Format

`hakanmcp init` creates a `PRIMARY_MISSION.md` template:

```markdown
---
title: My Project Mission
priority: high
targets:
  - src/
  - tests/
---

## Objective

Describe what the agent should accomplish.

## Steps

1. Analyze the target codebase
2. Identify issues or improvements
3. Implement changes
4. Verify results

## Success Criteria

- All tests pass
- No new warnings introduced
```

### How It Works

1. The agent reads `PRIMARY_MISSION.md` and parses frontmatter + steps
2. Each step is executed via the configured AI provider
3. State is tracked in `.hakanmcp/` directory (`state.json`, `history.json`, `learned.json`)
4. Reports are generated in `data/reports/` after completion

</details>

---

## Configuration

Running `hakanmcp init` creates a `hakanmcp.config.yaml` file:

```yaml
version: "1"

mission:
  primary: PRIMARY_MISSION.md

agent:
  provider: claude          # claude | openai | gemini
  maxIterationsPerStep: 10
  stepTimeoutMs: 120000
  continueOnFailure: false
```

### Environment Variables

Copy `.env.example` to `.env` and set your keys:

```bash
cp .env.example .env
```

```bash
# GitHub (required for GitHub integration tools)
GITHUB_TOKEN=ghp_...

# AI API Keys (at least one recommended for chat/agentic mode)
CODEX_API_KEY=sk-...           # OpenAI / Codex
CLAUDE_CODE_API_KEY=sk-ant-... # Anthropic / Claude
GEMINI_API_KEY=AI...           # Google / Gemini

# GitBook documentation URL
GITBOOK_URL=https://your-instance.gitbook.io/your-api
```

> See `.env.example` for the full list of supported environment variables.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `hakanmcp init` | Initialize workspace (config + mission templates) |
| `hakanmcp start` | Start mission agent (foreground) |
| `hakanmcp start --daemon` | Start mission agent in background |
| `hakanmcp stop` | Stop running agent (any mode) |
| `hakanmcp mission` | Show current mission status |
| `hakanmcp report` | Show most recent report |
| `hakanmcp report -n 5` | Show last 5 reports |
| `hakanmcp watch` | Start file watcher mode |
| `hakanmcp scheduled` | Start scheduled task mode |
| `hakanmcp reactive` | Start reactive mode (watch + scheduled combined) |
| `hakanmcp chat` | Interactive AI chat with mission context |
| `hakanmcp help` | Show help for all commands |

### Interactive Commands (inside `hakanmcp chat`)

| Command | Description |
|---------|-------------|
| `/providers` | Show AI provider status and usage stats |
| `/config` | Show current configuration |
| `/init` | Initialize workspace from chat |
| `/start` | Start mission agent |
| `/stop` | Stop running agent |
| `/mission` | Show mission status |
| `/report` | Show recent reports |
| `/watch` | Start watch mode |
| `/scheduled` | Start scheduled mode |
| `/assistant` | Start assistant mode |
| `/reactive` | Start reactive mode |
| `/help` | Show all commands |

---

## AI Provider System

HakanMCP supports multiple AI providers with automatic fallback:

```
Request → CLI Chain (codex → claude → gemini → cursor)
              ↓ all CLIs failed
          API Chain (codex → claude → gemini)
              ↓ all APIs failed
          Local Fallback (Ollama)
```

### Provider Priority

Priority is configured in `config.yaml`:

```yaml
aiProviders:
  cliPriority: [codex, claude, gemini, cursor]
  apiPriority: [codex, claude, gemini]
  fallbackOrder: [cli, api, ollama]
```

### Agentic Mode

When enabled, HakanMCP uses multi-turn tool-use loops where the AI model can call any registered MCP tool:

```yaml
aiProviders:
  agenticEnabled: true
  agenticMaxIterations: 10
```

Agentic mode respects the CLI/API priority chain -- if higher-priority CLI providers are available, they are used before falling back to a lower-priority API provider.

### Rate Limit Handling

- Automatic detection of rate limit messages from all providers
- Cooldown tracking with per-provider timers
- Supports relative (`try again in 20s`), absolute (`resets at 4:16 PM`), and duration (`reset after 4h58m`) formats
- Providers in cooldown are automatically skipped

---

<details>
<summary><strong>Project Structure</strong></summary>

```
HakanMCP/
├── src/                    # TypeScript source code
│   ├── index.ts            # MCP server entry point
│   ├── config.ts           # Configuration loader
│   ├── toolRegistry.ts     # Tool registration and discovery
│   ├── tools/              # MCP tool implementations (131 tools)
│   ├── services/           # Core services (agentic loop, backup, cache, etc.)
│   ├── cli/                # CLI command handlers
│   ├── mission/            # Mission system (loader, runner, state)
│   ├── flows/              # Workflow pipeline engine
│   ├── reactive/           # Event bus and cross-mode routing
│   ├── scheduled/          # Cron/interval task executor
│   ├── watch/              # File system watcher and trigger engine
│   ├── types/              # Shared TypeScript type definitions
│   └── utils/              # Utilities (logger, HTTP client, DB pool, etc.)
├── scripts/                # Development and maintenance scripts
├── bin/                    # CLI entry points
├── agents/                 # Agent YAML definitions (architect, coder, reviewer, etc.)
├── tests/                  # Jest test suite
├── .github/workflows/      # CI/CD and release automation
├── config.yaml             # Server configuration (gitignored)
├── .env                    # API keys and secrets (gitignored)
├── .env.example            # Environment variable template
├── SETUP.md                # Installation guide
├── CONTRIBUTING.md         # Development guidelines
├── SECURITY.md             # Security policy
├── CHANGELOG.md            # Version history
└── LICENSE                 # MIT License
```

</details>

---

## Documentation

| Document | Description |
|----------|-------------|
| [SETUP.md](SETUP.md) | Installation and configuration guide |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow and code style |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and security policy |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and pull request guidelines.

```bash
# Development setup
git clone https://github.com/sudohakan/HakanMCP.git
cd HakanMCP
npm install
npm run build
npm test
```

---

## License

[MIT](LICENSE)
