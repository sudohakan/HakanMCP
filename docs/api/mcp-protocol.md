# HakanMCP — MCP Protocol Integration Guide

How to connect HakanMCP as an MCP server to AI clients.

---

## What is MCP?

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open standard that allows AI applications to connect to external tool servers. HakanMCP implements the MCP server specification, exposing 203 tools that any MCP-compatible client can discover and invoke.

## Transport

HakanMCP uses **stdio transport** (stdin/stdout JSON-RPC). The server reads JSON-RPC requests from stdin and writes responses to stdout. Diagnostic messages are written to stderr.

## Protocol Version

HakanMCP uses `@modelcontextprotocol/sdk` v1.22+ which implements the latest MCP specification.

## Capabilities

The server advertises the following capabilities:

```json
{
  "capabilities": {
    "tools": {}
  }
}
```

## Request Handlers

### tools/list

Returns all 203 registered tools with their names, descriptions, and JSON Schema input definitions.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "ai_chat",
        "description": "Chat with AI with conversation history...",
        "inputSchema": {
          "type": "object",
          "properties": {
            "message": { "type": "string" },
            "model": { "type": "string" }
          }
        }
      }
    ]
  }
}
```

### tools/call

Invokes a specific tool by name with the provided arguments.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 2,
  "params": {
    "name": "ai_chat",
    "arguments": {
      "message": "Hello, what can you do?"
    }
  }
}
```

**Response (success):**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "**Selected Model:** Claude Code\n\nI can help with..."
      }
    ]
  }
}
```

**Response (error):**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Error: Unknown tool: invalid_tool_name"
      }
    ],
    "isError": true
  }
}
```

---

## Client Configuration

### Claude Desktop

**Config file locations:**
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hakan-mcp": {
      "command": "node",
      "args": ["--no-warnings", "/absolute/path/to/HakanMCP/dist/src/index.js"],
      "env": {
        "CODEX_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "INSTANCE_ROLE": "main"
      }
    }
  }
}
```

### Claude Code

Add to `.claude.json` (project-level or global `~/.claude.json`):

```json
{
  "mcpServers": {
    "hakan-mcp": {
      "command": "node",
      "args": ["--no-warnings", "/absolute/path/to/HakanMCP/dist/src/index.js"],
      "env": {
        "INSTANCE_ROLE": "main"
      }
    }
  }
}
```

### Cursor

Add to Cursor MCP settings:

```json
{
  "mcpServers": {
    "hakan-mcp": {
      "command": "node",
      "args": ["--no-warnings", "/absolute/path/to/HakanMCP/dist/src/index.js"]
    }
  }
}
```

### Generic MCP Client

Any MCP-compatible client can connect by spawning the server process:

```bash
node --no-warnings /path/to/HakanMCP/dist/src/index.js
```

The server expects JSON-RPC messages on stdin and responds on stdout.

---

## Environment Variables

Pass these via the `env` field in client configuration:

| Variable | Purpose |
|----------|---------|
| `INSTANCE_ROLE` | `main` (default) or `peer` -- controls Ollama sync and Guardian behavior |
| `CODEX_API_KEY` | OpenAI/Codex API key for AI tools |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude tools |
| `GEMINI_API_KEY` | Google Gemini API key |
| `DISABLE_LOCAL_MODELS` | Set to `1` to disable Ollama fallback |
| `GUARDIAN_LOOP_ENABLED` | Set to `0` to disable peer monitoring |
| `HAKANMCP_PROJECT_ROOT` | Override the working directory |

---

## Tool Timeout

All tools have a configurable timeout (default: 60 seconds). This is controlled by `system.commandTimeout` in `config.yaml`. If a tool exceeds the timeout, it returns an error.

## Logging

Tool invocations are logged to `logs/` directory using Winston with daily rotation. Each log entry includes:
- Tool name
- Input arguments
- Success/failure status
- Execution duration

---

## Connecting HakanMCP to Other MCP Servers

HakanMCP can also act as an MCP **client** via the `mcp_connect`, `mcp_listTools`, `mcp_callTool`, and `mcp_disconnect` tools. This enables chaining multiple MCP servers together.

```json
// Connect to another MCP server
{ "name": "mcp_connect", "arguments": { "command": "node", "args": ["other-server/dist/index.js"] } }

// List its tools
{ "name": "mcp_listTools", "arguments": { "connectionId": "conn_abc123" } }

// Call a tool on the other server
{ "name": "mcp_callTool", "arguments": { "connectionId": "conn_abc123", "toolName": "some_tool", "arguments": {} } }
```
