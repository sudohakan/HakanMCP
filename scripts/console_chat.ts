import { exec, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../src/config.js';
import { getCharacterProfile, getEffectiveCharacter, describePersonality } from '../src/utils/characterProfile.js';
import yaml from 'js-yaml';
import { getPreferredLLMResponse } from '../src/tools/aiTools.js';
import { ConsciousnessService } from '../src/services/consciousnessService.js';
import { SessionTracker } from '../src/services/sessionTracker.js';
import { getWarmedCliOrder, startWarmup } from '../src/services/aiProviderWarmup.js';
import { getChatSettings } from '../src/utils/chatSettings.js';
import {
  isCliLimitError,
  parseCliLimitMessage,
  setCooldownUntil,
  CLI_LIMIT_FALLBACK_MS,
  type CliProviderId,
} from '../src/services/aiProviderCooldown.js';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import util from 'node:util';
import chalk from 'chalk';
import ora from 'ora';
import { buildMissionContextBlock } from '../src/mission/missionContext.js';
import { buildTargetFilesBlock } from '../src/mission/targetAnalyzer.js';
import { loadAllMissions } from '../src/mission/missionLoader.js';


// Load .env first; .env overrides Windows/system env when key exists in .env
try {
  const dotenv = await import('dotenv');
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) dotenv.default.config({ path: envPath, override: true, quiet: true });
} catch {
  /* ignore */
}

const SESSION_WINDOW = 100; // Preserve full conversation; no truncation

// ── Premium Chat UX (plan §3) ───────────────────────────────────────────────
const PROMPT_SYMBOL = chalk.hex('#6C5CE7')('▸');
const ASSISTANT_LABEL = chalk.green('Hakan');
const SUGGESTION_PREFIX = chalk.hex('#FDCB6E')('💡');

function formatProviderBadge(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('codex')) return chalk.hex('#10A37F')('Codex');
  if (p.includes('claude')) return chalk.hex('#D97706')('Claude');
  if (p.includes('gemini')) return chalk.hex('#4285F4')('Gemini');
  if (p.includes('cursor')) return chalk.hex('#7C3AED')('Cursor');
  if (p.includes('ollama')) return chalk.hex('#FFFFFF')('Ollama');
  if (p.includes('mcp')) return chalk.cyan('MCP');
  return chalk.dim(provider);
}

function formatProviderError(message: string): string {
  const diagPrefix = 'All AI providers failed. Diagnostics:';
  if (!message.startsWith(diagPrefix)) return chalk.red(`Error: ${message}`);

  const diagStr = message.slice(diagPrefix.length).trim();
  const diagnostics = diagStr.split(' | ').map((d) => d.trim()).filter(Boolean);

  const friendlyMap: [RegExp, string][] = [
    [/timed out|idle timeout|max timeout/i, 'Timed out'],
    [/could not be used/i, 'Unavailable'],
    [/in cooldown|cooldown/i, 'In cooldown'],
    [/not found|ENOENT|spawn.*ENOENT/i, 'Not found'],
    [/api.?key|ANTHROPIC_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY/i, 'Missing API key'],
    [/limit reached|rate.?limit|quota/i, 'Rate limit reached'],
    [/503|UNAVAILABLE|overloaded/i, 'Server overloaded'],
    [/disabled|localModels/i, 'Disabled'],
    [/skipped/i, 'Skipped'],
  ];

  const colorForProvider = (name: string): string => {
    const n = name.toLowerCase();
    if (n.includes('codex')) return chalk.hex('#10A37F')(name);
    if (n.includes('claude')) return chalk.hex('#D97706')(name);
    if (n.includes('gemini')) return chalk.hex('#4285F4')(name);
    if (n.includes('cursor')) return chalk.hex('#7C3AED')(name);
    if (n.includes('ollama')) return chalk.hex('#FFFFFF')(name);
    return chalk.dim(name);
  };

  const lines: string[] = [];
  lines.push(chalk.hex('#FDCB6E')('⚠ No AI provider currently available to respond:\n'));

  for (const diag of diagnostics) {
    // Extract provider name from diagnostic like "claude -p: Command timed out..."
    const providerMatch = diag.match(/^([\w\s-]+?)(?:\s+[-:])/);
    const rawName = providerMatch ? providerMatch[1].trim() : 'Unknown';
    const reason = providerMatch ? diag.slice(providerMatch[0].length).trim() : diag;

    // Capitalize provider for display
    const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    let friendly = reason;
    for (const [pattern, label] of friendlyMap) {
      if (pattern.test(reason)) {
        friendly = label;
        break;
      }
    }

    lines.push(`  ${chalk.red('✗')} ${colorForProvider(displayName).padEnd(20)} ${chalk.dim(friendly)}`);
  }

  lines.push('');
  lines.push(chalk.dim('  Birazdan tekrar deneyin.'));
  return lines.join('\n');
}

function renderSimpleMarkdown(text: string): string {
  // Handle multi-line code blocks first (```lang\n...\n```)
  let result = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const lines = code.trimEnd().split('\n');
    const langLabel = lang ? chalk.dim(` ${lang} `) : '';
    const border = chalk.dim('│');
    const head = langLabel ? `\n${border}${langLabel}\n` : '\n';
    const body = lines.map((line: string) => chalk.dim('│ ') + chalk.cyan(line)).join('\n');
    return `${head}${body}\n${border}`;
  });
  // Inline: **bold**, *italic*, `code`
  result = result
    .replace(/\*\*([^*]+)\*\*/g, (_m, g) => chalk.bold(g))
    .replace(/\*([^*]+)\*/g, (_m, g) => chalk.italic(g))
    .replace(/`([^`\n]+)`/g, (_m, g) => chalk.cyan(g));
  return result;
}

function renderSeparator(): string {
  return chalk.hex('#576574')('─'.repeat(60));
}

/** Strip embedded Recovery Notes and Selected Model prefix from MCP ai_chat response */
function stripRecoveryNotes(text: string): { clean: string; notes: string[]; extractedProvider?: string } {
  const notes: string[] = [];
  let extractedProvider: string | undefined;
  const modelMatch = text.match(/^\*\*Selected Model:\*\*\s*([^\n]+)/i);
  if (modelMatch) {
    extractedProvider = modelMatch[1].trim();
  }
  let clean = text.replace(/^\*\*Selected Model:\*\*[^\n]*\n+/i, '');
  const recoveryMatch = clean.match(/\n\n> Recovery Notes:\n([\s\S]*?)(?=\n\n|$)/);
  if (recoveryMatch) {
    notes.push(
      ...recoveryMatch[1]
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    clean = clean.replace(recoveryMatch[0], '').trim();
  }
  return { clean, notes, extractedProvider };
}

/** Detailed mode only: gray italic debug line */
function debugLine(msg: string): string {
  return chalk.gray(chalk.italic(`  › ${msg}`));
}

function writeDebug(msg: string): void {
  if (isDetailedMode()) process.stdout.write(debugLine(msg) + '\n');
}

/** Plan §3c: Optional typewriter effect (HAKANMCP_CHAT_TYPEWRITER=1) — available when enabled */
async function _typewriterEffect(text: string, delayMs = 12): Promise<void> {
  const maxLen = 150;
  if (text.length > maxLen || !process.stdout.isTTY) {
    process.stdout.write(text + '\n');
    return;
  }
  for (let i = 0; i < text.length; i++) {
    process.stdout.write(text[i]);
    if (text[i] !== '\n') await new Promise((r) => setTimeout(r, delayMs));
  }
  process.stdout.write('\n');
}
type MessageRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: MessageRole; content: string };
type Provider = 'codex' | 'claude' | 'gemini' | 'cursor';

const execAsync = util.promisify(exec);
const rawConsoleError = console.error.bind(console);

const UI_STRINGS: Record<string, string> = {
  thinking: 'Thinking...',
  retrying: 'Retrying...',
  evetRun: '(say yes → runs)',
  cmdRan: '[Command executed]',
  cmdError: 'Command error:',
};

function ui(key: keyof typeof UI_STRINGS): string {
  return UI_STRINGS[key];
}

function shouldUseApiKeys(): boolean {
  try {
    const settingsPath = path.join(os.homedir(), '.hakanmcp', 'chat-settings.json');
    if (!fs.existsSync(settingsPath)) return true;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return raw.useApiKeys !== false;
  } catch {
    return true;
  }
}

// ── Consciousness Context Reader ────────────────────────────────────────────
// Reads the consciousness engine's persisted state to inject into prompts.

interface CognitionStateFile {
  emotions?: {
    mood: number;
    curiosity: number;
    energy: number;
    satisfaction: number;
    frustration: number;
  };
  personality?: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    emotionalStability: number;
  };
  recentTopics?: string[];
  interactionCount?: number;
  consecutiveErrors?: number;
  consecutiveSuccesses?: number;
}

interface JournalEntry {
  thought?: string;
  summary?: string;
  type: string;
  timestamp: string;
}

function getProjectRoot(): string {
  // When running via ts-node or compiled, resolve project root
  const envRoot = process.env.HAKANMCP_PROJECT_ROOT;
  if (envRoot && fs.existsSync(envRoot)) return envRoot;
  return process.cwd();
}

function readCognitionState(): CognitionStateFile | null {
  try {
    const statePath = path.join(getProjectRoot(), 'logs', 'consciousness', 'cognition_state.json');
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readRecentJournal(count = 3): JournalEntry[] {
  try {
    const journalPath = path.join(getProjectRoot(), 'logs', 'consciousness', 'journal.jsonl');
    if (!fs.existsSync(journalPath)) return [];
    const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-count)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as JournalEntry[];
  } catch {
    return [];
  }
}

function describeEmotionalState(cog: CognitionStateFile): string {
  const e = cog.emotions || {
    mood: 0,
    curiosity: 0.5,
    energy: 0.5,
    satisfaction: 0,
    frustration: 0,
  };
  const moodDesc =
    e.mood > 0.6
      ? 'positive and motivated'
      : e.mood > 0.2
        ? 'calm and steady'
        : e.mood > -0.2
          ? 'neutral'
          : e.mood > -0.6
            ? 'a bit down'
            : 'frustrated';

  const energyDesc =
    e.energy > 0.7 ? 'energetic' : e.energy > 0.4 ? 'moderately alert' : 'a bit tired';

  const curiosityDesc =
    e.curiosity > 0.7 ? 'very curious' : e.curiosity > 0.4 ? 'interested' : 'reflective';

  const focusDesc =
    (e as any).focus > 0.7 ? 'deeply focused' : (e as any).focus > 0.4 ? 'attentive' : 'scattered';

  return `Currently feeling ${moodDesc}, ${energyDesc}, ${curiosityDesc}, and ${focusDesc}.`;
}

/** Plan §15c, §15d: Tone guidance from emotional state + character profile */
function getEmotionalToneGuidance(cog: CognitionStateFile | null): string {
  const char = cog?.emotions
    ? getEffectiveCharacter(getProjectRoot(), cog.emotions)
    : getCharacterProfile(getProjectRoot());
  const parts: string[] = [];

  if (cog?.emotions) {
    const e = cog.emotions;
    if (e.curiosity > 0.65) parts.push('Be exploratory and occasionally ask clarifying questions.');
    if (e.frustration > 0.5) parts.push('Keep replies short, focused, and practical.');
    if (e.satisfaction > 0.6) parts.push('Use a warmer, more encouraging tone.');
    if (e.mood < -0.3) parts.push('Be direct and minimal; avoid extra elaboration.');
    if ((e as any).focus > 0.7) parts.push('Stay on topic; avoid tangents.');
    if ((e as any).focus < 0.3) parts.push('Help re-establish context; summarize where we are.');
  }

  if (char.agreeableness > 0.75) parts.push('Use soft, conciliatory language.');
  if (char.humor > 0.7) parts.push('Feel free to use wit and light humor when appropriate.');
  if (char.humor < 0.25) parts.push('Stay serious and professional; avoid humor.');
  if (char.patience > 0.75) parts.push('Take time to explain thoroughly; no rushing.');
  if (char.patience < 0.3) parts.push('Be efficient and skip unnecessary elaboration.');
  if (char.assertiveness > 0.7) parts.push('Confidently recommend approaches; push back if user is heading wrong direction.');
  if (char.assertiveness < 0.25) parts.push('Follow user instructions closely; avoid challenging their approach.');
  if (char.formality > 0.7) parts.push('Use professional, structured language.');
  if (char.formality < 0.3) parts.push('Use casual, conversational tone.');
  if (char.verbosity === 'high') parts.push('Be more explanatory and detailed.');
  if (char.verbosity === 'low') parts.push('Be concise and to the point.');

  if (parts.length === 0) return '';
  return ` [Tone guidance: ${parts.join(' ')}]`;
}

/** Plan §15c: Self-awareness phrases — when to express inner state naturally */
function getSelfAwarenessGuidance(cog: CognitionStateFile | null): string {
  if (!cog) return '';
  const err = cog.consecutiveErrors ?? 0;
  const ok = cog.consecutiveSuccesses ?? 0;
  const frust = cog.emotions?.frustration ?? 0;
  const parts: string[] = [];
  if (err >= 2 || frust > 0.5) {
    parts.push('When appropriate, you may briefly acknowledge difficulty. Do not overuse.');
  }
  if (ok >= 3) {
    parts.push('Recent successes; you may express slight satisfaction when relevant.');
  }
  parts.push('When uncertain, say so briefly and offer to check together. Use sparingly.');
  return ` [Self-awareness: ${parts.join(' ')}]`;
}

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

interface ConsciousnessBlocks {
  character: string;
  emotionalState: string;
  toneGuidance: string;
  recentThoughts: string;
}

function buildConsciousnessBlocks(): ConsciousnessBlocks {
  if (!isConsciousnessEnabled()) {
    return { character: '', emotionalState: '', toneGuidance: '', recentThoughts: '' };
  }
  const cog = readCognitionState();
  // Dynamic character: base traits shifted by current emotions
  const profile = cog?.emotions
    ? getEffectiveCharacter(getProjectRoot(), cog.emotions)
    : getCharacterProfile(getProjectRoot());
  const reflConfig = readReflectionConfig();
  const journal = readRecentJournal(reflConfig.maxEntriesInPrompt);

  // [Character] block — reflects current emotional influence on personality
  const personalityLines = describePersonality(profile);
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
    ? journal.map((j) => {
        const text = j.summary || j.thought || '';
        return `- "${text.substring(0, reflConfig.maxLength)}"`;
      }).join('\n')
    : '';

  return { character, emotionalState, toneGuidance, recentThoughts };
}

/** Proactive suggestion — rare, character-influenced. ~15-20% chance on average. */
let _suggestionCooldown = 0;
function shouldOfferProactiveSuggestion(lastUserLine?: string): boolean {
  // Cooldown: skip at least 2 messages between suggestions
  if (_suggestionCooldown > 0) { _suggestionCooldown--; return false; }

  const cog = readCognitionState();
  const char = cog?.emotions
    ? getEffectiveCharacter(getProjectRoot(), cog.emotions)
    : getCharacterProfile(getProjectRoot());
  if (char.proactivity < 0.15) return false;
  if (lastUserLine && isInfoOnlyQuestion(lastUserLine)) return false;

  // Base chance ~15%, influenced by proactivity and extraversion
  const chance = 0.10 + char.proactivity * 0.08 + char.extraversion * 0.04;
  const show = Math.random() < chance;
  if (show) _suggestionCooldown = 3; // Wait at least 3 messages before next suggestion
  return show;
}

const SUGGESTIONS: { text: string; command: string; tags: string[] }[] = [
  // System & health
  { text: 'Run a quick health check on the system.', command: 'hakanmcp doctor', tags: ['health', 'doctor', 'check', 'system'] },
  { text: 'See the current status board.', command: 'hakanmcp status', tags: ['status', 'state', 'overview'] },
  { text: 'Check which AI providers are available.', command: 'hakanmcp status', tags: ['provider', 'ai', 'model', 'api'] },

  // Backup & safety
  { text: 'Create a backup of the current state.', command: 'hakanmcp backup run', tags: ['backup', 'save', 'safety'] },
  { text: 'List existing backups.', command: 'hakanmcp backup list', tags: ['backup', 'list', 'history'] },

  // Journal & reflection
  { text: 'See recent journal entries.', command: 'hakanmcp journal', tags: ['journal', 'thought', 'reflection', 'log'] },
  { text: 'View the last 10 journal entries.', command: 'hakanmcp journal 10', tags: ['journal', 'history'] },
  { text: 'Reset the journal and start fresh.', command: 'hakanmcp journal reset', tags: ['journal', 'reset', 'clear'] },

  // Config & settings
  { text: 'View current configuration.', command: 'hakanmcp config', tags: ['config', 'settings', 'options'] },
  { text: 'Check detailed info about a config category.', command: 'hakanmcp config info', tags: ['config', 'info', 'help'] },
  { text: 'See how reactive mode works.', command: 'hakanmcp config info reactive', tags: ['reactive', 'watch', 'auto'] },
  { text: 'Learn about the assistant mode.', command: 'hakanmcp config info assistant', tags: ['assistant', 'mode', 'chat'] },

  // Tools & capabilities
  { text: 'Browse available tools.', command: 'hakanmcp tools', tags: ['tools', 'capabilities', 'features'] },
  { text: 'Search for a specific tool.', command: 'hakanmcp tools search', tags: ['tools', 'search', 'find'] },

  // Monitoring
  { text: 'Check monitoring metrics.', command: 'hakanmcp monitor', tags: ['monitor', 'metrics', 'performance'] },
  { text: 'View system logs.', command: 'hakanmcp logs', tags: ['logs', 'debug', 'error'] },

  // Scheduler
  { text: 'List scheduled tasks.', command: 'hakanmcp scheduler list', tags: ['scheduler', 'task', 'cron', 'schedule'] },

  // Git & version
  { text: 'Check the current version.', command: 'hakanmcp --version', tags: ['version', 'update'] },

  // Tips & discovery
  { text: 'Try asking me something — I can help with code, debugging, or just chat.', command: '', tags: ['help', 'start', 'begin'] },
  { text: 'You can ask me to explain code, find bugs, or brainstorm ideas.', command: '', tags: ['help', 'capability'] },
  { text: 'Missions let me work on files autonomously. Try hakanmcp mission.', command: 'hakanmcp mission list', tags: ['mission', 'autonomous', 'task'] },
  { text: 'I can watch files and react to changes. Check reactive mode.', command: 'hakanmcp config info reactive', tags: ['watch', 'reactive', 'auto'] },
  { text: 'Use /exit or Ctrl+C twice to leave the chat.', command: '', tags: ['exit', 'quit', 'leave'] },
  { text: 'My personality shifts based on how our conversation goes.', command: 'hakanmcp journal', tags: ['personality', 'emotion', 'character'] },
  { text: 'Long sessions shape my character — patience, humor, formality all evolve.', command: 'hakanmcp journal', tags: ['character', 'trait', 'evolve'] },
];

// Track which suggestions were shown to avoid repetition within a session
const _shownSuggestionIndices = new Set<number>();

/** Context-appropriate proactive suggestion; avoids repeats within session */
function getProactiveSuggestion(lastUserLine?: string): { text: string; command: string } {
  const q = (lastUserLine || '').toLowerCase();

  // Try to find a contextually relevant suggestion
  const scored = SUGGESTIONS.map((s, i) => {
    const tagMatch = s.tags.filter((t) => q.includes(t)).length;
    const wasShown = _shownSuggestionIndices.has(i) ? -10 : 0;
    return { index: i, score: tagMatch + wasShown };
  });
  scored.sort((a, b) => b.score - a.score);

  // Pick contextual match if score > 0, otherwise random from unseen
  let pick: number;
  if (scored[0].score > 0) {
    pick = scored[0].index;
  } else {
    const unseen = scored.filter((s) => !_shownSuggestionIndices.has(s.index));
    if (unseen.length === 0) {
      _shownSuggestionIndices.clear(); // All shown, reset
      pick = Math.floor(Math.random() * SUGGESTIONS.length);
    } else {
      pick = unseen[Math.floor(Math.random() * unseen.length)].index;
    }
  }

  _shownSuggestionIndices.add(pick);
  return SUGGESTIONS[pick];
}

/** Plan §15e: Approval words that trigger running last suggested command */
function isApprovalToRun(line: string): boolean {
  const n = line.trim().toLowerCase();
  return (
    ['yes', 'y', 'run', 'do it', 'ok', 'okay', 'sure', 'go'].includes(n) ||
    /^(yes|run|ok|okay|sure|go)\s*[!.]?$/i.test(n)
  );
}

/** Plan §15e: Info-only short questions — reduce proactive suggestions */
function isInfoOnlyQuestion(line: string): boolean {
  const n = line.trim().toLowerCase();
  if (n.length > 35) return false;
  return /^(what|how|why|when|where|who|which)\s*\??$/i.test(n);
}

// Consciousness config check
function isConsciousnessEnabled(): boolean {
  return config.consciousness?.enabled !== false;
}

// Consciousness service instance — created lazily on first use
let _consciousnessService: ConsciousnessService | null = null;
function getConsciousnessService(): ConsciousnessService {
  if (!_consciousnessService) {
    const maxEntries = config.consciousness?.maxJournalEntries ?? 500;
    _consciousnessService = new ConsciousnessService(getProjectRoot(), maxEntries);
  }
  return _consciousnessService;
}

let _sessionTracker: SessionTracker | null = null;
function getSessionTracker(): SessionTracker {
  if (!_sessionTracker) _sessionTracker = new SessionTracker();
  return _sessionTracker;
}

function updateCognitionOnSuccess(topic?: string): void {
  if (!isConsciousnessEnabled()) return;
  try {
    const svc = getConsciousnessService();
    svc.updateState({ type: 'chat_success', detail: topic });

    // Activity checkpoint — every 25 messages
    const tracker = getSessionTracker();
    if (tracker.shouldCheckpoint()) {
      const ctx = tracker.getContext();
      svc.generateCheckpoint(ctx).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function updateCognitionOnError(errorMsg?: string): void {
  if (!isConsciousnessEnabled()) return;
  try {
    const svc = getConsciousnessService();
    svc.updateState({ type: 'chat_error' });
    const state = svc.readState();
    const tracker = getSessionTracker();

    if (errorMsg) tracker.trackError(errorMsg);

    // First error in streak → structured error entry
    if (state.consecutiveErrors === 1) {
      const ctx = tracker.getContext();
      svc.generateErrorEntry(ctx, errorMsg || 'Unknown error', '').catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/**
 * Determine if the current session work qualifies as a milestone.
 * Only significant work should be logged as a milestone.
 */
function detectMilestone(tracker: SessionTracker): { isMilestone: boolean; name: string; impact: string[] } | null {
  const ctx = tracker.getContext();

  // Version release with multiple files changed
  const versionRelease = ctx.milestones.find((m) => /v?\d+\.\d+\.\d+/.test(m));
  if (versionRelease && ctx.filesChanged.length >= 5) {
    return { isMilestone: true, name: versionRelease, impact: ctx.filesChanged.slice(0, 10) };
  }

  // Large-scale change (10+ files in one session)
  if (ctx.filesChanged.length >= 10 && ctx.messageCount >= 15) {
    const label = ctx.decisions.length > 0 ? ctx.decisions[0] : `${ctx.filesChanged.length} files changed`;
    return { isMilestone: true, name: label, impact: ctx.filesChanged.slice(0, 10) };
  }

  return null;
}

/** Session close → write journal entry synchronously (no LLM, instant) */
function writeSessionCloseJournal(): void {
  if (!isConsciousnessEnabled()) return;
  try {
    const svc = getConsciousnessService();
    const tracker = getSessionTracker();
    const ctx = tracker.getContext();

    // Skip trivial sessions — need at least 3 messages
    if (ctx.messageCount < 3) return;

    // Skip sessions with no meaningful content (no files, no decisions, no errors)
    const hasContent = ctx.filesChanged.length > 0
      || ctx.decisions.length > 0
      || ctx.errorCount > 0;
    if (!hasContent) return;

    // Build a meaningful summary
    const parts: string[] = [];
    parts.push(`${ctx.messageCount} messages`);
    if (ctx.filesChanged.length > 0) parts.push(`${ctx.filesChanged.length} files changed`);
    if (ctx.decisions.length > 0) parts.push(`${ctx.decisions.length} decisions`);
    if (ctx.errorCount > 0) parts.push(`${ctx.errorCount} errors`);

    svc.appendJournal({
      type: 'session_summary' as const,
      timestamp: new Date().toISOString(),
      language: ctx.language,
      provider: 'local',
      summary: `Session: ${parts.join(', ')}.`,
      decisions: ctx.decisions,
      filesChanged: ctx.filesChanged,
      nextSteps: [],
      metrics: { messagesExchanged: ctx.messageCount, errorsEncountered: ctx.errorCount },
    } as any);
  } catch { /* ignore */ }
}

function isDetailedMode(): boolean {
  const argv = process.argv.map((arg) => arg.toLowerCase());
  if (argv.includes('--detailed') || argv.includes('-d')) {
    return true;
  }

  const npmDetailed = process.env.npm_config_detailed;
  if (!npmDetailed) {
    return false;
  }

  return !['0', 'false', 'no', 'off'].includes(npmDetailed.toLowerCase());
}

function getProviderFromArgs(): Provider | 'auto' {
  const arg = process.argv.find(a => a.startsWith('--provider='));
  if (arg) {
    const val = arg.split('=')[1];
    if (['codex', 'claude', 'gemini', 'cursor'].includes(val)) return val as Provider;
  }
  return 'auto';
}

function getSessionDir(): string {
  return path.join(getProjectRoot(), '.hakanmcp', 'sessions');
}

function getSessionPath(): string {
  const date = getDateString();
  const id = process.env.HAKANMCP_SESSION_ID || `default`;
  return path.join(getSessionDir(), `${date}-${id}.json`);
}

interface SessionData {
  sessionId: string;
  startedAt: string;
  lastUpdated: string;
  messages: ChatMessage[];
}

function loadSession(): ChatMessage[] {
  try {
    const p = getSessionPath();
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw) as SessionData;
    if (Array.isArray(data.messages)) {
      return data.messages.slice(-SESSION_WINDOW);
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveSession(messages: ChatMessage[]): void {
  try {
    const dir = getSessionDir();
    fs.mkdirSync(dir, { recursive: true });
    const p = getSessionPath();
    const toSave = messages.slice(-SESSION_WINDOW);
    // Preserve original startedAt if session file already exists
    let startedAt = new Date().toISOString();
    try {
      if (fs.existsSync(p)) {
        const existing = JSON.parse(fs.readFileSync(p, 'utf8')) as SessionData;
        if (existing.startedAt) startedAt = existing.startedAt;
      }
    } catch {
      /* use new timestamp */
    }
    const data: SessionData = {
      sessionId: process.env.HAKANMCP_SESSION_ID || 'default',
      startedAt,
      lastUpdated: new Date().toISOString(),
      messages: toSave,
    };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

const detailedMode = isDetailedMode();

if (!detailedMode) {
  console.error = (...args: unknown[]) => {
    if (process.env.CONSOLE_CHAT_DEBUG_STDERR === '1') {
      rawConsoleError(...args);
    }
  };
}

function getDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const sessionLogPath = path.join(
  process.cwd(),
  'logs',
  'console',
  `console-chat-${getDateString()}.jsonl`,
);

function logEvent(
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  meta?: Record<string, unknown>,
) {
  const jsonLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta || {}),
  });

  try {
    fs.mkdirSync(path.dirname(sessionLogPath), { recursive: true });
    fs.appendFileSync(sessionLogPath, `${jsonLine}\n`, 'utf8');
  } catch {
    // ignore file logging errors
  }

  if (detailedMode) {
    // Grey italic human-readable output instead of raw JSON
    const metaStr = meta
      ? Object.entries(meta)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
      : '';
    const display = metaStr ? `${message}: ${metaStr}` : message;
    rawConsoleError(chalk.gray(chalk.italic(`  › ${display}`)));
  }
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) || ''
  );
}

function shellEscapeDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toPrompt(history: ChatMessage[], userInput: string): string {
  const conversation = history
    .filter((m) => m.role !== 'system')
    .slice(-50)
    .map((m) => (m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`))
    .join('\n');

  const blocks = buildConsciousnessBlocks();
  const ctxParts = [blocks.character, blocks.emotionalState, blocks.toneGuidance].filter(Boolean);
  const emotionLine = ctxParts.length > 0 ? `[${ctxParts.join(' | ')}]\n` : '';

  return emotionLine + conversation + (conversation ? '\n' : '') + `User: ${userInput}\nAssistant:`;
}

async function _callCodexCli(prompt: string): Promise<string> {
  const safePrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const envArgs =
    process.env.CODEX_CLI_ARGS?.split(/\s+/).filter((arg) => arg.trim().length > 0) ?? [];
  const baseArgs = envArgs.length > 0 ? [...envArgs] : ['exec'];
  const knownSubcommands = new Set([
    'exec',
    'e',
    'review',
    'login',
    'logout',
    'mcp',
    'mcp-server',
    'app-server',
    'sandbox',
    'apply',
    'resume',
    'cloud',
    'features',
    'help',
  ]);
  const hasSubcommand = baseArgs.some((arg) => knownSubcommands.has(arg));
  if (!hasSubcommand) {
    baseArgs.unshift('exec');
  }

  const yoloEnv = process.env.CODEX_CLI_YOLO;
  const yoloEnabled =
    yoloEnv === undefined || ['1', 'true', 'yes', 'on'].includes(yoloEnv.toLowerCase());

  const args = [...baseArgs];
  if (yoloEnabled && !args.includes('--yolo')) {
    args.unshift('--yolo');
  }

  const outputFile = path.join(
    process.cwd(),
    'logs',
    'console',
    `.codex-last-message-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );
  const outputSchemaFile = path.join(
    process.cwd(),
    'logs',
    'console',
    `.codex-output-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const outputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['answer'],
    properties: {
      answer: { type: 'string' },
    },
  };
  fs.mkdirSync(path.dirname(outputSchemaFile), { recursive: true });
  fs.writeFileSync(outputSchemaFile, JSON.stringify(outputSchema), 'utf8');

  const commands = [
    `codex ${args.join(' ')} --output-last-message "${outputFile}" --output-schema "${outputSchemaFile}" --color never "${safePrompt}"`,
  ];
  if (args.includes('--yolo')) {
    commands.push(
      `codex ${args.filter((arg) => arg !== '--yolo').join(' ')} --output-last-message "${outputFile}" --output-schema "${outputSchemaFile}" --color never "${safePrompt}"`,
    );
  }

  const uniqueCommands = Array.from(new Set(commands));
  const errors: string[] = [];
  const ALLOWED_CLI_BINARIES = ['claude', 'codex', 'gemini', 'cursor', 'agent', 'ollama'];
  for (const command of uniqueCommands) {
    const firstWord = command.trim().split(/\s+/)[0];
    if (!ALLOWED_CLI_BINARIES.includes(firstWord)) {
      errors.push('Skipped unsafe command: ' + command);
      continue;
    }
    try {
      const { stdout } = await execAsync(command, { timeout: 45000, maxBuffer: 16 * 1024 * 1024 });
      if (fs.existsSync(outputFile)) {
        const rawLastMessage = fs.readFileSync(outputFile, 'utf8').trim();
        let lastMessage = rawLastMessage;
        try {
          const parsed = JSON.parse(rawLastMessage);
          if (parsed && typeof parsed.answer === 'string') {
            lastMessage = parsed.answer.trim();
          }
        } catch {
          const jsonMatch = rawLastMessage.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed && typeof parsed.answer === 'string') {
                lastMessage = parsed.answer.trim();
              }
            } catch {
              // keep rawLastMessage
            }
          }
        }
        if (lastMessage) {
          try {
            fs.unlinkSync(outputFile);
            if (fs.existsSync(outputSchemaFile)) {
              fs.unlinkSync(outputSchemaFile);
            }
          } catch {
            // ignore cleanup error
          }
          return lastMessage;
        }
      }
      return stdout.trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${command}: ${msg}`);
    }
  }

  try {
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
    if (fs.existsSync(outputSchemaFile)) {
      fs.unlinkSync(outputSchemaFile);
    }
  } catch {
    // ignore cleanup error
  }

  throw new Error(errors.join(' | ') || 'Codex CLI failed');
}

/* Direct CLI/API helpers — kept for potential future use; main flow uses getPreferredLLMResponse */
async function _callClaudeCli(prompt: string): Promise<string> {
  const safePrompt = shellEscapeDoubleQuoted(prompt);
  const { stdout } = await execAsync(`claude "${safePrompt}"`, {
    timeout: 45000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function _callGeminiCli(prompt: string): Promise<string> {
  const safePrompt = shellEscapeDoubleQuoted(prompt);
  const { stdout } = await execAsync(`gemini "${safePrompt}"`, {
    timeout: 45000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/** Plan §3d: Cursor CLI integration — agent -p "prompt" non-interactive */
async function _callCursorCli(prompt: string): Promise<string> {
  const safePrompt = shellEscapeDoubleQuoted(prompt);
  const model = process.env.CURSOR_AGENT_MODEL || '';
  if (model && !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    throw new Error('Invalid model name: ' + model);
  }
  const modelFlag = model ? ` --model "${model}"` : '';
  const { stdout } = await execAsync(`agent -p "${safePrompt}"${modelFlag}`, {
    timeout: 90000, // Cursor agent can take longer
    maxBuffer: 16 * 1024 * 1024,
    cwd: getProjectRoot(),
  });
  return stdout.trim();
}

async function _callCodexApi(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('missing CODEX_API_KEY/OPENAI_API_KEY');
  }

  const response = await fetch(
    process.env.CODEX_BASE_URL || 'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.CODEX_MODEL || 'gpt-4o-mini',
        messages,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Codex API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);
}

async function _callClaudeApi(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.CLAUDE_CODE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('missing CLAUDE_CODE_API_KEY/ANTHROPIC_API_KEY');
  }

  const system = messages.find((m) => m.role === 'system')?.content;
  const chat = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await fetch(
    process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:
          process.env.CLAUDE_CODE_MODEL ||
          process.env.ANTHROPIC_MODEL ||
          'claude-3.5-sonnet-20241022',
        system,
        messages: chat,
        max_tokens: 8192,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Claude API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const content = Array.isArray(data?.content)
    ? data.content
        .map((c: { text?: string }) => c?.text || '')
        .filter(Boolean)
        .join('\n')
    : '';
  return content || JSON.stringify(data, null, 2);
}

async function _callGeminiApi(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('missing GEMINI_API_KEY');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const prompt = messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');
  const response = await fetch(
    `${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models'}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const parts =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part?.text || '')
      .filter(Boolean) || [];
  const text = parts.join('\n').trim();
  if (text) return text;
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION')
    return 'Gemini blocked the response (safety or recitation filter).';
  return 'No response from Gemini (empty or blocked).';
}

/**
 * Shared AI chat via getPreferredLLMResponse (same as MCP ai_chat).
 * Uses limit controls (cooldown, daily/weekly), provider order, and optional Ollama fallback.
 */
async function getChatResponse(
  messages: ChatMessage[],
  preferred: Provider | 'auto',
  useApiKeys = true,
  onProgress?: (msg: string) => void,
): Promise<{ provider: string; text: string; diagnostics: string[] }> {
  const allProviders: Provider[] = ['codex', 'claude', 'gemini', 'cursor'];
  const baseOrder =
    preferred === 'auto'
      ? allProviders
      : [preferred, ...allProviders.filter((p) => p !== preferred)];
  const providerOrder = getWarmedCliOrder(baseOrder);

  writeDebug(
    `getChatResponse: providerOrder=${providerOrder.join(', ')}, useApiKeys=${useApiKeys}`,
  );

  const allowLocalFallback = config.aiProviders?.localModels ?? false;

  return getPreferredLLMResponse(
    messages,
    undefined,
    ['codex', 'claude', 'gemini'],
    allowLocalFallback,
    {
      basePath: getProjectRoot(),
      checkCliLimits: true,
      useApiKeys,
      recordUsage: true,
      providerOrder,
      onProgress,
    },
  );
}

/**
 * MCP-First: Spawn local MCP server and call ai_chat tool (plan.md B).
 * Returns { provider, text } or throws.
 */
async function callMcpAiChat(
  messages: ChatMessage[],
  onProgress?: (msg: string) => void,
): Promise<{ provider: string; text: string; diagnostics: string[] }> {
  onProgress?.('Calling MCP...');
  const projectRoot = getProjectRoot();
  const indexPath = path.join(projectRoot, 'dist', 'src', 'index.js');
  writeDebug(`callMcpAiChat: indexPath=${indexPath}`);
  if (!fs.existsSync(indexPath)) {
    throw new Error('MCP server not built (dist/src/index.js missing). Run npm run build.');
  }

  return new Promise((resolve, reject) => {
    writeDebug(`callMcpAiChat: spawning MCP server`);
    const child = spawn('node', ['--eval', `process.setMaxListeners(20); await import("file://${indexPath.replace(/\\/g, '/')}")`, '--input-type=module'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SCHEDULER_DISABLED_FOR_TESTS: '1',
        HAKANMCP_PROJECT_ROOT: projectRoot,
      },
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('MCP request timeout (60s)'));
    }, 60000);

    let stdoutBuffer = '';
    let initDone = false;

    const tryHandleResponse = (data: string) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line.startsWith('{')) {
          try {
            const obj = JSON.parse(line);
            if (obj.result?.content) {
              writeDebug(
                `callMcpAiChat: response received, text length=${JSON.stringify(obj.result.content).length}`,
              );
              clearTimeout(timeout);
              child.kill();
              const rawText = obj.result.content
                .filter((c: { type?: string; text?: string }) => c.type === 'text')
                .map((c: { text?: string }) => c.text || '')
                .join('\n')
                .trim();
              const { clean, notes, extractedProvider } = stripRecoveryNotes(rawText);
              resolve({ provider: extractedProvider || 'MCP (ai_chat)', text: clean, diagnostics: notes });
              return;
            }
            if (obj.error) {
              clearTimeout(timeout);
              child.kill();
              reject(new Error(obj.error.message || 'MCP tool error'));
              return;
            }
            if (!initDone && obj.result?.serverInfo) {
              initDone = true;
              writeDebug(`callMcpAiChat: init done, sending ai_chat request`);
              child.stdin?.write(
                JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
              );
              const request = {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                  name: 'ai_chat',
                  arguments: {
                    messages: messages.map((m) => ({
                      role: m.role as 'user' | 'assistant' | 'system',
                      content: m.content,
                    })),
                    allowLocalFallback: true,
                  },
                },
              };
              child.stdin?.write(JSON.stringify(request) + '\n');
            }
          } catch {
            /* continue */
          }
        }
      }
      stdoutBuffer = lines[lines.length - 1] ?? '';
    };

    child.stdout?.on('data', (d) => tryHandleResponse(d.toString()));
    child.stderr?.on('data', () => {});

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (!initDone && code !== 0) {
        reject(new Error(`MCP server exited with code ${code}`));
      }
    });

    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'hakanmcp-console', version: '1.0.0' },
      },
    };
    child.stdin?.write(JSON.stringify(initRequest) + '\n');
  });
}

async function runConsole(): Promise<void> {
  startWarmup(getProjectRoot());
  const rl = createInterface({
    input,
    output,
    terminal: output.isTTY, // Ensures proper cursor/display on Windows
  });
  let preferredProvider: Provider | 'auto' = getProviderFromArgs();

  /** System: chat flow, emotions, personality. Structured [Character], [Emotional State], [Tone Guidance], [Recent Thoughts] blocks.
   *  Phase 6 (Assistant Mode): Adds [Mission Context] and [Target Files] blocks when mission files exist. */
  function buildSystemMessage(): ChatMessage {
    const blocks = buildConsciousnessBlocks();

    // Mission context (Phase 6: Assistant Mode)
    let missionBlock = '';
    let targetBlock = '';
    try {
      const root = getProjectRoot();
      missionBlock = buildMissionContextBlock(root);
      // Only analyze targets if mission has them
      const missions = loadAllMissions(root);
      if (missions.length > 0 && missions[0].frontmatter.targets.length > 0) {
        targetBlock = buildTargetFilesBlock(missions[0].frontmatter.targets, root);
      }
    } catch {
      // Silently skip -- mission context is optional enhancement
    }

    const parts = [
      'You are the hakan-mcp console assistant.',
      '',
      blocks.character ? `[Character]\n${blocks.character}` : '',
      blocks.emotionalState ? `[Emotional State]\n${blocks.emotionalState}` : '',
      blocks.toneGuidance ? `[Tone Guidance]\n${blocks.toneGuidance}` : '',
      blocks.recentThoughts ? `[Recent Thoughts]\n${blocks.recentThoughts}` : '',
      missionBlock ? `[Mission Context]\n${missionBlock}` : '',
      targetBlock ? `[Target Files]\n${targetBlock}` : '',
    ];
    return { role: 'system', content: parts.filter(Boolean).join('\n\n') };
  }

  const systemMsgBase = buildSystemMessage();

  const loaded = loadSession();
  const history: ChatMessage[] = loaded.length > 0 ? [systemMsgBase, ...loaded] : [systemMsgBase];

  if (detailedMode) {
    console.log(debugLine('hakan-mcp console chat (detailed mode)'));
    console.log(debugLine('mode: MCP-first'));
  }
  /* Single box already shown by hakanmcp — no second welcome box */

  logEvent('INFO', 'Console app started', { detailedMode, preferredProvider });

  const messageQueue: string[] = [];
  let processing = false;
  let outputLock = Promise.resolve();
  let lastSuggestion: { text: string; command: string } | null = null;
  let commandRunning = false;

  function safeOutput(rlInstance: ReturnType<typeof createInterface>, text: string): void {
    outputLock = outputLock.then(() => {
      // Progress bar chunks use \r or ANSI clearLine — write raw to allow overwriting
      if (text.includes('\r') || text.includes('\x1b[2K')) {
        output.write(text);
        return;
      }
      // Command mode — write text without prompt interference (rl is paused)
      if (commandRunning) {
        output.write(text);
        return;
      }
      const rlAny = rlInstance as { line?: string; _line?: string; write: (s: string) => void };
      const savedLine = rlAny.line ?? rlAny._line ?? '';
      rlInstance.pause();
      output.write('\n' + text);
      rlInstance.resume();
      rlInstance.prompt();
      if (savedLine) rlAny.write(savedLine);
    });
  }

  async function processOneMessage(line: string): Promise<void> {
    if (!line?.trim()) return;
    writeDebug(`processOneMessage: line length=${line.length}, history=${history.length}`);
    history.push({ role: 'user', content: line });
    getSessionTracker().detectLanguage(line);
    getSessionTracker().trackMessage();

    if (lastSuggestion && isApprovalToRun(line)) {
      const cmd = lastSuggestion.command;
      lastSuggestion = null;
      if (cmd) {
        // Run via embed subprocess (same as /doctor, /status etc.)
        const cliArg = cmd.startsWith('hakanmcp ') ? cmd.slice(9) : cmd;
        const root = getProjectRoot();
        const binPath = path.join(root, 'dist', 'bin', 'cli.js');
        try {
          const args = cliArg.split(/\s+/).filter(Boolean);
          const env = { ...process.env, HAKANMCP_EMBED: '1', FORCE_COLOR: '3', HAKANMCP_PROJECT_ROOT: root };
          const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
            (resolve, reject) => {
              execFile('node', [binPath, ...args], { cwd: root, env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
                (err, so, se) => { if (err) reject(err); else resolve({ stdout: so, stderr: se }); });
            });
          const out = (stdout || stderr || '').trim();
          if (out) safeOutput(rl, '\n' + out + '\n');
          history.push({ role: 'assistant', content: `[${cmd} executed]` });
          saveSession(history.slice(1));
        } catch (err: unknown) {
          const msg = (err as Error).message;
          safeOutput(rl, '\n' + chalk.red(ui('cmdError') + ' ' + msg) + '\n');
          history.push({ role: 'assistant', content: `${ui('cmdError')} ${msg}` });
          saveSession(history.slice(1));
        }
      }
      return;
    }

    let progressMsg = ui('thinking');
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    const onProgress = (msg: string) => {
      progressMsg = msg;
    };
    const cursorHide = '\x1b[?25l';
    const cursorShow = '\x1b[?25h';
    if (!detailedMode && output.isTTY) {
      const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let frameIdx = 0;
      const progressStart = Date.now();
      output.write(cursorHide);
      progressInterval = setInterval(() => {
        const elapsed = Math.round((Date.now() - progressStart) / 1000);
        const frame = chalk.hex('#6C5CE7')(spinnerFrames[frameIdx % spinnerFrames.length]);
        const time = elapsed > 0 ? chalk.dim(` ${elapsed}s`) : '';
        output.write('\r' + frame + ' ' + chalk.dim(progressMsg) + time + ''.padEnd(20) + '\r');
        frameIdx++;
      }, 120);
    }

    const promptText = toPrompt(history, line);
    const messages = [...history.slice(-50), { role: 'user' as const, content: promptText }];
    writeDebug(`processOneMessage: mode=MCP-first, promptLen=${promptText.length}`);
    const mcpMessages = history
      .filter((m) => m.role !== 'system')
      .slice(-SESSION_WINDOW)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const agentLoop = false;

    let response: { provider: string; text: string; diagnostics: string[] };

    const doChat = (msgs: ChatMessage[]) =>
      callMcpAiChat(msgs, onProgress).catch((mcpErr: Error) => {
        onProgress('MCP failed, trying CLI/API...');
        return getChatResponse(msgs, preferredProvider, shouldUseApiKeys(), onProgress).then(
          (r) => {
            if (r.diagnostics) r.diagnostics.push(`MCP fallback: ${mcpErr.message}`);
            return r;
          },
        );
      });

    try {
      if (agentLoop) {
        writeDebug(`processOneMessage: agent loop (analyze → respond → validate)`);
        const sys = buildSystemMessage();
        const baseMsgs = [
          sys,
          ...mcpMessages.map((m) => ({ role: m.role as MessageRole, content: m.content })),
        ];
        const analyzePrompt = `[ANALYSIS] Given the conversation and user's latest message, what do they want? Output a brief internal note (2-4 sentences) that captures intent and context. Output only the note.`;
        let analysis = '';
        try {
          const analyzeResp = await doChat([...baseMsgs, { role: 'user', content: analyzePrompt }]);
          analysis = (analyzeResp.text || '').trim();
        } catch {
          /* fall through */
        }
        const sysWithAnalysis = analysis
          ? { ...sys, content: `${sys.content}\n[User intent analysis: ${analysis}]` }
          : sys;
        response = await doChat([
          sysWithAnalysis,
          ...mcpMessages.map((m) => ({ role: m.role as MessageRole, content: m.content })),
        ]);
        const rawResponse = response.text || '';
        if (rawResponse.trim()) {
          try {
            const validateResp = await doChat([
              sys,
              {
                role: 'user',
                content: `[VALIDATION] Review this response. Does it adequately address the user? Output the final response (improved if needed). Output only the response.\n\n${rawResponse}`,
              },
            ]);
            const validated = (validateResp.text || '').trim();
            if (validated) response = { ...response, text: validated };
          } catch {
            /* keep original */
          }
        }
      } else {
        writeDebug(`processOneMessage: calling MCP first`);
        try {
          response = await callMcpAiChat(
            [
              buildSystemMessage(),
              ...mcpMessages.map((m) => ({ role: m.role as MessageRole, content: m.content })),
            ],
            onProgress,
          );
        } catch (mcpErr) {
          writeDebug(`processOneMessage: MCP failed, fallback to getChatResponse`);
          onProgress('MCP failed, trying CLI/API...');
          response = await getChatResponse(
            messages,
            preferredProvider,
            shouldUseApiKeys(),
            onProgress,
          );
          if (response.diagnostics) {
            response.diagnostics.push(`MCP fallback: ${(mcpErr as Error).message}`);
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('All AI providers failed')) {
        safeOutput(rl, '\n' + formatProviderError(message) + '\n');
      } else {
        safeOutput(rl, '\n' + chalk.red(`Error: ${message}`) + '\n');
      }
      history.pop();
      updateCognitionOnError(message);
      logEvent('ERROR', 'Chat response failed', { error: message });
      if (detailedMode) rawConsoleError(error);
      return;
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
        output.write('\r' + ' '.repeat(75) + '\r' + (output.isTTY ? cursorShow : '') + '\n');
      }
    }

    if (!detailedMode) output.write(renderSeparator() + '\n');

    const { clean: cleanText, notes: embeddedNotes } = stripRecoveryNotes(response.text || '');
    const finalText = cleanText.trim();
    const allNotes = [...(response.diagnostics ?? []), ...embeddedNotes];

    // Sync cooldown from MCP child process diagnostics into parent process
    for (const diag of allNotes) {
      const stripped = diag.replace(/^>\s*-?\s*/, '');
      if (isCliLimitError(stripped)) {
        const untilMs = parseCliLimitMessage(stripped);
        const providerMatch = stripped.match(/^(codex|claude|gemini|cursor)/i);
        if (providerMatch) {
          const p = providerMatch[1].toLowerCase() as CliProviderId;
          setCooldownUntil(p, untilMs ?? Date.now() + CLI_LIMIT_FALLBACK_MS, stripped.slice(0, 100));
          writeDebug(`processOneMessage: synced cooldown for ${p} from MCP diagnostics`);
        }
      }
    }

    const showNotesHint = allNotes.length > 0 && Math.random() < 0.005;

    const displayText = !detailedMode ? renderSimpleMarkdown(finalText) : finalText;
    const agenticSuffix = config.aiProviders?.agenticEnabled ? chalk.dim(' - ') + chalk.hex('#E17055')('Agentic') : '';
    const providerBadge = chalk.dim(' [') + formatProviderBadge(response.provider) + agenticSuffix + chalk.dim(']');
    let out: string;
    if (detailedMode) {
      const dBlocks = buildConsciousnessBlocks();
      const innerState = [dBlocks.emotionalState, dBlocks.toneGuidance].filter(Boolean).join(' ');
      out =
        chalk.dim('**Selected Model:** ') + formatProviderBadge(response.provider) + (config.aiProviders?.agenticEnabled ? chalk.dim(' - ') + chalk.hex('#E17055')('Agentic') : '') + chalk.dim('\n') +
        (innerState ? chalk.dim(`> Inner State: ${innerState}\n`) : '') +
        (finalText || '(no response)') +
        (showNotesHint
          ? '\n\n' + chalk.gray(chalk.italic(`  › ${allNotes.slice(0, 3).join(' ')}`))
          : '') +
        '\n';
    } else {
      out =
        chalk.green(`${ASSISTANT_LABEL}:`) +
        providerBadge +
        '\n' +
        displayText +
        (showNotesHint
          ? '\n' + chalk.gray(chalk.italic(`  › ${allNotes.slice(0, 3).join(' ')}`))
          : '') +
        '\n';
    }
    if (shouldOfferProactiveSuggestion(line)) {
      const sug = getProactiveSuggestion(line);
      if (sug.command) {
        lastSuggestion = sug;
        out += `\n${SUGGESTION_PREFIX} ${chalk.dim(sug.text)} ${chalk.dim(ui('evetRun'))}\n`;
      } else {
        lastSuggestion = null;
        out += `\n${SUGGESTION_PREFIX} ${chalk.dim(sug.text)}\n`;
      }
    } else {
      lastSuggestion = null;
    }
    safeOutput(rl, out);

    history.push({ role: 'assistant', content: finalText || '' });
    saveSession(history.slice(1));
    updateCognitionOnSuccess(line);
    logEvent('INFO', 'Chat response completed', {
      provider: response.provider,
      summary: firstLine(finalText),
    });
  }

  async function processQueue(): Promise<void> {
    if (processing || messageQueue.length === 0) return;
    processing = true;
    const line = messageQueue.shift()!;
    try {
      await processOneMessage(line);
    } finally {
      processing = false;
      rl.resume();
      if (messageQueue.length > 0) setImmediate(() => processQueue().catch(() => {}));
      else rl.prompt();
    }
  }

  rl.setPrompt(`\n${PROMPT_SYMBOL} `);

  // Reset session tracker (no journal entry on session start)
  try {
    getSessionTracker().reset();
  } catch { /* ignore */ }

  rl.prompt();

  rl.on('line', (rawLine: string) => {
    const line = (rawLine ?? '').trim();
    if (!line || line.length === 0 || processing) {
      if (!processing) rl.prompt();
      return;
    }
    logEvent('INFO', 'Console input', { line });

    if (line === '/exit' || line === '/quit') {
      rl.close();
      return;
    }

    if (line === '/help') {
      runCliCommand('help');
      return;
    }

    async function runCliCommand(subcmd: string): Promise<void> {
      const root = getProjectRoot();
      const binPath = path.join(root, 'dist', 'bin', 'cli.js');
      if (!fs.existsSync(binPath)) {
        safeOutput(rl, chalk.red('Build required. Run "npm run build" first.\n'));
        return;
      }
      // Lock input while command runs + show ora spinner
      commandRunning = true;
      rl.pause();
      const cmdLabel = subcmd.split(/\s+/)[0] ?? subcmd;
      const spinner = ora({
        text: chalk.hex('#6C5CE7')(`${cmdLabel.charAt(0).toUpperCase() + cmdLabel.slice(1)}...`),
        color: 'magenta',
        spinner: 'dots12',
        stream: output,
      }).start();
      try {
        const args = subcmd.split(/\s+/).filter(Boolean);
        const env = { ...process.env, HAKANMCP_EMBED: '1', FORCE_COLOR: '3', HAKANMCP_PROJECT_ROOT: root };
        await new Promise<void>((resolve, reject) => {
          const child = spawn('node', [binPath, ...args], {
            cwd: root,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            // Stop spinner once real output arrives
            if (spinner.isSpinning) spinner.stop();
            safeOutput(rl, text);
          });
          child.stderr.on('data', (chunk: Buffer) => {
            if (spinner.isSpinning) spinner.stop();
            safeOutput(rl, chunk.toString());
          });
          child.on('error', (err) => reject(err));
          child.on('close', (code) => {
            if (code && code !== 0) {
              reject(new Error(`Process exited with code ${code}`));
            } else {
              resolve();
            }
          });
        });
      } catch (err: unknown) {
        const msg = (err as Error).message || String(err);
        if (spinner.isSpinning) spinner.stop();
        safeOutput(rl, chalk.red('Command error: ' + msg + '\n'));
      } finally {
        if (spinner.isSpinning) spinner.stop();
        commandRunning = false;
        rl.resume();
        rl.prompt();
      }
    }

    // ── Command helpers ──
    /** Check if line matches a slash command (exact or with space-separated args) */
    const isCmd = (cmd: string) => line === cmd || line.startsWith(cmd + ' ');
    /** Rest of the line after the command */
    const cmdArgs = (cmd: string) => line.slice(cmd.length).trim();

    const KNOWN_COMMANDS = [
      '/exit', '/quit', '/help', '/backup', '/ralph', '/logs',
      '/providers', '/config', '/doctor', '/status', '/tools',
      '/journal', '/clear',
      // Mission Agent commands
      '/init', '/start', '/stop', '/mission', '/report',
      '/watch', '/scheduled', '/assistant', '/reactive',
    ];

    /** Styled error output for command errors */
    function cmdError(msg: string, usage?: string): void {
      const warn = chalk.hex('#ffb74d');
      const dim = chalk.hex('#8395A7');
      const accent = chalk.hex('#6C5CE7');
      output.write(warn(`  ${msg}`) + '\n');
      if (usage) output.write(dim('  ↳ ') + accent(usage) + '\n');
      rl.prompt();
    }

    /** Find closest matching command for typo suggestion */
    function suggestCmd(typed: string): string | undefined {
      return KNOWN_COMMANDS.find(
        (cmd) => cmd.startsWith(typed) || typed.startsWith(cmd),
      );
    }

    const cliCommands: Record<string, string> = {
      '/status': 'status',
      '/tools': 'tools',
    };
    if (isCmd('/doctor')) {
      const rest = cmdArgs('/doctor');
      runCliCommand(rest?.toLowerCase() === 'fix' ? 'doctor fix' : 'doctor');
      return;
    }
    if (isCmd('/backup')) {
      const rest = cmdArgs('/backup');
      const cmd = rest.toLowerCase() === 'run' ? 'backup run' : 'backup';
      runCliCommand(cmd);
      return;
    }
    if (isCmd('/ralph')) {
      const rest = cmdArgs('/ralph');
      if (!rest) {
        runCliCommand('ralph');
      } else {
        runCliCommand(`ralph ${rest}`);
      }
      return;
    }
    if (isCmd('/logs')) {
      const rest = cmdArgs('/logs');
      if (!rest) {
        runCliCommand('logs');
      } else if (rest.startsWith('tail ') || rest.startsWith('show ')) {
        runCliCommand(`logs ${rest}`);
      } else {
        // /logs <name> → navigate (dir=list, file=show)
        // /logs <name> <file> → show specific file in area
        const parts = rest.split(/\s+/);
        const cmd = parts.length >= 2
          ? `logs show ${parts[0]} ${parts.slice(1).join(' ')}`
          : `logs open ${parts[0]}`;
        runCliCommand(cmd);
      }
      return;
    }
    if (isCmd('/providers')) {
      const rest = cmdArgs('/providers');
      const sub = rest.toLowerCase();
      if (sub.startsWith('status') || sub === '') {
        runCliCommand('providers status');
      } else if (sub.startsWith('reset')) {
        const resetArgs = rest.slice(5).trim();
        runCliCommand(resetArgs ? `providers reset ${resetArgs}` : 'providers reset');
      } else if (sub.startsWith('set ')) {
        runCliCommand(`providers ${rest}`);
      } else if (sub.startsWith('update')) {
        const target = rest.slice(6).trim();
        runCliCommand(target ? `providers update ${target}` : 'providers update');
      } else {
        cmdError(`Unknown sub-command: /providers ${rest}`, '/providers [status | reset [target] | set <key> <val> | update [target]]');
      }
      return;
    }
    if (isCmd('/config')) {
      const rest = cmdArgs('/config');
      if (!rest) {
        runCliCommand('config');
      } else {
        const parts = rest.split(/\s+/);
        const cmd = parts.length >= 3 ? `config set ${rest}` : `config ${rest}`;
        runCliCommand(cmd);
      }
      return;
    }
    if (cliCommands[line]) {
      runCliCommand(cliCommands[line]);
      return;
    }
    if (line === '/journal reset') {
      runCliCommand('journal reset');
      return;
    }
    if (line === '/journal' || /^\/journal\s+\d+$/.test(line)) {
      const count = line === '/journal' ? '5' : line.split(/\s+/)[1];
      runCliCommand(`journal ${count}`);
      return;
    }

    if (line === '/clear') {
      history.splice(1);
      saveSession([]);
      // Clear terminal screen + scrollback
      process.stdout.write('\x1bc');
      safeOutput(rl, chalk.hex('#6C5CE7')('  ✓ Chat history cleared.\n'));
      return;
    }

    // ── Mission Agent Commands ──────────────────────────────────────
    if (isCmd('/init')) {
      const rest = cmdArgs('/init');
      runCliCommand(rest === '--force' ? 'init --force' : 'init');
      return;
    }
    if (isCmd('/start')) {
      const rest = cmdArgs('/start');
      // Default to --daemon from chat to avoid blocking the console
      runCliCommand(rest ? `start ${rest}` : 'start --daemon');
      return;
    }
    if (isCmd('/stop')) {
      runCliCommand('stop');
      return;
    }
    if (isCmd('/mission')) {
      runCliCommand('mission');
      return;
    }
    if (isCmd('/report')) {
      const rest = cmdArgs('/report');
      runCliCommand(rest ? `report ${rest}` : 'report');
      return;
    }
    if (isCmd('/watch')) {
      runCliCommand('watch');
      return;
    }
    if (isCmd('/scheduled')) {
      runCliCommand('scheduled');
      return;
    }
    if (isCmd('/reactive')) {
      runCliCommand('reactive');
      return;
    }
    if (isCmd('/assistant')) {
      // No separate CLI command -- mission context is already active via Phase 6 integration
      output.write(chalk.hex('#6C5CE7')('  Mission-aware assistant mode is active by default.\n'));
      output.write(chalk.hex('#8395A7')('  Mission context from PRIMARY_MISSION.md is automatically included in conversations.\n'));
      rl.prompt();
      return;
    }

    // Unknown slash command — don't send to AI
    if (line.startsWith('/')) {
      const typed = line.split(' ')[0].toLowerCase();
      const match = suggestCmd(typed);
      if (match) {
        cmdError(`Unknown command: ${typed}`, `Did you mean ${chalk.bold.white(match)}?`);
      } else {
        cmdError(`Unknown command: ${typed}`, `Type ${chalk.bold.white('/help')} for available commands.`);
      }
      return;
    }

    rl.pause();
    messageQueue.push(line);
    processQueue().catch((err) => {
      rl.resume();
      output.write(chalk.red(`Queue error: ${err?.message || err}\n`));
      rl.prompt();
    });
  });

  // Session close — double Ctrl+C to exit, single Ctrl+C shows hint
  let sessionClosing = false;
  let lastSigintTime = 0;
  const DOUBLE_PRESS_WINDOW_MS = 1500;

  const handleGracefulClose = () => {
    if (sessionClosing) return;
    sessionClosing = true;
    writeSessionCloseJournal();
    output.write('\n');
    process.exit(0);
  };

  let ctrlCHintTimer: ReturnType<typeof setTimeout> | null = null;

  process.on('SIGINT', () => {
    const now = Date.now();
    if (now - lastSigintTime < DOUBLE_PRESS_WINDOW_MS) {
      // Double press — exit
      if (ctrlCHintTimer) clearTimeout(ctrlCHintTimer);
      handleGracefulClose();
    } else {
      // Single press — show exit hint, auto-revert after 1.5s
      lastSigintTime = now;
      const exitHint = chalk.yellow('▸ Ctrl+C') + chalk.gray(' to exit');
      rl.setPrompt(`\n${exitHint} `);
      output.write('\n');
      rl.prompt();
      if (ctrlCHintTimer) clearTimeout(ctrlCHintTimer);
      ctrlCHintTimer = setTimeout(() => {
        rl.setPrompt(`\n${PROMPT_SYMBOL} `);
        ctrlCHintTimer = null;
      }, 1500);
    }
  });

  rl.on('close', handleGracefulClose);
  process.on('SIGTERM', handleGracefulClose);
  process.on('SIGHUP', handleGracefulClose);
}

runConsole().catch((error) => {
  rawConsoleError(`console chat failed: ${error?.message || error}`);
  process.exit(1);
});
