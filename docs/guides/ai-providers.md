# HakanMCP — AI Provider Configuration Guide

HakanMCP supports multiple AI providers with automatic failover. This guide covers how to configure each provider.

---

## Provider Fallback Chain

When you call `ai_chat` or use the CLI chat, HakanMCP tries providers in this order:

```
Phase 1 - CLI Providers (fastest, no API key needed):
  1. Codex CLI      (codex exec)
  2. Claude CLI     (claude -p)
  3. Gemini CLI     (gemini)
  4. Cursor CLI     (agent -p)

Phase 2 - API Providers (requires API keys):
  5. Codex API      (OpenAI API)
  6. Claude API     (Anthropic API)
  7. Gemini API     (Google AI API)

Phase 3 - Local Models:
  8. Ollama         (local inference)
```

Each phase is tried in order. If a provider fails or hits a rate limit, the next one is tried automatically.

---

## CLI Providers

CLI providers use locally installed AI tools. No API keys required, but the CLI tool must be installed and in your PATH.

### Codex CLI

```bash
# Install
npm install -g @openai/codex

# Verify
codex --version
```

**Environment variables:**
- `CODEX_CLI_ARGS` -- Override CLI arguments (default: `exec`)
- `CODEX_CLI_YOLO` -- Set to `0` to disable `--yolo` flag (default: enabled)

### Claude CLI

```bash
# Install (via Anthropic)
npm install -g @anthropic-ai/claude-code

# Verify
claude --version
```

Uses `claude -p` for prompt mode. Prompt is passed via stdin.

### Gemini CLI

```bash
# Install
npm install -g @anthropic-ai/gemini  # or platform-specific install

# Verify
gemini --version
```

Prompt is passed via stdin with a 45-second timeout.

### Cursor CLI (agent)

The Cursor agent CLI. Requires Cursor IDE to be installed.

**Environment variables:**
- `CURSOR_AGENT_MODEL` -- Override the model used by Cursor agent
- `HAKANMCP_PROJECT_ROOT` -- Working directory for Cursor agent

---

## API Providers

API providers use REST APIs and require API keys.

### OpenAI / Codex API

**Environment variables (either works):**
```env
CODEX_API_KEY=sk-...
OPENAI_API_KEY=sk-...
```

**Or encrypted in config.yaml:**
```yaml
aiProviders:
  codexKeyEncrypted: "encrypted-value-here"
```

### Anthropic / Claude API

**Environment variables (either works):**
```env
CLAUDE_CODE_API_KEY=sk-ant-...
ANTHROPIC_API_KEY=sk-ant-...
```

**Or encrypted in config.yaml:**
```yaml
aiProviders:
  claudeKeyEncrypted: "encrypted-value-here"
```

### Google Gemini API

**Environment variable:**
```env
GEMINI_API_KEY=AIza...
```

**Or encrypted in config.yaml:**
```yaml
aiProviders:
  geminiKeyEncrypted: "encrypted-value-here"
```

---

## Encrypting API Keys

Instead of storing API keys in plain text `.env` files, you can encrypt them and store in `config.yaml`:

1. Set an encryption password:
   ```env
   AI_KEY_PASSWORD=your-strong-password
   ```

2. Encrypt a key using the `encrypt_value` tool:
   ```json
   { "name": "encrypt_value", "arguments": { "value": "sk-your-api-key" } }
   ```

3. Store the encrypted value in `config.yaml`:
   ```yaml
   aiProviders:
     codexKeyEncrypted: "aes256gcm:iv:ciphertext:tag"
   ```

The key is automatically decrypted at runtime using `AI_KEY_PASSWORD`.

---

## Local Models (Ollama)

Ollama provides local AI inference without API keys or rate limits.

### Setup

1. Install Ollama: https://ollama.ai
2. Pull a model:
   ```bash
   ollama pull llama3
   ollama pull qwen2.5:14b-instruct
   ```
3. Verify it's running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

### Configuration

In `config.yaml`:
```yaml
ollamaUrl: http://localhost:11434     # Ollama endpoint
ollamaModel: qwen2.5:14b-instruct    # Default model
ollamaTimeout: 36000000               # Timeout in ms (10 hours for long ops)
retryCount: 3                         # Retry count per model

aiProviders:
  localModels: true                   # Set false to never use Ollama
  ollamaForTools: true                # Allow Ollama as fallback for MCP tool AI calls
```

### Model Fallback

When using Ollama, if the primary model fails (timeout, not found), the system tries other available models from `config.availableModels`. Models are synced automatically from Ollama on server startup.

---

## Rate Limit Handling

### Automatic Cooldown

When a provider returns a rate limit error (HTTP 429 or CLI limit message), the system:
1. Parses the error for a cooldown duration
2. Places the provider in cooldown (skipped until expiry)
3. Falls through to the next provider

### Checking Status

```bash
npx hakanmcp limits status
```

Shows:
- Per-provider cooldown status with reset timestamps
- Daily/weekly API usage against configured limits
- Daily/weekly CLI usage against configured limits

### Resetting Cooldowns

```bash
npx hakanmcp limits reset
```

Clears all cooldowns so every provider can be retried immediately.

### Usage Limits

Configure daily/weekly limits in `config.yaml`:

```yaml
cli:
  dailyLimit: 50
  weeklyLimit: 200
api:
  dailyLimit: 50
  weeklyLimit: 200
```

---

## Provider Warmup

On CLI startup, the system checks which provider was last successful and prioritizes it. This is stored in `.ai-provider-last-success.json` and reduces first-message latency by trying the most likely provider first.

---

## Disabling Providers

### Disable all local models
```yaml
aiProviders:
  localModels: false
```
Or: `DISABLE_LOCAL_MODELS=1`

### Disable Ollama for tool calls only
```yaml
aiProviders:
  ollamaForTools: false
```

### CLI-only mode (no API keys)
In `ai_chat`, set `allowLocalFallback: false` to skip Ollama and only use CLI/API providers.

---

## Direct Provider Tools

In addition to `ai_chat` (which uses the fallback chain), you can call specific providers directly:

- `codex_chat` -- Direct Codex/OpenAI API call
- `claude_code_chat` -- Direct Anthropic API call
- `gemini_chat` -- Direct Gemini API call

These bypass the fallback chain and fail if the specific provider is unavailable.
