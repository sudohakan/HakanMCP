# Design: Centralized AI Provider System

**Date:** 2026-03-09
**Status:** Approved

## Problem

AI provider selection/fallback logic is duplicated and inconsistent across the codebase:
- `console_chat.ts` uses the full chain (CLI→API→Ollama) with cooldown/availability — works correctly
- `missionRunner.ts` and `actionExecutor.ts` have their own `resolveAvailableProvider()` that bypasses cooldown, availability, and encrypted keys
- Agentic mode in `ai_chat` skips cooldown pre-check
- `ai_provider_chat` skips availability flags
- No CLI command to view/change provider configuration

## Solution

### 1. Config Schema Extension (`config.yaml`)

```yaml
aiProviders:
  fallbackOrder: ["cli", "api", "ollama", "codexmini"]
  cliPriority: ["codex", "claude", "gemini", "cursor"]
  apiPriority: ["codex", "claude", "gemini"]
  agenticMode: true
  # existing fields preserved (localModels, keys, etc.)
```

### 2. Extend `getPreferredLLMResponse()`

- Read ordering from `config.aiProviders.fallbackOrder/cliPriority/apiPriority` (not hardcoded)
- Add codexmini as final fallback phase
- Add agentic mode support with cooldown/availability pre-check
- Every call reads config directly (no startup cache) for hot-reload

### 3. Unify All AI Usage Points

| File | Current | New |
|------|---------|-----|
| `missionRunner.ts` | Own `resolveAvailableProvider()` | Call `getPreferredLLMResponse()` |
| `actionExecutor.ts` | Duplicate function | Call `getPreferredLLMResponse()` |
| `aiTools.ts` agentic branch | No cooldown pre-check | Route through `getPreferredLLMResponse()` |
| `aiProviders.ts` | `routeProviderWithFallback()` no availability | Use `getPreferredLLMResponse()` |

Delete duplicate `resolveAvailableProvider()` functions.

### 4. Config CLI Extension

Add AI Provider section to existing `config` command output:

```
AI Providers
  Fallback Order:  cli → api → ollama → codexmini
  CLI Priority:    codex → claude → gemini → cursor
  API Priority:    codex → claude → gemini
  Agentic Mode:    enabled

  Status:
    codex_cli    ✓ available
    claude_api   ✗ cooldown (2m)
    ollama       ✗ unavailable
```

Configurable via existing `config set` mechanism.

### 5. Minor Fixes

- Gemini agentic adapter: parse `Retry-After` header
- Env var inconsistency: add `GOOGLE_API_KEY` as fallback for `GEMINI_API_KEY`

## Files Affected

- `src/config.ts` — schema extension
- `src/tools/aiTools.ts` — `getPreferredLLMResponse()` refactor
- `src/tools/aiProviders.ts` — use central function
- `src/mission/missionRunner.ts` — replace `resolveAvailableProvider()`
- `src/watch/actionExecutor.ts` — replace `resolveAvailableProvider()`
- `src/services/agenticProviders.ts` — Gemini Retry-After fix
- `src/cli/configCommand.ts` or existing config handler — provider display + set
