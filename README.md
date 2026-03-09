![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Platform](https://img.shields.io/badge/platform-win%20%7C%20mac%20%7C%20linux-lightgrey)
![Tools](https://img.shields.io/badge/tools-199-orange)

# HakanMCP

Comprehensive MCP server with 199 tools for AI-powered development workflows.

Run autonomous AI agents with mission-based task execution, or use as a Model Context Protocol server for Claude Code.

---

## Table of Contents

- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [Features](#features)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [CLI Commands](#cli-commands)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

- **199 MCP tools** covering databases, git, web, file ops, AI, security, monitoring, and more
- **Mission Agent CLI** for autonomous task execution driven by markdown mission files
- **4 operating modes** -- Watch, Scheduled, Assistant, and Reactive -- for flexible automation
- **Lazy-loaded dependencies** -- only installs what you actually use
- **Graceful error handling** -- process-level crash protection with clean shutdown

---

## Quick Start

### As MCP Server (for Claude Code)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hakanmcp": {
      "command": "node",
      "args": ["path/to/dist/src/index.js"]
    }
  }
}
```

Or register via CLI:

```bash
claude mcp add hakanmcp node path/to/dist/src/index.js
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

- **AI Chat** -- Multi-provider AI chat with conversation history
- **AI Generate** -- Content generation via configurable AI providers
- **AI Provider Chat** -- Direct provider-level chat (Claude, OpenAI, Gemini)
- **AI History** -- Conversation history management
- **AI List Models** -- Enumerate available models across providers
- **AI Defence** -- AI safety and content filtering
- **Consensus** -- Multi-model consensus reaching and history tracking
- **MoE Router** -- Mixture of Experts routing for intelligent task delegation
- **Knowledge Graph** -- Entity, observation, and relation management with semantic search

</details>

<details>
<summary><strong>Database Management</strong></summary>

- **PostgreSQL** -- Query, schema inspection, table listing, pool stats
- **MySQL** -- Query execution, schema management
- **MSSQL (SQL Server)** -- Query, schema, connection management
- **SQLite** -- Lightweight local database operations
- **MongoDB** -- Connect, find, insert, update, delete, aggregate, indexing, collection/database listing
- **DB Monitoring** -- Connection pool stats, table schema inspection, backup and restore
- **DB Query** -- Cross-database query execution with unified interface

Database drivers are optional dependencies -- install only what you need:

```bash
# PostgreSQL
npm install pg

# MySQL
npm install mysql2

# SQL Server
npm install mssql

# SQLite
npm install sqlite3 sqlite

# MongoDB
npm install mongodb
```

</details>

<details>
<summary><strong>DevOps and System</strong></summary>

- **System Info** -- OS, CPU, memory, disk information
- **Process Management** -- List, kill, and monitor system processes
- **System Optimization** -- Analyze, cleanup, optimize, quick status, admin commands, log viewing
- **Monitoring** -- Health checks, auto-healing, dependency updates, sync, rollback, self-recovery, comparison
- **Performance** -- Benchmarking and profiling tools
- **Scheduled Tasks** -- System-level task scheduling
- **Run Command** -- Shell command execution
- **Uninstall App** -- Application removal

</details>

<details>
<summary><strong>File and Data Processing</strong></summary>

- **File Operations** -- Read, write, copy, move, delete, search, list directory, make directory
- **Parser** -- CSV, JSON, XML, YAML, and other data format parsing and transformation
- **Template Engine** -- Template compilation and rendering
- **File Conversion** -- Convert between file formats
- **Backup** -- File and directory backup with restore support
- **Cache** -- Entry management, statistics, and cache clearing
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

- **Encryption** -- File and value encryption/decryption
- **AI Defence** -- Content safety filtering and threat detection
- **Guidance** -- Security policy compilation, enforcement, and auditing

</details>

<details>
<summary><strong>Workflow and Automation</strong></summary>

- **Flows** -- Define, validate, run, replay, and version workflow pipelines with execution history
- **Scheduler** -- Task scheduling with info retrieval
- **Swarm** -- Multi-agent swarm creation, agent management, task routing, reconfiguration, and status
- **Self Improvement** -- Propose and apply changes for self-optimization
- **DX Tooling** -- Developer experience tool scaffolding
- **RuVector** -- Pattern learning, search, add, and remove for rule-based vector operations
- **Postman** -- Collection and request management for API testing
- **HTTP** -- HTTP requests and file downloads
- **API** -- Rate limit status, REST wrapper info, webhook handling
- **MCP Client** -- Connect, disconnect, list connections, list tools, and call tools on remote MCP servers

</details>

---

## Architecture

```
hakanmcp
├── MCP Server (199 tools for Claude Code)
└── Mission Agent CLI
    ├── Watch Mode      -- File system monitoring -> AI actions
    ├── Scheduled Mode  -- Cron/interval tasks -> periodic execution
    ├── Assistant Mode  -- Interactive chat with mission context
    └── Reactive Mode   -- Watch + Scheduled unified event bus
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

Set your AI provider API key:

```bash
# One of these (checked in order: Claude > OpenAI > Gemini)
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
```

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

<details>
<summary><strong>Project Structure</strong></summary>

```
your-project/
  hakanmcp.config.yaml    # Agent configuration
  PRIMARY_MISSION.md       # Main mission definition
  .hakanmcp/               # Agent state directory
    state.json             # Current execution state
    history.json           # Execution history
    learned.json           # Learned patterns
  data/
    reports/               # Generated mission reports
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
