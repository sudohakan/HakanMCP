# HakanMCP — Quick Start Guide

Get HakanMCP running in 5 minutes.

---

## Prerequisites

| Requirement | Minimum Version | Check |
|-------------|----------------|-------|
| **Node.js** | >= 20.0.0 | `node -v` |
| **npm** | >= 9 (ships with Node 20+) | `npm -v` |
| **Git** | Any recent version | `git --version` |

Optional (for specific tool categories):

- **PostgreSQL client** (`pg_dump`, `psql`) -- for Postgres backup/restore tools
- **MySQL client** (`mysqldump`, `mysql`) -- for MySQL backup/restore tools
- **Ollama** -- for local AI model inference
- **Codex CLI** / **Claude CLI** / **Gemini CLI** / **Cursor agent** -- for multi-provider AI chat
- **GitHub CLI** (`gh`) -- for `github_createRepo` tool

---

## 1. Clone and Install

```bash
git clone https://github.com/sudohakan/HakanMCP.git
cd HakanMCP
npm install
```

## 2. Build

```bash
npm run build
```

This compiles TypeScript to `dist/` using `tsconfig.build.json`.

## 3. Configure

### 3a. config.yaml

The main configuration file lives at the project root. A `config.yaml` is included with sensible defaults. Key settings:

```yaml
serverName: hakan-mcp
ollamaUrl: http://localhost:11434       # Ollama endpoint (if using local models)
ollamaModel: qwen2.5:14b-instruct      # Default local model
mongoDbUrl: mongodb://localhost:27017   # MongoDB connection (optional)
logLevel: info                          # info | debug | warn | error

aiProviders:
  localModels: true                     # Set false to skip Ollama entirely
  ollamaForTools: true                  # Allow Ollama as fallback for MCP tool calls

backup:
  enabled: true
  localPath: ./backups
  intervalHours: 6
  retentionHours: 72

scheduler:
  enabled: true
  maxConcurrentTasks: 5
```

### 3b. .env (API Keys)

Create a `.env` file in the project root for AI provider API keys:

```env
# At least one provider is recommended for AI chat
CODEX_API_KEY=sk-...              # OpenAI / Codex API key
ANTHROPIC_API_KEY=sk-ant-...      # Anthropic API key (for Claude)
GEMINI_API_KEY=AI...              # Google Gemini API key
GITHUB_TOKEN=ghp_...              # GitHub personal access token (optional)

# Optional: Encryption password for stored keys in config.yaml
AI_KEY_PASSWORD=your-secret-password
```

The AI system uses a waterfall strategy with automatic failover:

```
Codex CLI -> Claude CLI -> Gemini CLI -> Cursor CLI
    -> Codex API -> Claude API -> Gemini API
        -> Ollama (local)
```

You only need **one** working provider to use AI chat features.

## 4. Start the MCP Server

```bash
npm start
# or directly:
node --no-warnings dist/src/index.js
```

The server communicates over **stdio** using the [Model Context Protocol](https://modelcontextprotocol.io/). Startup messages appear on stderr:

```
[INFO] Hakan Personal MCP Server started!
[INFO] Automatic backup service started (every 6h, retention 72h, dir: ./backups)
[INFO] Guardian loop enabled (role=main, target=./peer, interval=300s, mode=file)
```

## 5. Use the CLI

After building, the `hakanmcp` CLI is available:

```bash
# Interactive AI chat (multi-provider with conversation history)
npx hakanmcp -c

# Direct one-shot AI query
npx hakanmcp -d "Explain the MCP protocol in 3 sentences"

# List all 203 registered tools
npx hakanmcp tools

# System health check
npx hakanmcp doctor

# Status dashboard
npx hakanmcp status

# Create a backup now
npx hakanmcp backup run

# View/update configuration
npx hakanmcp config
```

If installed globally (`npm link`), use `hakanmcp` directly without `npx`.

## 6. Connect to Claude Desktop

Add HakanMCP as an MCP server in Claude Desktop's configuration:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hakan-mcp": {
      "command": "node",
      "args": ["--no-warnings", "C:/dev/HakanMCP/dist/src/index.js"],
      "env": {
        "CODEX_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## 7. Connect to Claude Code

Add to your `.claude.json` (global or project-level):

```json
{
  "mcpServers": {
    "hakan-mcp": {
      "command": "node",
      "args": ["--no-warnings", "C:/dev/HakanMCP/dist/src/index.js"],
      "env": {
        "INSTANCE_ROLE": "main"
      }
    }
  }
}
```

## 8. Connect to Cursor

Add to Cursor's MCP settings:

```json
{
  "mcpServers": {
    "hakan-mcp": {
      "command": "node",
      "args": ["--no-warnings", "/path/to/HakanMCP/dist/src/index.js"]
    }
  }
}
```

## 9. Development Mode

For development with hot reloading:

```bash
npm run dev
# Uses ts-node with ESM loader
```

## 10. Verify Installation

Run the smoke tests:

```bash
npm run test:smoke
```

Or the full test suite:

```bash
npm test
```

---

## Next Steps

- [CLI Reference](CLI.md) -- All CLI commands and options
- [Architecture](ARCHITECTURE.md) -- System design and directory layout
- [Tool Catalog](TOOLS.md) -- Browse all 203 tools with parameters
- [AI Providers Guide](guides/ai-providers.md) -- Provider configuration details
- [Database Setup](guides/database-setup.md) -- Database connection guides
- [Troubleshooting](TROUBLESHOOTING.md) -- Common issues and fixes
