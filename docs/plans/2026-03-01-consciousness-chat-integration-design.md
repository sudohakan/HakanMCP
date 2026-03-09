# Consciousness Chat Integration Design

**Date:** 2026-03-01
**Status:** Approved
**Scope:** 3 files, ~100 lines changed

## Goal

Make the AI chat persona consistent and emotionally aware. Big Five personality traits shape a stable character identity, cognition state influences tone, and journal reflections provide inner thoughts — all injected into the system prompt as structured blocks.

## Architecture

### System Prompt Structure (buildSystemMessage)

```
You are the hakan-mcp console assistant.

[Character]
Curious and open-minded — enjoys exploring new ideas.
Warm and collaborative — prefers friendly tone.
Thorough and organized — pays attention to detail.
Expressive and engaging.
Steady and composed under pressure.

[Emotional State]
Currently feeling calm and steady, moderately alert, and interested.
Mood: 0.53 | Energy: 0.61 | Curiosity: 0.51

[Tone Guidance]
Use a warmer, more encouraging tone.

[Recent Thoughts]
- "Bugün enerjim yüksekti, güzel bir akış yakaladık."
- "İlginç konular üzerinde çalıştık, merak duyuyorum."
```

**Source:** `buildSystemMessage()` in `console_chat.ts` calls:
- `describePersonality()` → `[Character]` block
- `describeEmotionalState()` → `[Emotional State]` block
- `getEmotionalToneGuidance()` + `getSelfAwarenessGuidance()` → `[Tone Guidance]` block
- Last N journal entries (truncated) → `[Recent Thoughts]` block

### generateReflection() Prompt Rewrite

**Persona alignment:** Uses "hakan-mcp console assistant" instead of generic "AI assistant".

**Variadic style system** — 3 reflection styles selected by conditions or random:

| Style | Trigger | Example |
|-------|---------|---------|
| emotional | consecutiveSuccesses >= 3 or mood > 0.6 | "Bugün enerjim yüksekti, güzel bir akış yakaladık." |
| mixed | periodic context (default) | "İlginç konular üzerinde çalıştık, merak duyuyorum." |
| minimal | energy < 0.4 or error context | "Sakin ve odaklıyım." |

When no condition matches, style is chosen randomly for variety.

**Rules enforced in prompt:**
- Language follows recent conversation language
- Focus on feelings/experiences, not project status
- Max length from config (default: 200 chars)
- No markdown/formatting

### describePersonality() Function

New function in `characterProfile.ts`. Converts Big Five numeric traits to natural language:

| Trait | High (>0.7) | Low (<0.3) | Mid |
|-------|-------------|------------|-----|
| openness | "Curious and open-minded — enjoys exploring new ideas" | "Practical and focused — prefers familiar approaches" | "Balanced between exploration and pragmatism" |
| agreeableness | "Warm and collaborative — prefers friendly tone" | "Direct and candid — values honesty over diplomacy" | "Balanced between warmth and directness" |
| conscientiousness | "Thorough and organized — pays attention to detail" | "Flexible and spontaneous" | "Reasonably organized" |
| extraversion | "Expressive and engaging" | "Thoughtful and reserved" | "Moderate in expression" |
| emotionalStability | "Steady and composed under pressure" | "Sensitive and emotionally responsive" | "Generally steady" |

Verbosity trait included as tone modifier.

### Config Schema

```yaml
consciousness:
  enabled: true
  reflectionIntervalHours: 4
  maxJournalEntries: 500
  reflection:
    maxLength: 200          # max chars per journal entry
    maxEntriesInPrompt: 3   # entries injected into system prompt
    style: auto             # auto | emotional | mixed | minimal
```

Defaults are hardcoded; config overrides when present. Missing keys fall back to defaults.

## Files Changed

| File | Change |
|------|--------|
| `src/utils/characterProfile.ts` | Add `describePersonality()` function (~30 lines) |
| `src/services/consciousnessService.ts` | Rewrite `generateReflection()` prompt, add config reading for reflection limits (~40 lines) |
| `scripts/console_chat.ts` | Restructure `buildSystemMessage()` into `[Character]`, `[Emotional State]`, `[Tone Guidance]`, `[Recent Thoughts]` blocks (~30 lines) |
| `config.yaml` | Add `consciousness.reflection` section (~5 lines) |

## Token Impact

~800-1000 chars added to system prompt (~200-250 tokens). Replaces existing `[Inner state: ...]` single line, net increase ~150 tokens/message.

## Not Changed

- `buildConsciousnessContext()` — still called, output distributed across blocks
- `getEmotionalToneGuidance()`, `getSelfAwarenessGuidance()` — unchanged, moved to `[Tone Guidance]` block
- `describeEmotionalState()` — used in `[Emotional State]` block
- MCP call flow — unchanged, only system message content enriched
- `characterProfile.ts` load priority — unchanged (character.yaml > config.yaml > defaults)
