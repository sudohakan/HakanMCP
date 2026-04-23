# HakanMCP API Keys — Setup

Yeni tool'lar (exa, elevenlabs, shodan) API key gerektirir. Akademik (arxiv, semanticScholar) auth-free.

## Bitwarden items (create once)

| Item name | Field | Value |
|-----------|-------|-------|
| `API Key — Exa` | `login.password` | `<your EXA API key>` |
| `API Key — ElevenLabs` | `login.password` | `<your ELEVENLABS API key>` |
| `API Key — Shodan` | `login.password` | `<your SHODAN API key>` |

Create via `bw`:
```bash
bw sync
bw get template item | jq '.name="API Key — Exa" | .notes="Exa semantic search" | .login.password="<KEY>"' | bw encode | bw create item
# Repeat for ElevenLabs and Shodan
```

## Wire to HakanMCP MCP env (~/.claude.json)

Edit `~/.claude.json`, extend `mcpServers.HakanMCP.env`:

```json
{
  "mcpServers": {
    "HakanMCP": {
      "command": "node",
      "args": ["/mnt/c/dev/HakanMCP/dist/src/index.js"],
      "env": {
        "HAKANMCP_PROJECT_ROOT": "/mnt/c/dev/HakanMCP",
        "EXA_API_KEY": "<paste or use Bitwarden-injected value>",
        "ELEVENLABS_API_KEY": "<paste>",
        "SHODAN_API_KEY": "<paste>"
      }
    }
  }
}
```

## Graceful fail

Tools throw descriptive error if env var missing:
```
Error: EXA_API_KEY not set — configure via Bitwarden "API Key — Exa"
```

Tools without key simply fail at call time — no server startup impact.
