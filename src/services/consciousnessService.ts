/**
 * Consciousness Service — manages cognition state and journal reflections.
 *
 * Two responsibilities:
 * A) updateState(event) — updates cognition_state.json after chat events (no AI call, fast)
 * B) generateReflection() — AI-powered periodic reflection → appends to journal.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { getCharacterProfile, describePersonality } from '../utils/characterProfile.js';
import { logger } from '../utils/logger.js';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface CognitionState {
  emotions: {
    mood: number;        // -1 to 1
    energy: number;      // 0 to 1
    curiosity: number;   // 0 to 1
    satisfaction: number; // 0 to 1
    frustration: number; // 0 to 1
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

export interface JournalEntry {
  thought: string;
  type: 'reflection' | 'observation' | 'insight';
  timestamp: string;
  provider?: string;
}

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
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
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
      const DECAY = 0.04;
      e.mood = decay(e.mood, 0.5, DECAY);
      e.energy = decay(e.energy, 0.6, DECAY);
      e.curiosity = decay(e.curiosity, 0.5, DECAY);
      e.satisfaction = decay(e.satisfaction, 0.4, DECAY);
      e.frustration = decay(e.frustration, 0.1, DECAY);

      // Event adjustments — scaled by distance from limit (diminishing returns)
      switch (event.type) {
        case 'chat_success':
          e.mood = clamp(e.mood + 0.05 * (1 - e.mood), -1, 1);
          e.energy = clamp(e.energy + 0.02 * (1 - e.energy), 0, 1);
          e.satisfaction = clamp(e.satisfaction + 0.06 * (1 - e.satisfaction), 0, 1);
          e.frustration = clamp(e.frustration - 0.05 * e.frustration, 0, 1);
          e.curiosity = clamp(e.curiosity + 0.01 * (1 - e.curiosity), 0, 1);
          state.consecutiveSuccesses += 1;
          state.consecutiveErrors = 0;
          state.interactionCount += 1;
          break;

        case 'chat_error':
          e.mood = clamp(e.mood - 0.08 * (1 + e.mood), -1, 1);
          e.energy = clamp(e.energy - 0.03 * e.energy, 0, 1);
          e.frustration = clamp(e.frustration + 0.12 * (1 - e.frustration), 0, 1);
          e.satisfaction = clamp(e.satisfaction - 0.04 * e.satisfaction, 0, 1);
          state.consecutiveErrors += 1;
          state.consecutiveSuccesses = 0;
          state.interactionCount += 1;
          break;

        case 'tool_used':
          e.curiosity = clamp(e.curiosity + 0.04, 0, 1);
          e.energy = clamp(e.energy - 0.01, 0, 1);
          state.interactionCount += 1;
          break;

        case 'backup_done':
          e.satisfaction = clamp(e.satisfaction + 0.02, 0, 1);
          break;

        case 'topic':
          // topic event only adds to recentTopics
          break;
      }

      // Final clamp all values
      e.mood = clamp(e.mood, -1, 1);
      e.energy = clamp(e.energy, 0, 1);
      e.curiosity = clamp(e.curiosity, 0, 1);
      e.satisfaction = clamp(e.satisfaction, 0, 1);
      e.frustration = clamp(e.frustration, 0, 1);

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
      this.ensureDir();
      const line = JSON.stringify(entry) + '\n';
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

  /** Read reflection config from config.yaml, with defaults */
  private getReflectionConfig(): { maxLength: number; maxEntriesInPrompt: number; style: string } {
    const defaults = { maxLength: 1000, maxEntriesInPrompt: 3, style: 'auto' };
    try {
      const configPath = path.join(this.projectRoot, 'config.yaml');
      if (!fs.existsSync(configPath)) return defaults;
      const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
      const ref = raw?.consciousness?.reflection;
      if (!ref) return defaults;
      return {
        maxLength: typeof ref.maxLength === 'number' ? ref.maxLength : 1000,
        maxEntriesInPrompt: typeof ref.maxEntriesInPrompt === 'number' ? ref.maxEntriesInPrompt : 3,
        style: ['auto', 'emotional', 'mixed', 'minimal'].includes(ref.style) ? ref.style : 'auto',
      };
    } catch { return defaults; }
  }

  /**
   * Generate AI reflection and append to journal.
   * @param context Optional situational context that shapes the reflection:
   *   - 'periodic' (default) — general reflection on recent activity
   *   - 'error' — reflection after encountering an error
   *   - 'topic_shift:<topic>' — reflection on a new topic emerging
   *   - 'session_end' — summary reflection when session closes
   */
  async generateReflection(context: string = 'periodic'): Promise<string | null> {
    try {
      const { getPreferredLLMResponse } = await import('../tools/aiTools.js');

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
          style = ['emotional', 'mixed', 'minimal'][Math.floor(Math.random() * 3)];
        }
      }

      const styleInstructions: Record<string, string> = {
        emotional: 'Write a personal, feeling-focused reflection (1-3 sentences). Express how you feel about recent interactions — energy, mood, what excited or drained you.',
        mixed: 'Write a brief reflection (1-2 sentences) blending a feeling with a topic mention. Example: "We worked on interesting topics, I feel curious."',
        minimal: 'Write a very short mood statement (1 sentence, under 60 chars). Example: "I am calm and focused."',
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

      // Enforce max length — cut at last sentence boundary to avoid mid-word truncation
      if (thought.length > reflConfig.maxLength) {
        const truncated = thought.substring(0, reflConfig.maxLength);
        const lastSentenceEnd = truncated.search(/[.!?…]\s*(?=[^.!?…]*$)/);
        thought = lastSentenceEnd > reflConfig.maxLength * 0.3
          ? truncated.substring(0, lastSentenceEnd + 1).trim()
          : truncated.replace(/\s+\S*$/, '').trim() + '…';
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

  /** Trim journal to maxJournalEntries */
  private trimJournal(): void {
    try {
      if (!fs.existsSync(this.journalPath)) return;
      const lines = fs.readFileSync(this.journalPath, 'utf8').trim().split('\n').filter(Boolean);
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
