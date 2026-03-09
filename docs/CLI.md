# HakanMCP — CLI Reference

The `hakanmcp` CLI provides an interactive terminal interface for chatting with AI, running diagnostics, managing backups, and configuring the MCP server. It features a gradient-powered animated UI built with Commander.js, chalk, boxen, and ora.

---

## Installation

```bash
# From project root
npm run build
npx hakanmcp

# Or install globally
npm link
hakanmcp
```

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `hakanmcp` | Start MCP server (stdio mode) |
| `hakanmcp -c` / `--cli` | Interactive AI chat |
| `hakanmcp -d "msg"` / `--direct "msg"` | Direct AI query (one-shot) |
| `hakanmcp tools` | List all 203 tools |
| `hakanmcp config` | Configuration management |
| `hakanmcp doctor` | System health check |
| `hakanmcp status` | Status dashboard |
| `hakanmcp backup run` | Create backup |
| `hakanmcp limits` | AI provider rate limit status |
| `hakanmcp logs tail` | Tail log files |
| `hakanmcp ralph` | Iterative AI improvement loop |
| `hakanmcp --version` | Version info |

---

## Commands

### Default -- Start MCP Server (stdio)

```bash
hakanmcp
```

When run without `-c` or `-d` flags and without subcommands, starts the MCP server in stdio mode. This is the mode used by Claude Desktop, Claude Code, Cursor, and other MCP clients.

### Interactive AI Chat

```bash
hakanmcp -c
hakanmcp --cli
hakanmcp chat
hakanmcp chat --cli        # CLI/API providers only, skip MCP
hakanmcp chat --detailed   # Enable debug output
```

Opens an interactive multi-turn AI chat session in the terminal with:
- Gradient-styled ASCII art logo with neon animation
- Multi-provider AI routing (Codex, Claude, Gemini, Cursor, Ollama)
- Conversation history persistence
- Live "thinking" indicator with provider status
- Boxed, color-coded responses

The chat uses the AI provider fallback chain:
1. Codex CLI -> Claude CLI -> Gemini CLI -> Cursor CLI
2. Codex API -> Claude API -> Gemini API
3. Ollama (local, if enabled)

**In-chat commands:**

| Command | Action |
|---------|--------|
| `exit` / `quit` / `q` | End chat session |
| `clear` | Clear conversation history |
| `history` | Show conversation history |
| `help` | Show available commands |

### Direct AI Query

```bash
hakanmcp -d "Your prompt here"
hakanmcp --direct "Explain microservices in 3 bullet points"
```

Sends a single prompt to the AI provider chain and prints the response. Useful for scripting and automation.

**Examples:**
```bash
hakanmcp -d "Write a TypeScript function that validates email addresses"
hakanmcp -d "What is the MCP protocol?"
hakanmcp -d "Compare PostgreSQL vs MySQL for OLTP workloads"
```

### List Tools

```bash
hakanmcp tools
```

Displays all 203 registered MCP tools grouped by prefix (e.g., `db`, `git`, `mongo`, `http`, `sys`, `fs`). Shows tool name and truncated description.

### Configuration Management

```bash
hakanmcp config                              # Show all settings
hakanmcp config yaml <path> <value>          # Update config.yaml value
hakanmcp config chat useOllama <on|off>      # Toggle Ollama in chat
hakanmcp config chat useApiKeys <on|off>     # Toggle API key usage
hakanmcp config set <category> <key> <value> # Set a boolean setting
```

#### `config yaml`

Update `config.yaml` values using dot-notation:
```bash
hakanmcp config yaml backup.enabled true
hakanmcp config yaml cacheTtl 600
hakanmcp config yaml monitoring.checkInterval 300
```

#### `config set`

Toggle boolean settings by category:

| Category | Available Keys |
|----------|---------------|
| `ai` | `localModels`, `ollamaForTools` |
| `backup` | `enabled` |
| `self` | `enabled`, `requireApproval` |
| `chat` | `useOllama`, `useApiKeys` |

```bash
hakanmcp config set ai localModels on
hakanmcp config set backup enabled on
```

### System Health Check

```bash
hakanmcp doctor
hakanmcp health    # alias
```

Runs comprehensive diagnostics:
- Node.js version verification (>= 20)
- Build status (dist/ existence and freshness)
- Configuration file validation
- AI provider availability (CLI tools, API keys)
- Optional service status (Ollama, databases)
- Disk space and system resources

### Status Dashboard

```bash
hakanmcp status
```

Displays system status including active services, runtime info, and tool counts.

### Backup Management

```bash
hakanmcp backup run
```

Creates a ZIP backup immediately and lists the 5 most recent backups with size and age.

### AI Provider Limits

```bash
hakanmcp limits           # Show status (default)
hakanmcp limits status    # Show all provider cooldowns and usage
hakanmcp limits reset     # Clear all cooldowns
```

Displays per-provider cooldown status, API/CLI usage against daily/weekly limits.

### Log Viewer

```bash
hakanmcp logs tail              # Default: general logs
hakanmcp logs tail general      # General log directory
hakanmcp logs tail autonomy     # Autonomy logs
```

Shows the last 50 lines from the most recent log file.

### Ralph Loop

```bash
hakanmcp ralph                    # Run 5 iterations (default)
hakanmcp ralph --iterations 3    # Run 3 iterations
hakanmcp ralph -n 8              # Run 8 iterations
hakanmcp ralph --dry-run         # Report only, no changes
```

Iterative AI-driven improvement loop. Each iteration reviews project state and suggests improvements. Stops early on `FINALIZE` or `Blocked:` output.

### 24-Hour Observation

```bash
hakanmcp observe
```

Displays backup activity and metrics over the past 24 hours.

### Version

```bash
hakanmcp --version
hakanmcp -V
```

---

## Environment Variables

| Variable | Effect |
|----------|--------|
| `HAKANMCP_QUIET=1` | Suppress animated UI, use simple text output |
| `HAKANMCP_SIMPLE=1` | Use simplified text menus (no logo/pills) |
| `HAKANMCP_CLI=1` | Auto-set when CLI is running |
| `HAKANMCP_PROJECT_ROOT` | Override project root path |
| `INSTANCE_ROLE` | Instance role: `main` (default) or `peer` |
| `CODEX_API_KEY` | OpenAI/Codex API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `DISABLE_LOCAL_MODELS=1` | Skip Ollama entirely |
| `CODEX_CLI_ARGS` | Override Codex CLI arguments |
| `CURSOR_AGENT_MODEL` | Override Cursor agent model |
| `GUARDIAN_LOOP_ENABLED=0` | Disable Guardian loop |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Configuration error |

Press `Ctrl+C` to exit any interactive mode.
