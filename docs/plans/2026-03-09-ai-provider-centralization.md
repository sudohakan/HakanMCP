# AI Provider Centralization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Centralize all AI provider selection through `getPreferredLLMResponse()` with configurable priority ordering and full cooldown/availability support. Fix provider update command output.

**Architecture:** Extend `getPreferredLLMResponse()` to read provider ordering from config, add codexmini fallback, and support agentic mode. Replace all duplicate provider selection code with calls to this single function. Add provider status display to config CLI command. Fix provider update feedback.

**Tech Stack:** TypeScript, ESM, Commander.js, Zod validation

---

## Task 1: Config Schema Extension

**Files:** `src/config.ts`

**What:** Add `fallbackOrder`, `cliPriority`, `apiPriority` arrays and `agenticMode` boolean to the existing `aiProviders` schema block.

### Steps

**Step 1.1** — Extend the Zod schema for `aiProviders` (line ~116–130 in `src/config.ts`).

Add these four new fields inside the existing `aiProviders` z.object, after the `agenticMaxIterations` field (line ~128):

```typescript
/** Provider fallback phase order: cli -> api -> ollama -> codexmini */
fallbackOrder: z.array(z.enum(['cli', 'api', 'ollama', 'codexmini'])).optional(),
/** CLI tool priority within the cli phase */
cliPriority: z.array(z.enum(['codex', 'claude', 'gemini', 'cursor'])).optional(),
/** API key priority within the api phase */
apiPriority: z.array(z.enum(['codex', 'claude', 'gemini'])).optional(),
/** Enable agentic mode globally (default true) */
agenticMode: z.boolean().optional(),
```

**Step 1.2** — Add defaults in `DEFAULT_CONFIG.aiProviders` (line ~249–252):

```typescript
aiProviders: {
  encryptionPasswordEnv: 'AI_KEY_PASSWORD',
  localModels: true,
  fallbackOrder: ['cli', 'api', 'ollama', 'codexmini'],
  cliPriority: ['codex', 'claude', 'gemini', 'cursor'],
  apiPriority: ['codex', 'claude', 'gemini'],
  agenticMode: true,
},
```

**Step 1.3** — No extra type export needed. The existing `export type AIProviderSecretConfig = Config['aiProviders'];` (line 225) automatically includes the new optional fields via Zod inference.

### Verification
- Run `npx tsx bin/hakanmcp.ts config` — should not error.
- Manually add `fallbackOrder: [api, cli]` to `config.yaml` under `aiProviders:` — restart — config loads without validation error.

---

## Task 2: Refactor `getPreferredLLMResponse()` to Use Config Priority

**Files:** `src/tools/aiTools.ts`

**What:** Replace the hardcoded `defaultOrder` and `priority` arrays with config-driven values. Add codexmini as a final fallback phase.

### Steps

**Step 2.1** — Replace the hardcoded CLI order (line ~573–574):

```typescript
// BEFORE:
const defaultOrder: ChatProviderId[] = ['codex', 'claude', 'gemini', 'cursor'];
const cliOrder: ChatProviderId[] = options.providerOrder ?? getWarmedCliOrder(defaultOrder);

// AFTER:
const cfgProviders = config.aiProviders;
const defaultCliOrder: ChatProviderId[] = (cfgProviders?.cliPriority as ChatProviderId[] | undefined) ?? ['codex', 'claude', 'gemini', 'cursor'];
const cliOrder: ChatProviderId[] = options.providerOrder ?? getWarmedCliOrder(defaultCliOrder);
```

Note: `config` is already imported and is a mutable singleton mutated in-place by `updateConfig()` via `Object.assign(config, ...)`, so reading it each call is hot-reload compatible.

**Step 2.2** — Replace the hardcoded API priority in the function signature (line ~559):

```typescript
// BEFORE:
priority: Array<'codex' | 'claude' | 'gemini' | 'cursor'> = ['codex', 'claude', 'gemini'],

// AFTER:
priority: Array<'codex' | 'claude' | 'gemini' | 'cursor'> = (config.aiProviders?.apiPriority as Array<'codex' | 'claude' | 'gemini'>) ?? ['codex', 'claude', 'gemini'],
```

**Step 2.3** — Add codexmini as final fallback phase. After the Ollama fallback block, right before the final `throw new Error(...)` at the end of the function, add:

```typescript
// Phase: codexmini final fallback
const fallbackPhases = cfgProviders?.fallbackOrder ?? ['cli', 'api', 'ollama', 'codexmini'];
if (fallbackPhases.includes('codexmini')) {
  onProgress?.('All providers failed, trying codexmini...');
  const codexMiniKey = codexKey.key; // reuse already-resolved codex key
  if (codexMiniKey) {
    try {
      const result = await callCodexModel(messages, 'gpt-4o-mini', codexMiniKey);
      diagnostics.push('Fell back to codexmini (gpt-4o-mini).');
      return { text: result.text, provider: 'Codex (gpt-4o-mini, fallback)', diagnostics };
    } catch (e: unknown) {
      diagnostics.push(`codexmini fallback failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }
}
```

### Verification
- Set `apiPriority: [gemini, codex, claude]` in `config.yaml` — call `ai_chat` — verify Gemini is tried first in API phase (check diagnostics).
- Remove all API keys — verify codexmini fallback is attempted (with codex key present).

---

## Task 3: Unify Mission Runner

**Files:** `src/tools/aiTools.ts` (new export), `src/mission/missionRunner.ts`

**What:** Replace the local `resolveAvailableProvider()` (lines 57–89) with a shared helper exported from `aiTools.ts`.

### Analysis

The mission runner needs an `AgenticCallFn` (for `runAgenticLoop`), NOT a text response. So we cannot directly call `getPreferredLLMResponse()`. We create a shared helper that reads config priorities and returns `{ callFn, label }`.

### Steps

**Step 3.1** — Add new exported function to `src/tools/aiTools.ts`. The agentic provider functions are already imported in aiTools.ts (line 40–41). Add this export near the end of the file (before the tool definitions):

```typescript
/**
 * Resolve the best available agentic provider using config priorities + env keys.
 * Used by missionRunner and actionExecutor to get an AgenticCallFn.
 */
export function resolveAgenticProvider(): { callFn: AgenticCallFn; label: string } {
  const cfgProviders = config.aiProviders;
  const apiOrder = (cfgProviders?.apiPriority as Array<'codex' | 'claude' | 'gemini'>) ?? ['codex', 'claude', 'gemini'];

  for (const provider of apiOrder) {
    if (provider === 'codex') {
      const key = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
      if (key) {
        const model = process.env.OPENAI_MODEL || process.env.CODEX_MODEL || 'gpt-4o';
        return { callFn: createOpenAICallFn(model, key), label: `openai:${model}` };
      }
    }
    if (provider === 'claude') {
      const key = process.env.CLAUDE_CODE_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (key) {
        const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
        return { callFn: createClaudeCallFn(model, key), label: `claude:${model}` };
      }
    }
    if (provider === 'gemini') {
      const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (key) {
        const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        return { callFn: createGeminiCallFn(model, key), label: `gemini:${model}` };
      }
    }
  }

  throw new Error(
    'No AI provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY.',
  );
}
```

**Step 3.2** — In `src/mission/missionRunner.ts`:

1. **Delete** the local `resolveAvailableProvider()` function (lines 57–89).
2. **Delete** the unused imports (lines 8–12):
   ```typescript
   // DELETE:
   import {
     createClaudeCallFn,
     createOpenAICallFn,
     createGeminiCallFn,
   } from '../services/agenticProviders.js';
   ```
3. **Add** the new import:
   ```typescript
   import { resolveAgenticProvider } from '../tools/aiTools.js';
   ```
4. **Update** the call site (line ~127):
   ```typescript
   // BEFORE:
   const { callFn, label: providerLabel } = resolveAvailableProvider();
   // AFTER:
   const { callFn, label: providerLabel } = resolveAgenticProvider();
   ```

### Verification
- Set `apiPriority: [gemini, codex, claude]` in `config.yaml`, have only `GEMINI_API_KEY` set — `runMission()` should pick Gemini.
- `npx tsc --noEmit` — no TypeScript errors.

---

## Task 4: Unify Watch ActionExecutor

**Files:** `src/watch/actionExecutor.ts`

**What:** Same as Task 3 — replace the duplicate `resolveAvailableProvider()` with the shared helper.

### Steps

1. **Delete** the local `resolveAvailableProvider()` function (lines 32–63).
2. **Delete** the unused imports (lines 8–12):
   ```typescript
   // DELETE:
   import {
     createClaudeCallFn,
     createOpenAICallFn,
     createGeminiCallFn,
   } from '../services/agenticProviders.js';
   ```
3. **Add** the new import:
   ```typescript
   import { resolveAgenticProvider } from '../tools/aiTools.js';
   ```
4. **Update** the call site (line ~97):
   ```typescript
   // BEFORE:
   const { callFn, label: providerLabel } = resolveAvailableProvider();
   // AFTER:
   const { callFn, label: providerLabel } = resolveAgenticProvider();
   ```

### Verification
- `npx tsc --noEmit` — no errors.
- Trigger a watch action — verify it picks the correct provider per config priority.

---

## Task 5: Fix Agentic Mode Cooldown Pre-check

**Files:** `src/tools/aiTools.ts`

**What:** The agentic branch in the `ai_chat` handler creates `AgenticCallFn` directly without checking cooldown/availability. Add pre-checks.

### Steps

Find the agentic branch in the `ai_chat` handler (search for `runAgenticLoop` in aiTools.ts). Before provider selection, add cooldown + availability checks:

```typescript
// Wrap existing agentic provider selection in a loop over config priorities:
const agenticApiOrder = (config.aiProviders?.apiPriority as Array<'codex' | 'claude' | 'gemini'>) ?? ['codex', 'claude', 'gemini'];
let agenticCallFn: AgenticCallFn | null = null;
let agenticLabel = '';

for (const provider of agenticApiOrder) {
  // Skip if in cooldown
  if (isInCooldown(provider)) {
    diagnostics.push(`${provider} skipped for agentic mode (in cooldown)`);
    continue;
  }
  // Skip if unavailable
  const avail = getProviderAvailability(`${provider}_api`);
  if (avail.status === 'unavailable') {
    diagnostics.push(`${provider} skipped for agentic mode (${avail.reason || 'unavailable'})`);
    continue;
  }

  // Resolve key and create callFn (existing logic per provider)
  // ... select the first available one
  break;
}

if (!agenticCallFn) {
  throw new Error('No agentic provider available (all in cooldown or unavailable).');
}
```

The exact code depends on how the existing agentic branch structures its provider selection. The principle: iterate `apiPriority`, check `isInCooldown()` and `getProviderAvailability()` before attempting each.

### Verification
- Put Claude API in cooldown (`setCooldown('claude', 120000, 'test')`) — trigger agentic mode — verify it falls back to Codex/Gemini instead of failing.

---

## Task 6: Fix `ai_provider_chat` Availability Check

**Files:** `src/tools/aiProviders.ts`

**What:** `routeProviderWithFallback()` uses `filterAvailableProviders()` (cooldown) but does NOT check `getProviderAvailability()` before each API call. Add the check.

### Steps

In `routeProviderWithFallback()` (lines 276–387), for each provider block, add an availability check before the API call. Example for codex (line ~301, inside the `if (codexKey.key)` block):

```typescript
// ADD before try { const result = await callCodexModel(...) }:
const codexAvail = getProviderAvailability('codex_api');
if (codexAvail.status === 'unavailable') {
  diagnostics.push(`Codex API skipped (${codexAvail.reason || 'unavailable'})`);
} else {
  try {
    const result = await callCodexModel(messages, model, codexKey.key);
    // ... existing success handling
  } catch (error: unknown) {
    // ... existing error handling
  }
}
```

Apply identically for claude (check `claude_api`) and gemini (check `gemini_api`) blocks.

### Verification
- `setProviderAvailability('codex_api', 'unavailable', 'test')` — call `ai_provider_chat` with provider=codex — should skip to claude.

---

## Task 7: Fix Gemini Retry-After + Env Var

**Files:** `src/services/agenticProviders.ts`, `src/tools/aiProviders.ts`, `src/tools/aiTools.ts`

### Step 7.1 — Parse Retry-After in Gemini agentic adapter

In `createGeminiCallFn()` (agenticProviders.ts, lines 289–293), the error handler uses hardcoded `30_000`:

```typescript
// BEFORE (line 291-292):
if (response.status === 429 || response.status >= 500) {
  setCooldown('gemini', 30_000, errorText.slice(0, 200));
}

// AFTER:
if (response.status === 429 || response.status >= 500) {
  const sec = parseRetryAfter(response.headers.get('retry-after'));
  let durationMs = sec ? sec * 1000 : undefined;
  if (response.status >= 500 && !durationMs) durationMs = 30_000;
  if (response.status === 429 && !durationMs) durationMs = 60_000;
  setCooldown('gemini', durationMs, errorText.slice(0, 200));
}
```

`parseRetryAfter` is already imported at line 15.

### Step 7.2 — Add GOOGLE_API_KEY as fallback for GEMINI_API_KEY

**In `src/tools/aiProviders.ts`:**

1. `callGeminiModel()` (line 200):
   ```typescript
   // BEFORE:
   const apiKey = validateApiKey(apiKeyOverride || process.env.GEMINI_API_KEY, 'Gemini');
   // AFTER:
   const apiKey = validateApiKey(apiKeyOverride || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, 'Gemini');
   ```

2. `routeProviderWithFallback()` Gemini key resolution (line ~296):
   ```typescript
   // BEFORE:
   const geminiKey = resolveProviderApiKey('Gemini', ['GEMINI_API_KEY'], config.aiProviders?.geminiKeyEncrypted);
   // AFTER:
   const geminiKey = resolveProviderApiKey('Gemini', ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], config.aiProviders?.geminiKeyEncrypted);
   ```

**In `src/tools/aiTools.ts`:** Find the Gemini key resolution in `getPreferredLLMResponse()` (search for `resolveProviderApiKey('Gemini'`):

```typescript
// BEFORE:
resolveProviderApiKey('Gemini', ['GEMINI_API_KEY'], currentConfig.aiProviders?.geminiKeyEncrypted);
// AFTER:
resolveProviderApiKey('Gemini', ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], currentConfig.aiProviders?.geminiKeyEncrypted);
```

### Verification
- Set only `GOOGLE_API_KEY` (not `GEMINI_API_KEY`) — call `ai_provider_chat` with gemini — should work.
- Trigger a 429 from Gemini — verify cooldown uses parsed Retry-After header duration.

---

## Task 8: Config CLI — Provider Display & Set

**Files:** `bin/hakanmcp.ts`

**What:** Add AI Provider configuration section to the existing `providers` command output showing priorities and live status.

### Steps

**Step 8.1** — Find `runProviderStatus()` function in `bin/hakanmcp.ts`. At the beginning of the function body, add a configuration display section:

```typescript
const cfgProviders = config.aiProviders;
const fallbackOrder = cfgProviders?.fallbackOrder ?? ['cli', 'api', 'ollama', 'codexmini'];
const cliPriority = cfgProviders?.cliPriority ?? ['codex', 'claude', 'gemini', 'cursor'];
const apiPriority = cfgProviders?.apiPriority ?? ['codex', 'claude', 'gemini'];
const agenticMode = cfgProviders?.agenticMode ?? cfgProviders?.agenticEnabled ?? true;

let configSection = '';
configSection += `  ${chalk.bold('Configuration')}\n\n`;
configSection += `    Fallback Order:  ${fallbackOrder.map(p => chalk.hex(THEME.primary)(p)).join(chalk.hex(THEME.textMuted)(' -> '))}\n`;
configSection += `    CLI Priority:    ${cliPriority.map(p => chalk.hex(THEME.primary)(p)).join(chalk.hex(THEME.textMuted)(' -> '))}\n`;
configSection += `    API Priority:    ${apiPriority.map(p => chalk.hex(THEME.primary)(p)).join(chalk.hex(THEME.textMuted)(' -> '))}\n`;
configSection += `    Agentic Mode:    ${agenticMode ? chalk.hex(THEME.success)('enabled') : chalk.hex(THEME.textMuted)('disabled')}\n`;
configSection += '\n';
```

**Step 8.2** — Add live cooldown/availability status. Import `getProviderAvailability` and `getCooldownStatus` from `aiProviderCooldown.js` (may already be imported for `runProviderStatus`). Add after the config section:

```typescript
configSection += `  ${chalk.bold('Live Status')}\n\n`;
const statusProviders = ['codex_cli', 'claude_cli', 'gemini_cli', 'cursor_cli', 'codex_api', 'claude_api', 'gemini_api'];
for (const sp of statusProviders) {
  const avail = getProviderAvailability(sp);
  const baseProvider = sp.split('_')[0] as 'codex' | 'claude' | 'gemini';
  const cooldown = getCooldownStatus(baseProvider);
  let statusIcon: string;
  let statusText: string;
  if (cooldown.status === 'cooldown') {
    const remSec = Math.ceil((cooldown.remainingMs ?? 0) / 1000);
    statusIcon = chalk.hex(THEME.warning)('~');
    statusText = chalk.hex(THEME.warning)(`cooldown (${remSec}s)`);
  } else if (avail.status === 'unavailable') {
    statusIcon = chalk.hex(THEME.error)('x');
    statusText = chalk.hex(THEME.error)('unavailable');
  } else if (avail.status === 'available') {
    statusIcon = chalk.hex(THEME.success)('v');
    statusText = chalk.hex(THEME.success)('available');
  } else {
    statusIcon = chalk.hex(THEME.textMuted)('?');
    statusText = chalk.hex(THEME.textMuted)('unchecked');
  }
  configSection += `    ${statusIcon} ${chalk.hex(THEME.textMuted)(sp.padEnd(14))} ${statusText}\n`;
}
```

Insert this `configSection` into the rendered output, before the existing provider rows.

**Step 8.3** — `config set` for new fields works automatically since they are part of the Zod schema and `updateConfig()` uses `deepMerge`. Usage:

```
hakanmcp config set aiProviders.cliPriority '["gemini","codex","claude","cursor"]'
hakanmcp config set aiProviders.agenticMode false
```

### Verification
- Run `hakanmcp providers` — see Configuration section with priorities and Live Status.
- `hakanmcp config set aiProviders.cliPriority '["gemini","codex","claude"]'` — verify `config.yaml` updated correctly.

---

## Task 9: Fix Provider Update Command Output

**Files:** `bin/hakanmcp.ts` — `runProviderUpdate()` function (lines 2184–2240)

### Problem

1. When a provider IS updated, the spinner message (line 2234) shows only the target version, not `old -> new`.
2. Format is inconsistent with the "already latest" line.

### Steps

**Step 9.1** — Fix the update success message (line 2234):

```typescript
// BEFORE:
spinner.succeed(chalk.hex(THEME.success)(`${t} updated to v${v.latest ?? 'latest'}`));

// AFTER:
spinner.succeed(
  `${chalk.hex(THEME.success)('✓')} ${chalk.hex(THEME.primary)(t.padEnd(12))} v${v.installed} → v${v.latest ?? 'latest'} ${chalk.hex(THEME.textMuted)('(updated)')}`
);
```

**Step 9.2** — Fix the update failure message (line 2237) for consistency:

```typescript
// BEFORE:
spinner.fail(chalk.hex(THEME.error)(`${t} update failed: ${msg.slice(0, 80)}`));

// AFTER:
spinner.fail(
  `${chalk.hex(THEME.error)('✗')} ${chalk.hex(THEME.primary)(t.padEnd(12))} update failed: ${msg.slice(0, 80)}`
);
```

### Expected Output

```
▸ providers update codex
  ✓ codex        v0.111.0 → v0.112.0 (updated)
```

```
▸ providers update codex
  ✓ codex        v0.112.0 (already latest)
```

```
▸ providers update
  ✓ codex        v0.111.0 → v0.112.0 (updated)
  ✓ claude       v2.1.71 (already latest)
  – gemini       not installed
```

### Verification
- Run `hakanmcp providers update codex` when update available — verify old → new format.
- Run again — verify `(already latest)` format.

---

## Dependency Graph

```
Task 1 (config schema)
  ├──> Task 2 (getPreferredLLMResponse reads config)
  │     ├──> Task 3 (missionRunner uses shared helper)
  │     ├──> Task 4 (actionExecutor uses shared helper)
  │     └──> Task 5 (agentic cooldown pre-check)
  ├──> Task 8 (config CLI display)
  └── (independent)
        ├──> Task 6 (ai_provider_chat availability)
        ├──> Task 7 (Gemini fixes)
        └──> Task 9 (provider update output)
```

**Execution order:** 1 → 2 → 3, 4, 5 (parallel) → 6, 7, 8, 9 (parallel)

---

## Summary of Files Changed

| File | Tasks | Change Type |
|------|-------|-------------|
| `src/config.ts` | 1 | Schema extension + defaults |
| `src/tools/aiTools.ts` | 2, 3, 5, 7 | Refactor priorities + new `resolveAgenticProvider()` export + codexmini fallback + GOOGLE_API_KEY |
| `src/tools/aiProviders.ts` | 6, 7 | Availability pre-check + GOOGLE_API_KEY fallback |
| `src/mission/missionRunner.ts` | 3 | Delete local fn, import shared `resolveAgenticProvider()` |
| `src/watch/actionExecutor.ts` | 4 | Delete local fn, import shared `resolveAgenticProvider()` |
| `src/services/agenticProviders.ts` | 7 | Gemini Retry-After header parsing |
| `bin/hakanmcp.ts` | 8, 9 | Provider config display + update output format fix |
