# HakanMCP — Tools API Reference

Detailed API reference for the most commonly used tools. All tools follow the MCP protocol and return responses in the format:

```json
{
  "content": [
    { "type": "text", "text": "response content" }
  ]
}
```

On error, the response includes `"isError": true`.

---

## ai_chat

The primary AI interaction tool. Supports conversation history with automatic multi-provider fallback.

**Input Schema:**
```json
{
  "message": "string (optional) - Single message, auto-managed with conversation history",
  "messages": "array (optional) - Direct messages array [{role, content}], bypasses history",
  "model": "string (optional) - Model name override",
  "allowLocalFallback": "boolean (optional) - Allow Ollama fallback, default from config"
}
```

**Provider Fallback Order:**
1. Codex CLI -> Claude CLI -> Gemini CLI -> Cursor CLI
2. Codex API -> Claude API -> Gemini API (requires API keys)
3. Ollama local models (if enabled)

**Example - Stateful (with history):**
```json
{ "message": "Explain the MCP protocol" }
```

**Example - Stateless (direct):**
```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What is TypeScript?" }
  ]
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "**Selected Model:** Claude Code (claude-sonnet-4-20250514)\n\nThe MCP protocol is..."
  }]
}
```

---

## ai_generate

Text generation using local Ollama models. Unlike `ai_chat`, this does not use the multi-provider fallback chain.

**Input Schema:**
```json
{
  "prompt": "string (required) - The text prompt",
  "model": "string (optional) - Model name override"
}
```

**Example:**
```json
{ "prompt": "Write a haiku about programming" }
```

---

## db_queryPostgres

Execute SQL queries against a PostgreSQL database.

**Input Schema:**
```json
{
  "connectionString": "string (required) - PostgreSQL connection string",
  "query": "string (required) - SQL query to execute"
}
```

**Example:**
```json
{
  "connectionString": "postgresql://user:pass@localhost:5432/mydb",
  "query": "SELECT * FROM users WHERE active = true LIMIT 10"
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "{\"rowCount\": 10, \"rows\": [...]}"
  }]
}
```

---

## db_queryMySQL

Execute SQL queries against a MySQL database.

**Input Schema:**
```json
{
  "host": "string (required)",
  "user": "string (required)",
  "password": "string (required)",
  "database": "string (required)",
  "query": "string (required)",
  "port": "number (optional, default: 3306)"
}
```

---

## db_queryMSSQL

Execute SQL queries against Microsoft SQL Server.

**Input Schema:**
```json
{
  "server": "string (required) - SQL Server host",
  "database": "string (required)",
  "user": "string (required)",
  "password": "string (required)",
  "query": "string (required)",
  "port": "number (optional, default: 1433)",
  "encrypt": "boolean (optional, default: true)",
  "trustServerCertificate": "boolean (optional, default: false)"
}
```

---

## db_querySQLite

Execute SQL queries against a SQLite database file.

**Input Schema:**
```json
{
  "dbPath": "string (required) - Path to SQLite database file",
  "query": "string (required) - SQL query"
}
```

---

## mongo_find

Find documents in a MongoDB collection with optional filtering, projection, sorting, and limiting.

**Input Schema:**
```json
{
  "connectionId": "string (required) - From mongo_connect",
  "collection": "string (required) - Collection name",
  "filter": "object (optional) - MongoDB filter query",
  "projection": "object (optional) - Fields to include/exclude",
  "limit": "number (optional) - Max documents to return",
  "sort": "object (optional) - Sort specification"
}
```

**Example:**
```json
{
  "connectionId": "conn_123",
  "collection": "users",
  "filter": { "age": { "$gte": 18 } },
  "projection": { "name": 1, "email": 1 },
  "sort": { "name": 1 },
  "limit": 50
}
```

---

## http_request

Send HTTP requests to any URL with optional headers and body.

**Input Schema:**
```json
{
  "url": "string (required)",
  "method": "string (optional, default: GET) - GET, POST, PUT, DELETE, PATCH, etc.",
  "headers": "object (optional) - Request headers",
  "body": "string|object (optional) - Request body"
}
```

**Example:**
```json
{
  "url": "https://api.example.com/data",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": { "key": "value" }
}
```

---

## git_status

Show the current Git repository status including tracked/untracked files, ahead/behind counts.

**Input Schema:**
```json
{
  "repoPath": "string (optional) - Path to repo, defaults to cwd"
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "{\"current\": \"main\", \"tracking\": \"origin/main\", \"files\": [...], \"ahead\": 0, \"behind\": 0}"
  }]
}
```

---

## scheduler_createTask

Create a new scheduled task that runs on a cron schedule.

**Input Schema:**
```json
{
  "name": "string (required) - Task name",
  "schedule": "string (required) - Cron expression (e.g., '0 */6 * * *' for every 6 hours)",
  "agentTask": "string (required) - Task description/command to execute",
  "enabled": "boolean (optional, default: true)"
}
```

**Example:**
```json
{
  "name": "daily-backup",
  "schedule": "0 2 * * *",
  "agentTask": "Create a backup of the database"
}
```

---

## backup_create

Create an immediate ZIP backup of the MCP server directory.

**Input Schema:** No parameters required.

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "Backup created: ./backups/backup-2026-02-28T10-30-00.zip (15.2 MB)"
  }]
}
```

---

## encrypt_value

Encrypt sensitive data using AES-256-GCM encryption.

**Input Schema:**
```json
{
  "value": "string (required) - The sensitive value to encrypt",
  "password": "string (optional) - Encryption password, uses AI_KEY_PASSWORD env var if not provided"
}
```

**Response:** Returns the encrypted string that can be stored safely in config files.

---

## mcp_connect

Connect to another MCP server, enabling tool chaining across servers.

**Input Schema:**
```json
{
  "command": "string (required) - Command to start the MCP server",
  "args": "array (optional) - Command arguments",
  "env": "object (optional) - Environment variables"
}
```

**Example:**
```json
{
  "command": "node",
  "args": ["path/to/other-mcp-server/dist/index.js"],
  "env": { "API_KEY": "..." }
}
```

After connecting, use `mcp_listTools` to discover available tools and `mcp_callTool` to invoke them.

---

## flow_run

Execute a flow/recipe defined in a JSON file. Flows are sequences of actions with triggers and steps.

**Input Schema:**
```json
{
  "path": "string (required) - Path to the flow JSON file"
}
```

**Flow file format:**
```json
{
  "name": "my-flow",
  "trigger": { "type": "manual" },
  "steps": [
    {
      "action": "log",
      "params": { "message": "Flow started" }
    },
    {
      "action": "http_request",
      "params": { "url": "https://api.example.com/health" }
    }
  ]
}
```

---

## kg_search

Search the in-memory knowledge graph for entities and observations matching a query.

**Input Schema:**
```json
{
  "query": "string (required) - Search query"
}
```

Returns matching entities with their types, observations, and relations.
