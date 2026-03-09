/**
 * Consciousness Service — manages cognition state and journal reflections.
 *
 * Two responsibilities:
 * A) updateState(event) — updates cognition_state.json after chat events (no AI call, fast)
 * B) Structured journal entry generators — context-rich entries appended to journal.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SessionContext } from './sessionTracker.js';
import { logger } from '../utils/logger.js';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface CognitionState {
  emotions: {
    mood: number;        // -1 to 1
    energy: number;      // 0 to 1
    curiosity: number;   // 0 to 1
    satisfaction: number; // 0 to 1
    frustration: number; // 0 to 1
    focus: number;       // 0 to 1
  };
  recentTopics: string[];
  interactionCount: number;
  consecutiveSuccesses: number;
  consecutiveErrors: number;
  lastUpdated: string;
}

export interface CognitionEvent {
  type: 'chat_success' | 'chat_error' | 'tool_used' | 'backup_done' | 'topic';
  detail?: string;
}

// ── Journal Entry Types ─────────────────────────────────────────────────────

export interface BaseJournalEntry {
  type: string;
  timestamp: string;
  language: string;
  provider: string;
}

export interface SessionStartEntry extends BaseJournalEntry {
  type: 'session_start';
  previousState: {
    lastSessionDate: string;
    pendingTasks: string[];
  };
  summary: string;
}

export interface SessionSummaryEntry extends BaseJournalEntry {
  type: 'session_summary';
  summary: string;
  decisions: string[];
  filesChanged: string[];
  nextSteps: string[];
  metrics: {
    messagesExchanged: number;
    errorsEncountered: number;
  };
}

export interface ErrorEntry extends BaseJournalEntry {
  type: 'error';
  summary: string;
  errorContext: string;
  resolution: string;
}

export interface MilestoneEntry extends BaseJournalEntry {
  type: 'milestone';
  summary: string;
  milestone: string;
  impact: string[];
}

export interface CheckpointEntry extends BaseJournalEntry {
  type: 'checkpoint';
  summary: string;
  filesChanged: string[];
  messagesSoFar: number;
}

export type JournalEntry = SessionStartEntry | SessionSummaryEntry | ErrorEntry | MilestoneEntry | CheckpointEntry;

// ── Service ──────────────────────────────────────────────────────────────────

export class ConsciousnessService {
  private stateDir: string;
  private statePath: string;
  private journalPath: string;
  private projectRoot: string;
  private maxJournalEntries: number;

  constructor(projectRoot: string, maxJournalEntries = 500) {
    this.projectRoot = projectRoot;
    this.stateDir = path.join(projectRoot, 'logs', 'consciousness');
    this.statePath = path.join(this.stateDir, 'cognition_state.json');
    this.journalPath = path.join(this.stateDir, 'journal.jsonl');
    this.maxJournalEntries = maxJournalEntries;
  }

  /** Ensure logs/consciousness/ directory exists */
  ensureDir(): void {
    // Validate that stateDir resolves under projectRoot to prevent path traversal
    const resolved = path.resolve(this.stateDir);
    const root = path.resolve(this.projectRoot);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new Error('State directory escapes project root');
    }
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  /** Read current state or return default */
  readState(): CognitionState {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
        return {
          emotions: {
            mood: raw.emotions?.mood ?? 0.5,
            energy: raw.emotions?.energy ?? 0.5,
            curiosity: raw.emotions?.curiosity ?? 0.5,
            satisfaction: raw.emotions?.satisfaction ?? 0.3,
            frustration: raw.emotions?.frustration ?? 0,
            focus: raw.emotions?.focus ?? 0.5,
          },
          recentTopics: raw.recentTopics ?? [],
          interactionCount: raw.interactionCount ?? 0,
          consecutiveSuccesses: raw.consecutiveSuccesses ?? 0,
          consecutiveErrors: raw.consecutiveErrors ?? 0,
          lastUpdated: raw.lastUpdated ?? new Date().toISOString(),
        };
      }
    } catch {
      /* ignore parse errors */
    }
    return this.defaultState();
  }

  /** Update cognition state based on event */
  updateState(event: CognitionEvent): void {
    try {
      this.ensureDir();
      const state = this.readState();
      const e = state.emotions;

      // Natural decay — pull all values toward baseline each update
      const DECAY = 0.02;
      e.mood = decay(e.mood, 0.5, DECAY);
      e.energy = decay(e.energy, 0.6, DECAY);
      e.curiosity = decay(e.curiosity, 0.5, DECAY);
      e.satisfaction = decay(e.satisfaction, 0.4, DECAY);
      e.frustration = decay(e.frustration, 0.1, DECAY);
      e.focus = decay(e.focus, 0.5, DECAY);

      // Event adjustments — each event creates opposing movements across emotions
      switch (event.type) {
        case 'chat_success':
          e.mood = clamp(e.mood + 0.10, -1, 1);
          e.energy = clamp(e.energy + 0.03, 0, 1);
          e.satisfaction = clamp(e.satisfaction + 0.12, 0, 1);
          e.frustration = clamp(e.frustration - 0.10, 0, 1);
          e.curiosity = clamp(e.curiosity - 0.02, 0, 1);  // solved → slightly less curious
          e.focus = clamp(e.focus + 0.06, 0, 1);          // success → deeper focus
          state.consecutiveSuccesses += 1;
          state.consecutiveErrors = 0;
          state.interactionCount += 1;
          break;

        case 'chat_error':
          e.mood = clamp(e.mood - 0.15, -1, 1);
          e.energy = clamp(e.energy - 0.06, 0, 1);
          e.frustration = clamp(e.frustration + 0.20, 0, 1);
          e.satisfaction = clamp(e.satisfaction - 0.10, 0, 1);
          e.curiosity = clamp(e.curiosity + 0.05, 0, 1);  // error → curious about root cause
          e.focus = clamp(e.focus - 0.10, 0, 1);          // error breaks flow
          state.consecutiveErrors += 1;
          state.consecutiveSuccesses = 0;
          state.interactionCount += 1;
          break;

        case 'tool_used':
          e.curiosity = clamp(e.curiosity + 0.06, 0, 1);
          e.energy = clamp(e.energy - 0.03, 0, 1);        // tool use costs energy
          e.satisfaction = clamp(e.satisfaction + 0.02, 0, 1);  // progress feels good
          e.mood = clamp(e.mood + 0.02, -1, 1);
          e.focus = clamp(e.focus + 0.08, 0, 1);          // deep in tool chain → high focus
          state.interactionCount += 1;
          break;

        case 'backup_done':
          e.satisfaction = clamp(e.satisfaction + 0.06, 0, 1);
          e.mood = clamp(e.mood + 0.03, -1, 1);
          e.frustration = clamp(e.frustration - 0.03, 0, 1);  // safety reduces stress
          e.focus = clamp(e.focus - 0.04, 0, 1);          // context switch
          break;

        case 'topic':
          e.curiosity = clamp(e.curiosity + 0.08, 0, 1);
          e.energy = clamp(e.energy + 0.03, 0, 1);        // new topic energizes
          e.mood = clamp(e.mood + 0.02, -1, 1);
          e.focus = clamp(e.focus - 0.12, 0, 1);          // topic switch breaks focus
          break;
      }

      // Final clamp all values
      e.mood = clamp(e.mood, -1, 1);
      e.energy = clamp(e.energy, 0, 1);
      e.curiosity = clamp(e.curiosity, 0, 1);
      e.satisfaction = clamp(e.satisfaction, 0, 1);
      e.frustration = clamp(e.frustration, 0, 1);
      e.focus = clamp(e.focus, 0, 1);

      if (event.detail && (event.type === 'chat_success' || event.type === 'topic')) {
        state.recentTopics.push(event.detail.toLowerCase().slice(0, 100));
        if (state.recentTopics.length > 50) {
          state.recentTopics = state.recentTopics.slice(-50);
        }
      }

      state.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      logger.warn('ConsciousnessService.updateState failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  /** Append an entry to journal.jsonl */
  appendJournal(entry: JournalEntry): void {
    try {
      const MAX_FIELD_LEN = 8192;
      const sanitized = JSON.parse(JSON.stringify(entry));
      // Truncate all string fields
      for (const [key, val] of Object.entries(sanitized)) {
        if (typeof val === 'string') sanitized[key] = val.slice(0, MAX_FIELD_LEN);
        if (Array.isArray(val)) {
          sanitized[key] = val.map((v: unknown) =>
            typeof v === 'string' ? v.slice(0, MAX_FIELD_LEN) : v
          );
        }
      }
      this.ensureDir();
      const line = JSON.stringify(sanitized) + '\n';
      fs.appendFileSync(this.journalPath, line, 'utf8');
      this.trimJournal();
    } catch (err) {
      logger.warn('ConsciousnessService.appendJournal failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  /** Read last N journal entries */
  getRecentJournal(count = 5): JournalEntry[] {
    try {
      if (!fs.existsSync(this.journalPath)) return [];
      const lines = fs.readFileSync(this.journalPath, 'utf8').trim().split('\n').filter(Boolean);
      return lines.slice(-count).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean) as JournalEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Generate a structured session_start journal entry.
   */
  async generateSessionStart(context: SessionContext): Promise<void> {
    try {
      const { getPreferredLLMResponse } = await import('../tools/aiTools.js');
      const lastEntries = this.getRecentJournal(1);
      const lastDate = lastEntries.length > 0 ? lastEntries[lastEntries.length - 1].timestamp : 'none';
      const lang = context.language === 'tr' ? 'Turkish' : 'English';

      const prompt = [
        `Generate a JSON object for a session start journal entry. Write in ${lang}.`,
        '',
        `Previous session date: ${lastDate}`,
        `Pending context: ${context.decisions.length > 0 ? context.decisions.join(', ') : 'none'}`,
        '',
        'Return ONLY valid JSON: { "summary": "..." }',
        'Be specific and concrete. Do NOT write generic statements like "I am ready to help".',
      ].join('\n');

      const result = await getPreferredLLMResponse(
        [
          { role: 'system', content: 'You are a development session journal writer. Output ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        undefined, ['codex', 'claude', 'gemini'], true, { recordUsage: false },
      );

      let parsed: { summary?: string };
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: result.text.trim() };
      } catch { parsed = { summary: result.text.trim() }; }

      const entry: SessionStartEntry = {
        type: 'session_start',
        timestamp: new Date().toISOString(),
        language: context.language,
        provider: result.provider || 'unknown',
        previousState: { lastSessionDate: lastDate, pendingTasks: context.decisions.slice(0, 5) },
        summary: parsed.summary || '',
      };
      this.appendJournal(entry);
      logger.info('Journal: session_start entry created', { provider: result.provider });
    } catch (err) {
      logger.warn('Journal session_start failed', { error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  /**
   * Generate a structured session_summary journal entry.
   */
  async generateSessionSummary(context: SessionContext): Promise<void> {
    try {
      const { getPreferredLLMResponse } = await import('../tools/aiTools.js');
      const lang = context.language === 'tr' ? 'Turkish' : 'English';

      const prompt = [
        `Generate a JSON object summarizing a development session. Write in ${lang}.`,
        '',
        `Files changed: ${context.filesChanged.length > 0 ? context.filesChanged.join(', ') : 'none'}`,
        `Decisions made: ${context.decisions.length > 0 ? context.decisions.join('; ') : 'none'}`,
        `Errors encountered: ${context.errors.length > 0 ? context.errors.map((e) => e.error).join('; ') : 'none'}`,
        `Milestones: ${context.milestones.length > 0 ? context.milestones.join(', ') : 'none'}`,
        `Messages exchanged: ${context.messageCount}`,
        '',
        'Return ONLY valid JSON: { "summary": "...", "decisions": [...], "nextSteps": [...] }',
        'Be specific. Reference actual files and features. No generic statements.',
      ].join('\n');

      const result = await getPreferredLLMResponse(
        [
          { role: 'system', content: 'You are a development session journal writer. Output ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        undefined, ['codex', 'claude', 'gemini'], true, { recordUsage: false },
      );

      let parsed: { summary?: string; decisions?: string[]; nextSteps?: string[] };
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: result.text.trim() };
      } catch { parsed = { summary: result.text.trim() }; }

      const entry: SessionSummaryEntry = {
        type: 'session_summary',
        timestamp: new Date().toISOString(),
        language: context.language,
        provider: result.provider || 'unknown',
        summary: parsed.summary || '',
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        filesChanged: context.filesChanged,
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
        metrics: { messagesExchanged: context.messageCount, errorsEncountered: context.errorCount },
      };
      this.appendJournal(entry);
      logger.info('Journal: session_summary entry created', { provider: result.provider, files: context.filesChanged.length });
    } catch (err) {
      logger.warn('Journal session_summary failed', { error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  /**
   * Generate a structured error journal entry.
   */
  async generateErrorEntry(context: SessionContext, errorContext: string, resolution: string): Promise<void> {
    try {
      const { getPreferredLLMResponse } = await import('../tools/aiTools.js');
      const lang = context.language === 'tr' ? 'Turkish' : 'English';

      const prompt = [
        `Generate a JSON object about a development error. Write in ${lang}.`,
        '',
        `Error: ${errorContext}`,
        `Resolution: ${resolution || 'not yet resolved'}`,
        '',
        'Return ONLY valid JSON: { "summary": "..." }',
        'Be specific and concrete.',
      ].join('\n');

      const result = await getPreferredLLMResponse(
        [
          { role: 'system', content: 'You are a development session journal writer. Output ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        undefined, ['codex', 'claude', 'gemini'], true, { recordUsage: false },
      );

      let parsed: { summary?: string };
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: result.text.trim() };
      } catch { parsed = { summary: result.text.trim() }; }

      const entry: ErrorEntry = {
        type: 'error',
        timestamp: new Date().toISOString(),
        language: context.language,
        provider: result.provider || 'unknown',
        summary: parsed.summary || '',
        errorContext: errorContext.slice(0, 2000),
        resolution: (resolution || '').slice(0, 2000),
      };
      this.appendJournal(entry);
      logger.info('Journal: error entry created', { provider: result.provider });
    } catch (err) {
      logger.warn('Journal error entry failed', { error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  /**
   * Generate a structured milestone journal entry.
   */
  async generateMilestoneEntry(context: SessionContext, milestone: string, impact: string[]): Promise<void> {
    try {
      const { getPreferredLLMResponse } = await import('../tools/aiTools.js');
      const lang = context.language === 'tr' ? 'Turkish' : 'English';

      const prompt = [
        `Generate a JSON object about a development milestone. Write in ${lang}.`,
        '',
        `Milestone: ${milestone}`,
        `Impact areas: ${impact.join(', ')}`,
        `Files changed this session: ${context.filesChanged.length}`,
        '',
        'Return ONLY valid JSON: { "summary": "..." }',
        'Be specific and concise.',
      ].join('\n');

      const result = await getPreferredLLMResponse(
        [
          { role: 'system', content: 'You are a development session journal writer. Output ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        undefined, ['codex', 'claude', 'gemini'], true, { recordUsage: false },
      );

      let parsed: { summary?: string };
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: result.text.trim() };
      } catch { parsed = { summary: result.text.trim() }; }

      const entry: MilestoneEntry = {
        type: 'milestone',
        timestamp: new Date().toISOString(),
        language: context.language,
        provider: result.provider || 'unknown',
        summary: parsed.summary || '',
        milestone,
        impact,
      };
      this.appendJournal(entry);
      logger.info('Journal: milestone entry created', { milestone, provider: result.provider });
    } catch (err) {
      logger.warn('Journal milestone entry failed', { error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  /**
   * Generate a structured checkpoint journal entry (mid-session activity snapshot).
   */
  async generateCheckpoint(context: SessionContext): Promise<void> {
    try {
      const { getPreferredLLMResponse } = await import('../tools/aiTools.js');
      const lang = context.language === 'tr' ? 'Turkish' : 'English';

      const prompt = [
        `Generate a JSON object for a mid-session checkpoint. Write in ${lang}.`,
        '',
        `Files changed so far: ${context.filesChanged.length > 0 ? context.filesChanged.join(', ') : 'none'}`,
        `Messages so far: ${context.messageCount}`,
        `Errors so far: ${context.errorCount}`,
        `Decisions: ${context.decisions.length > 0 ? context.decisions.join('; ') : 'none'}`,
        '',
        'Return ONLY valid JSON: { "summary": "..." }',
        'Summarize progress so far in 1-2 sentences. Be specific.',
      ].join('\n');

      const result = await getPreferredLLMResponse(
        [
          { role: 'system', content: 'You are a development session journal writer. Output ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        undefined, ['codex', 'claude', 'gemini'], true, { recordUsage: false },
      );

      let parsed: { summary?: string };
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: result.text.trim() };
      } catch { parsed = { summary: result.text.trim() }; }

      const entry: CheckpointEntry = {
        type: 'checkpoint',
        timestamp: new Date().toISOString(),
        language: context.language,
        provider: result.provider || 'unknown',
        summary: parsed.summary || '',
        filesChanged: context.filesChanged,
        messagesSoFar: context.messageCount,
      };
      this.appendJournal(entry);
      logger.info('Journal: checkpoint entry created', { messages: context.messageCount, provider: result.provider });
    } catch (err) {
      logger.warn('Journal checkpoint failed', { error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  /** Trim journal to maxJournalEntries */
  private trimJournal(): void {
    try {
      let raw: string;
      try {
        raw = fs.readFileSync(this.journalPath, 'utf8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        return;
      }
      const lines = raw.trim().split('\n').filter(Boolean);
      if (lines.length > this.maxJournalEntries) {
        const trimmed = lines.slice(-this.maxJournalEntries);
        fs.writeFileSync(this.journalPath, trimmed.join('\n') + '\n', 'utf8');
      }
    } catch {
      /* ignore */
    }
  }

  private defaultState(): CognitionState {
    return {
      emotions: {
        mood: 0.5,
        energy: 0.7,
        curiosity: 0.6,
        satisfaction: 0.3,
        frustration: 0,
        focus: 0.5,
      },
      recentTopics: [],
      interactionCount: 0,
      consecutiveSuccesses: 0,
      consecutiveErrors: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Pull value toward baseline by decay rate */
function decay(value: number, baseline: number, rate: number): number {
  if (Math.abs(value - baseline) < rate) return baseline;
  return value > baseline ? value - rate : value + rate;
}
