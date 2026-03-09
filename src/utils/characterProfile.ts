/**
 * Character profile for CLI chat (plan §15d).
 *
 * Base traits loaded from (in priority order):
 *   1. ~/.hakanmcp/character.yaml (user override)
 *   2. <projectRoot>/character.yaml (project-level)
 *   3. config.yaml → consciousness.character
 *   4. Hardcoded DEFAULTS
 *
 * Dynamic traits: getEffectiveCharacter() applies emotional modifiers to base traits.
 * High frustration → agreeableness drops, high curiosity → openness rises, etc.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

export interface CharacterProfile {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  emotionalStability: number;
  verbosity: 'low' | 'medium' | 'high';
  proactivity: number; // 0–1: how often to offer suggestions
}

const DEFAULTS: CharacterProfile = {
  openness: 0.8,
  conscientiousness: 0.7,
  extraversion: 0.6,
  agreeableness: 0.75,
  emotionalStability: 0.7,
  verbosity: 'medium',
  proactivity: 0.5,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function parseCharacter(obj: unknown): CharacterProfile {
  if (!obj || typeof obj !== 'object') return { ...DEFAULTS };
  const o = obj as Record<string, unknown>;
  const num = (key: string, def: number) => {
    const v = Number(o[key]);
    return clamp(Number.isFinite(v) ? v : def, 0, 1);
  };
  const verbosityRaw = String(o.verbosity ?? 'medium').toLowerCase();
  const verbosity = verbosityRaw === 'low' || verbosityRaw === 'high' ? verbosityRaw : 'medium';
  return {
    openness: num('openness', DEFAULTS.openness),
    conscientiousness: num('conscientiousness', DEFAULTS.conscientiousness),
    extraversion: num('extraversion', DEFAULTS.extraversion),
    agreeableness: num('agreeableness', DEFAULTS.agreeableness),
    emotionalStability: num('emotionalStability', DEFAULTS.emotionalStability),
    verbosity,
    proactivity: num('proactivity', DEFAULTS.proactivity),
  };
}

/** Load from ~/.hakanmcp/character.yaml if exists */
function loadUserCharacter(): CharacterProfile | null {
  try {
    const p = path.join(os.homedir(), '.hakanmcp', 'character.yaml');
    if (!fs.existsSync(p)) return null;
    const raw = yaml.load(fs.readFileSync(p, 'utf8'));
    return parseCharacter(raw);
  } catch {
    return null;
  }
}

/** Load from <projectRoot>/character.yaml if exists */
function loadProjectCharacter(projectRoot: string): CharacterProfile | null {
  try {
    const p = path.join(projectRoot, 'character.yaml');
    if (!fs.existsSync(p)) return null;
    const raw = yaml.load(fs.readFileSync(p, 'utf8'));
    return parseCharacter(raw);
  } catch {
    return null;
  }
}

/** Load from config.yaml consciousness.character (at project root) */
function loadConfigCharacter(projectRoot: string): CharacterProfile | null {
  try {
    const p = path.join(projectRoot, 'config.yaml');
    if (!fs.existsSync(p)) return null;
    const raw = yaml.load(fs.readFileSync(p, 'utf8')) as {
      consciousness?: { character?: unknown };
    };
    const char = raw?.consciousness?.character;
    if (!char) return null;
    return parseCharacter(char);
  } catch {
    return null;
  }
}

let cachedProfile: CharacterProfile | undefined;
let cacheKey = '';

/** Get merged character profile. User file overrides config, config overrides defaults. */
export function getCharacterProfile(projectRoot?: string): CharacterProfile {
  const key = projectRoot ?? '';
  if (cachedProfile && cacheKey === key) return cachedProfile;

  const fromConfig = projectRoot ? loadConfigCharacter(projectRoot) : null;
  const fromProject = projectRoot ? loadProjectCharacter(projectRoot) : null;
  const user = loadUserCharacter();

  const result = { ...DEFAULTS };
  if (fromConfig) Object.assign(result, fromConfig);
  if (fromProject) Object.assign(result, fromProject);  // project character.yaml > config.yaml
  if (user) Object.assign(result, user);                 // ~/.hakanmcp/character.yaml > all

  cachedProfile = result;
  cacheKey = key;
  return result;
}

export function clearCharacterCache(): void {
  cachedProfile = undefined;
}

/** Emotional state shape — matches CognitionState.emotions */
interface EmotionState {
  mood: number;
  energy: number;
  curiosity: number;
  satisfaction: number;
  frustration: number;
  focus: number;
}

/**
 * Get effective character by applying emotional modifiers to base traits.
 * Base traits come from character.yaml; emotions shift them dynamically.
 *
 * Modifier philosophy:
 * - Each emotion affects 2-3 traits in intuitive directions
 * - Modifiers are ±0.15 max so base personality still dominates
 * - Opposing emotions create natural tension (frustration vs satisfaction)
 */
export function getEffectiveCharacter(
  projectRoot: string,
  emotions: Partial<EmotionState>,
): CharacterProfile {
  const base = getCharacterProfile(projectRoot);
  const e = {
    mood: emotions.mood ?? 0,
    energy: emotions.energy ?? 0.5,
    curiosity: emotions.curiosity ?? 0.5,
    satisfaction: emotions.satisfaction ?? 0.4,
    frustration: emotions.frustration ?? 0.1,
    focus: emotions.focus ?? 0.5,
  };

  // Emotional offsets from neutral baselines (centered around typical resting values)
  const moodOffset = e.mood;                       // -1 to 1, already centered
  const energyOffset = (e.energy - 0.6) * 2;      // → -1.2 to 0.8
  const curiosityOffset = (e.curiosity - 0.5) * 2; // → -1 to 1
  const frustOffset = (e.frustration - 0.1) * 1.5; // → -0.15 to 1.35
  const focusOffset = (e.focus - 0.5) * 2;         // → -1 to 1
  const satOffset = (e.satisfaction - 0.4) * 2;     // → -0.8 to 1.2

  // Scale factor — keeps modifiers in ±0.15 range
  const S = 0.15;

  return {
    openness: clamp(base.openness + curiosityOffset * S - frustOffset * S * 0.5, 0, 1),
    conscientiousness: clamp(base.conscientiousness + focusOffset * S + satOffset * S * 0.3, 0, 1),
    extraversion: clamp(base.extraversion + energyOffset * S + moodOffset * S * 0.5, 0, 1),
    agreeableness: clamp(base.agreeableness + satOffset * S * 0.5 - frustOffset * S, 0, 1),
    emotionalStability: clamp(base.emotionalStability - frustOffset * S + satOffset * S * 0.3, 0, 1),
    proactivity: clamp(base.proactivity + energyOffset * S * 0.5 + curiosityOffset * S * 0.5, 0, 1),
    // Verbosity shifts with energy: low energy → low verbosity, high energy → high
    verbosity: e.energy > 0.75 ? 'high' : e.energy < 0.3 ? 'low' : base.verbosity,
  };
}

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
