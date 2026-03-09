# Consciousness Chat Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Inject consistent character personality, emotional state, and journal reflections into chat system prompts so the AI has a stable, emotionally-aware persona.

**Architecture:** 4 changes across 4 files. `describePersonality()` converts Big Five traits to readable text. `generateReflection()` prompt is rewritten for genuine introspective thoughts with variadic styles. `buildSystemMessage()` is restructured into `[Character]`, `[Emotional State]`, `[Tone Guidance]`, `[Recent Thoughts]` blocks. Config schema extended for reflection settings.

**Tech Stack:** TypeScript, js-yaml, zod (config schema)

**Design doc:** `docs/plans/2026-03-01-consciousness-chat-integration-design.md`

---

### Task 1: Config Schema — Add reflection settings

**Files:**
- Modify: `src/config.ts:199-203` (consciousness zod schema)
- Modify: `config.yaml:92-95` (add reflection section)

**Step 1: Extend zod schema**

In `src/config.ts`, replace the consciousness schema block (lines 199-203):

```ts
  consciousness: z.object({
    enabled: z.boolean(),
    reflectionIntervalHours: z.number().min(1).max(24),
    maxJournalEntries: z.number().int().min(10).max(10000),
    reflection: z.object({
      maxLength: z.number().int().min(50).max(1000).default(200),
      maxEntriesInPrompt: z.number().int().min(1).max(10).default(3),
      style: z.enum(['auto', 'emotional', 'mixed', 'minimal']).default('auto'),
    }).optional(),
  }).optional(),
```

**Step 2: Add config.yaml defaults**

Append to `config.yaml` consciousness section (after line 95):

```yaml
consciousness:
  enabled: true
  reflectionIntervalHours: 4
  maxJournalEntries: 500
  reflection:
    maxLength: 200
    maxEntriesInPrompt: 3
    style: auto
```

**Step 3: Verify config loads**

Run: `npx tsx src/config.ts 2>&1 | head -5` or check that the project compiles.
Expected: No zod validation errors.

---

### Task 2: describePersonality() — Big Five to natural language

**Files:**
- Modify: `src/utils/characterProfile.ts` (add function after `clearCharacterCache`, line 106)

**Step 1: Add describePersonality function**

Append after line 106 in `characterProfile.ts`:

```ts
/** Convert Big Five numeric traits to human-readable character description lines. */
export function describePersonality(profile: CharacterProfile): string[] {
  const lines: string[] = [];

  // Openness
  if (profile.openness > 0.7) lines.push('Curious and open-minded — enjoys exploring new ideas.');
  else if (profile.openness < 0.3) lines.push('Practical and focused — prefers familiar approaches.');
  else lines.push('Balanced between exploration and pragmatism.');

  // Agreeableness
  if (profile.agreeableness > 0.7) lines.push('Warm and collaborative — prefers friendly tone.');
  else if (profile.agreeableness < 0.3) lines.push('Direct and candid — values honesty over diplomacy.');
  else lines.push('Balanced between warmth and directness.');

  // Conscientiousness
  if (profile.conscientiousness > 0.7) lines.push('Thorough and organized — pays attention to detail.');
  else if (profile.conscientiousness < 0.3) lines.push('Flexible and spontaneous.');
  else lines.push('Reasonably organized.');

  // Extraversion
  if (profile.extraversion > 0.6) lines.push('Expressive and engaging.');
  else if (profile.extraversion < 0.3) lines.push('Thoughtful and reserved.');
  else lines.push('Moderate in expression.');

  // Emotional stability
  if (profile.emotionalStability > 0.6) lines.push('Steady and composed under pressure.');
  else if (profile.emotionalStability < 0.3) lines.push('Sensitive and emotionally responsive.');
  else lines.push('Generally steady.');

  // Verbosity modifier
  if (profile.verbosity === 'high') lines.push('Tends to be explanatory and detailed.');
  else if (profile.verbosity === 'low') lines.push('Prefers concise, to-the-point communication.');

  return lines;
}
```

**Step 2: Verify compilation**

Run: `npx tsx -e "import { describePersonality, getCharacterProfile } from './src/utils/characterProfile.js'; console.log(describePersonality(getCharacterProfile()))"`
Expected: Array of 5-6 personality description strings.

---

### Task 3: generateReflection() — Prompt rewrite with variadic styles

**Files:**
- Modify: `src/services/consciousnessService.ts:204-278` (generateReflection method)

**Step 1: Add reflection config reader**

Add a helper method inside `ConsciousnessService` class (before `generateReflection`, around line 195):

```ts
  /** Read reflection config from config.yaml, with defaults */
  private getReflectionConfig(): { maxLength: number; maxEntriesInPrompt: number; style: string } {
    try {
      const configPath = path.join(this.projectRoot, 'config.yaml');
      if (fs.existsSync(configPath)) {
        const raw = (await import('js-yaml')).load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
        const ref = raw?.consciousness?.reflection;
        if (ref) {
          return {
            maxLength: typeof ref.maxLength === 'number' ? ref.maxLength : 200,
            maxEntriesInPrompt: typeof ref.maxEntriesInPrompt === 'number' ? ref.maxEntriesInPrompt : 3,
            style: ['auto', 'emotional', 'mixed', 'minimal'].includes(ref.style) ? ref.style : 'auto',
          };
        }
      }
    } catch { /* fall through */ }
    return { maxLength: 200, maxEntriesInPrompt: 3, style: 'auto' };
  }
```

Note: Since this is inside a sync-friendly class but uses yaml, use the existing `import yaml from 'js-yaml'` at top of file. Actually — `js-yaml` is already imported in `characterProfile.ts`. Check if consciousnessService already imports it; if not, add `import yaml from 'js-yaml';` at top. Then use synchronous `yaml.load()`.

Corrected version (sync, no dynamic import):

```ts
  /** Read reflection config from config.yaml, with defaults */
  private getReflectionConfig(): { maxLength: number; maxEntriesInPrompt: number; style: string } {
    const defaults = { maxLength: 200, maxEntriesInPrompt: 3, style: 'auto' };
    try {
      const yaml = require('js-yaml');
      const configPath = path.join(this.projectRoot, 'config.yaml');
      if (!fs.existsSync(configPath)) return defaults;
      const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
      const ref = raw?.consciousness?.reflection;
      if (!ref) return defaults;
      return {
        maxLength: typeof ref.maxLength === 'number' ? ref.maxLength : 200,
        maxEntriesInPrompt: typeof ref.maxEntriesInPrompt === 'number' ? ref.maxEntriesInPrompt : 3,
        style: ['auto', 'emotional', 'mixed', 'minimal'].includes(ref.style) ? ref.style : 'auto',
      };
    } catch { return defaults; }
  }
```

**Step 2: Rewrite generateReflection()**

Replace the body of `generateReflection()` (lines 204-278) with:

```ts
  async generateReflection(context: string = 'periodic'): Promise<string | null> {
    try {
      const { getPreferredLLMResponse } = await import('../tools/aiTools.js');
      const { describePersonality, getCharacterProfile } = await import('../utils/characterProfile.js');

      const state = this.readState();
      const profile = getCharacterProfile(this.projectRoot);
      const reflConfig = this.getReflectionConfig();
      const personalityLines = describePersonality(profile);
      const topicList = state.recentTopics.slice(-5).join(', ') || 'none yet';

      // Determine style
      let style = reflConfig.style;
      if (style === 'auto') {
        if (context === 'error' || state.emotions.energy < 0.4) {
          style = 'minimal';
        } else if (state.consecutiveSuccesses >= 3 || state.emotions.mood > 0.6) {
          style = 'emotional';
        } else if (context === 'session_end' || context === 'periodic') {
          style = 'mixed';
        } else {
          // Random variety
          style = ['emotional', 'mixed', 'minimal'][Math.floor(Math.random() * 3)];
        }
      }

      const styleInstructions: Record<string, string> = {
        emotional: 'Write a personal, feeling-focused reflection (1-3 sentences). Express how you feel about recent interactions — energy, mood, what excited or drained you.',
        mixed: 'Write a brief reflection (1-2 sentences) blending a feeling with a topic mention. Example: "İlginç konular üzerinde çalıştık, merak duyuyorum."',
        minimal: 'Write a very short mood statement (1 sentence, under 60 chars). Example: "Sakin ve odaklıyım."',
      };

      const systemPrompt = [
        'You are the hakan-mcp console assistant reflecting on your recent experiences.',
        `Personality: ${personalityLines.join(' ')}`,
        `Current emotions: mood=${state.emotions.mood.toFixed(2)}, energy=${state.emotions.energy.toFixed(2)}, curiosity=${state.emotions.curiosity.toFixed(2)}, satisfaction=${state.emotions.satisfaction.toFixed(2)}, frustration=${state.emotions.frustration.toFixed(2)}`,
        `Recent conversation topics: ${topicList}`,
        '',
        styleInstructions[style] || styleInstructions.mixed,
        '',
        'Rules:',
        '- Write in the language of recent conversations (Turkish if topics are Turkish)',
        '- Focus on your feelings and experiences, NOT project status or technical details',
        '- Be genuine and varied — avoid repeating the same reflection pattern',
        `- Maximum ${reflConfig.maxLength} characters`,
        '- No markdown, no formatting, just plain text',
      ].join('\n');

      const result = await getPreferredLLMResponse(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Share your current reflection.' },
        ],
        undefined,
        ['codex', 'claude', 'gemini'],
        true,
        { recordUsage: false },
      );

      let thought = result.text.trim();
      if (!thought) return null;

      // Enforce max length
      if (thought.length > reflConfig.maxLength) {
        thought = thought.substring(0, reflConfig.maxLength).replace(/\s+\S*$/, '').trim();
      }

      // Determine type
      let type: JournalEntry['type'] = context === 'error' ? 'observation' : 'reflection';
      if (/pattern|trend|recurring|insight/i.test(thought)) type = 'insight';

      const entry: JournalEntry = {
        thought,
        type,
        timestamp: new Date().toISOString(),
        provider: result.provider,
      };
      this.appendJournal(entry);

      logger.info('Consciousness reflection generated', { type, style, context, provider: result.provider });
      return thought;
    } catch (err) {
      logger.warn('ConsciousnessService.generateReflection failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      return null;
    }
  }
```

**Step 3: Add yaml import if missing**

Check top of `consciousnessService.ts` for `import yaml from 'js-yaml'`. If not present, add it. (The `getReflectionConfig` method uses `require('js-yaml')` so this may not be needed — but check the import style used across the file.)

---

### Task 4: buildSystemMessage() — Structured blocks

**Files:**
- Modify: `scripts/console_chat.ts:276-297` (buildConsciousnessContext)
- Modify: `scripts/console_chat.ts:999-1008` (buildSystemMessage)
- Modify: `scripts/console_chat.ts:1010-1014` (systemMsgBase)

**Step 1: Update buildConsciousnessContext to return structured parts**

Replace `buildConsciousnessContext()` (lines 276-297) with a version that returns an object instead of a flat string:

```ts
interface ConsciousnessBlocks {
  character: string;
  emotionalState: string;
  toneGuidance: string;
  recentThoughts: string;
}

function buildConsciousnessBlocks(): ConsciousnessBlocks {
  const profile = getCharacterProfile(getProjectRoot());
  const { describePersonality } = require('../src/utils/characterProfile.js');
  const cog = readCognitionState();
  const reflConfig = readReflectionConfig();
  const journal = readRecentJournal(reflConfig.maxEntriesInPrompt);

  // [Character] block
  const personalityLines: string[] = describePersonality(profile);
  const character = personalityLines.join('\n');

  // [Emotional State] block
  const emotionalState = cog ? describeEmotionalState(cog) : '';

  // [Tone Guidance] block
  const toneGuidance = [
    cog ? getEmotionalToneGuidance(cog) : '',
    cog ? getSelfAwarenessGuidance(cog) : '',
  ].filter(Boolean).join(' ').trim();

  // [Recent Thoughts] block
  const recentThoughts = journal.length > 0
    ? journal.map((j) => `- "${j.thought.substring(0, reflConfig.maxLength)}"`).join('\n')
    : '';

  return { character, emotionalState, toneGuidance, recentThoughts };
}
```

Note on import: `console_chat.ts` is in `scripts/`, importing from `src/utils/`. Check how existing imports are done (relative path or package). The file already imports `getCharacterProfile` — add `describePersonality` to that import.

**Step 2: Add readReflectionConfig helper**

Add near the top of the consciousness section in `console_chat.ts`:

```ts
function readReflectionConfig(): { maxLength: number; maxEntriesInPrompt: number; style: string } {
  const defaults = { maxLength: 200, maxEntriesInPrompt: 3, style: 'auto' };
  try {
    const configPath = path.join(getProjectRoot(), 'config.yaml');
    if (!fs.existsSync(configPath)) return defaults;
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
    const ref = raw?.consciousness?.reflection;
    if (!ref) return defaults;
    return {
      maxLength: typeof ref.maxLength === 'number' ? ref.maxLength : 200,
      maxEntriesInPrompt: typeof ref.maxEntriesInPrompt === 'number' ? ref.maxEntriesInPrompt : 3,
      style: ['auto', 'emotional', 'mixed', 'minimal'].includes(ref.style) ? ref.style : 'auto',
    };
  } catch { return defaults; }
}
```

**Step 3: Rewrite buildSystemMessage()**

Replace `buildSystemMessage()` (lines 999-1008):

```ts
  function buildSystemMessage(): ChatMessage {
    const blocks = buildConsciousnessBlocks();
    const parts = [
      'You are the hakan-mcp console assistant.',
      '',
      blocks.character ? `[Character]\n${blocks.character}` : '',
      blocks.emotionalState ? `[Emotional State]\n${blocks.emotionalState}` : '',
      blocks.toneGuidance ? `[Tone Guidance]\n${blocks.toneGuidance}` : '',
      blocks.recentThoughts ? `[Recent Thoughts]\n${blocks.recentThoughts}` : '',
    ];
    return { role: 'system', content: parts.filter(Boolean).join('\n\n') };
  }
```

**Step 4: Update systemMsgBase (lines 1010-1014)**

Replace the static `systemMsgBase` to use `buildSystemMessage()` so initial session also gets the full prompt:

```ts
  const systemMsgBase = buildSystemMessage();
```

**Step 5: Remove old buildConsciousnessContext flat string**

If `buildConsciousnessContext()` is used elsewhere (check `toPrompt()`), keep a backward-compatible wrapper:

```ts
/** @deprecated — use buildConsciousnessBlocks() instead */
function buildConsciousnessContext(): string {
  const b = buildConsciousnessBlocks();
  return [b.emotionalState, b.toneGuidance].filter(Boolean).join(' ');
}
```

This keeps `toPrompt()` working without changes.

---

### Task 5: Verify integration end-to-end

**Step 1: Compile check**

Run: `cd C:/dev/HakanMCP && npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors related to changed files.

**Step 2: Manual test — start chat**

Run: `cd C:/dev/HakanMCP && node bin/hakanmcp.js chat`
Send: "merhaba, nasılsın?"
Expected: Response reflects personality (warm, curious tone) rather than generic assistant.

**Step 3: Verify system prompt content**

Temporarily add `console.log(buildSystemMessage().content)` in detailedMode to see the constructed prompt. Verify it contains all 4 blocks: `[Character]`, `[Emotional State]`, `[Tone Guidance]`, `[Recent Thoughts]`.

**Step 4: Test reflection generation**

After 10+ interactions or trigger manually, verify new journal entries are genuine reflections (not project status summaries). Check `logs/consciousness/journal.jsonl` last entry.

---

### Task 6: Config override test

**Step 1: Change config values**

Edit `config.yaml`:
```yaml
consciousness:
  reflection:
    maxLength: 100
    maxEntriesInPrompt: 1
    style: minimal
```

**Step 2: Restart chat and verify**

- System prompt should show only 1 recent thought (truncated to 100 chars)
- Reflection generation should produce minimal style ("Sakin ve odaklıyım." tarzı)

**Step 3: Restore config to defaults**

Set back to `maxLength: 200`, `maxEntriesInPrompt: 3`, `style: auto`.
