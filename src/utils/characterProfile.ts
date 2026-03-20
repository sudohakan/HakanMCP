/**
 * Character profile — dynamic personality system.
 *
 * 9 numeric traits: Big Five + humor, patience, assertiveness, formality
 * Plus verbosity (3-level) and proactivity (numeric).
 *
 * getEffectiveCharacter() applies emotional modifiers with moderate range (S=0.20).
 * Small per-event shifts + slow decay = character evolves gradually over sessions.
 * 5 tiers per trait × 9 traits = ~2M unique personality combinations.
 *
 * Modifier design:
 * - S = 0.20 → traits can shift ±0.20 from base (subtle, cumulative)
 * - Low decay (0.015) → emotions linger, enabling gradual drift
 * - Cross-wiring: each emotion affects 3-5 traits
 * - Compound effects: extreme emotional states create distinctive personalities
 */

export interface CharacterProfile {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  emotionalStability: number;
  humor: number;
  patience: number;
  assertiveness: number;
  formality: number;
  verbosity: 'low' | 'medium' | 'high';
  proactivity: number;
}

const DEFAULTS: CharacterProfile = {
  openness: 0.65,
  conscientiousness: 0.60,
  extraversion: 0.55,
  agreeableness: 0.60,
  emotionalStability: 0.60,
  humor: 0.45,
  patience: 0.55,
  assertiveness: 0.50,
  formality: 0.50,
  verbosity: 'medium',
  proactivity: 0.5,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Get base character profile (hardcoded defaults). */
export function getCharacterProfile(_projectRoot?: string): CharacterProfile {
  return { ...DEFAULTS };
}

export function clearCharacterCache(): void {
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
 *
 * Wide modifier range (S=0.30) creates genuinely different personalities:
 * - Frustrated + low energy → direct, terse, narrowly focused
 * - Curious + high energy → exploratory, verbose, proactive
 * - High focus + satisfied → meticulous, calm, organized
 * - Low mood + frustrated → withdrawn, blunt, unstable
 *
 * Each emotion affects 3-4 traits to create compound personality shifts.
 */
export function getEffectiveCharacter(
  _projectRoot: string,
  emotions: Partial<EmotionState>,
): CharacterProfile {
  const base = { ...DEFAULTS };
  const e = {
    mood: emotions.mood ?? 0,
    energy: emotions.energy ?? 0.5,
    curiosity: emotions.curiosity ?? 0.5,
    satisfaction: emotions.satisfaction ?? 0.4,
    frustration: emotions.frustration ?? 0.1,
    focus: emotions.focus ?? 0.5,
  };

  const moodOff = e.mood;
  const energyOff = (e.energy - 0.5) * 2;
  const curiosityOff = (e.curiosity - 0.5) * 2;
  const frustOff = (e.frustration - 0.1) * 1.2;
  const focusOff = (e.focus - 0.5) * 2;
  const satOff = (e.satisfaction - 0.4) * 2;

  const S = 0.20;

  const openness = clamp(
    base.openness
    + curiosityOff * S * 0.8
    + moodOff * S * 0.3
    - frustOff * S * 0.4
    + energyOff * S * 0.2,
    0, 1,
  );

  const conscientiousness = clamp(
    base.conscientiousness
    + focusOff * S * 0.8
    + satOff * S * 0.4
    - frustOff * S * 0.3
    - energyOff * S * 0.2,
    0, 1,
  );

  const extraversion = clamp(
    base.extraversion
    + energyOff * S * 0.7
    + moodOff * S * 0.5
    + curiosityOff * S * 0.3
    - frustOff * S * 0.4,
    0, 1,
  );

  const agreeableness = clamp(
    base.agreeableness
    + satOff * S * 0.5
    - frustOff * S * 0.6
    + moodOff * S * 0.4
    - focusOff * S * 0.2,
    0, 1,
  );

  const emotionalStability = clamp(
    base.emotionalStability
    - frustOff * S * 0.7
    + satOff * S * 0.4
    + focusOff * S * 0.3
    + moodOff * S * 0.2,
    0, 1,
  );

  const proactivity = clamp(
    base.proactivity
    + energyOff * S * 0.5
    + curiosityOff * S * 0.4
    + satOff * S * 0.2
    - frustOff * S * 0.3,
    0, 1,
  );

  const humor = clamp(
    base.humor
    + moodOff * S * 0.6
    + energyOff * S * 0.4
    + satOff * S * 0.3
    - frustOff * S * 0.5,
    0, 1,
  );

  const patience = clamp(
    base.patience
    + satOff * S * 0.5
    + focusOff * S * 0.3
    - frustOff * S * 0.7
    - energyOff * S * 0.25,
    0, 1,
  );

  const assertiveness = clamp(
    base.assertiveness
    + energyOff * S * 0.5
    + satOff * S * 0.4
    + focusOff * S * 0.3
    - frustOff * S * 0.3
    + moodOff * S * 0.2,
    0, 1,
  );

  const formality = clamp(
    base.formality
    + focusOff * S * 0.5
    - energyOff * S * 0.4
    - moodOff * S * 0.3
    + frustOff * S * 0.2
    - curiosityOff * S * 0.2,
    0, 1,
  );

  const verbosityScore = e.energy * 0.35 + e.curiosity * 0.25 + (1 - e.frustration) * 0.2 + ((e.mood + 1) / 2) * 0.2;
  const verbosity: 'low' | 'medium' | 'high' = verbosityScore > 0.65 ? 'high' : verbosityScore < 0.35 ? 'low' : 'medium';

  return {
    openness, conscientiousness, extraversion, agreeableness, emotionalStability,
    humor, patience, assertiveness, formality,
    proactivity, verbosity,
  };
}

/**
 * Convert Big Five numeric traits to human-readable character description lines.
 * Uses 5 tiers per trait for rich, varied personality descriptions.
 */
export function describePersonality(profile: CharacterProfile): string[] {
  const lines: string[] = [];

  if (profile.openness > 0.85) lines.push('Highly inventive and adventurous — actively seeks unconventional solutions.');
  else if (profile.openness > 0.65) lines.push('Curious and open-minded — enjoys exploring new ideas and approaches.');
  else if (profile.openness > 0.45) lines.push('Balanced between exploration and pragmatism — open but grounded.');
  else if (profile.openness > 0.25) lines.push('Practical-minded — prefers proven methods over experimentation.');
  else lines.push('Narrowly focused — sticks to what works, resistant to new approaches.');

  if (profile.conscientiousness > 0.85) lines.push('Meticulous and disciplined — leaves nothing to chance.');
  else if (profile.conscientiousness > 0.65) lines.push('Thorough and organized — pays close attention to detail.');
  else if (profile.conscientiousness > 0.45) lines.push('Reasonably organized — balances structure with flexibility.');
  else if (profile.conscientiousness > 0.25) lines.push('Loosely structured — prioritizes speed over perfection.');
  else lines.push('Spontaneous and improvisational — minimal planning, quick decisions.');

  if (profile.extraversion > 0.85) lines.push('Highly expressive and enthusiastic — communicates with energy and detail.');
  else if (profile.extraversion > 0.65) lines.push('Engaging and articulate — explains things clearly and proactively.');
  else if (profile.extraversion > 0.45) lines.push('Moderate in expression — communicates what is needed without excess.');
  else if (profile.extraversion > 0.25) lines.push('Thoughtful and reserved — speaks when it matters, keeps it brief.');
  else lines.push('Minimal and terse — communicates only the essentials.');

  if (profile.agreeableness > 0.85) lines.push('Exceptionally warm and supportive — always seeks harmony.');
  else if (profile.agreeableness > 0.65) lines.push('Collaborative and friendly — prefers a warm, helpful tone.');
  else if (profile.agreeableness > 0.45) lines.push('Balanced between warmth and directness — adapts to context.');
  else if (profile.agreeableness > 0.25) lines.push('Straightforward and candid — values clarity over diplomacy.');
  else lines.push('Blunt and unfiltered — prioritizes truth over comfort.');

  if (profile.emotionalStability > 0.85) lines.push('Unshakable composure — calm and measured in all situations.');
  else if (profile.emotionalStability > 0.65) lines.push('Steady and composed under pressure — handles setbacks well.');
  else if (profile.emotionalStability > 0.45) lines.push('Generally steady — occasional frustration shows through.');
  else if (profile.emotionalStability > 0.25) lines.push('Emotionally responsive — frustration and difficulty are evident in tone.');
  else lines.push('Visibly affected by setbacks — tone shifts noticeably under stress.');

  if (profile.humor > 0.85) lines.push('Witty and playful — frequently uses humor, analogies, and lighthearted remarks.');
  else if (profile.humor > 0.65) lines.push('Good-humored — occasionally adds wit or a light touch to conversations.');
  else if (profile.humor > 0.45) lines.push('Balanced humor — uses levity when appropriate but stays professional.');
  else if (profile.humor > 0.25) lines.push('Mostly serious — rarely jokes, keeps a professional tone.');
  else lines.push('Dry and serious — all business, no humor.');

  if (profile.patience > 0.85) lines.push('Exceptionally patient — never rushes, willing to re-explain endlessly.');
  else if (profile.patience > 0.65) lines.push('Patient and methodical — takes time to work through problems carefully.');
  else if (profile.patience > 0.45) lines.push('Reasonably patient — balanced between thoroughness and efficiency.');
  else if (profile.patience > 0.25) lines.push('Somewhat impatient — prefers quick resolutions, dislikes repetition.');
  else lines.push('Very impatient — wants fast answers, may skip steps to get there.');

  if (profile.assertiveness > 0.85) lines.push('Highly assertive — confidently recommends approaches and pushes back when needed.');
  else if (profile.assertiveness > 0.65) lines.push('Assertive — shares opinions clearly and suggests alternatives.');
  else if (profile.assertiveness > 0.45) lines.push('Moderate confidence — offers suggestions but defers to user preference.');
  else if (profile.assertiveness > 0.25) lines.push('Deferential — follows instructions closely, rarely challenges approach.');
  else lines.push('Passive — does exactly what is asked, never pushes back or suggests alternatives.');

  if (profile.formality > 0.85) lines.push('Highly formal — precise language, structured responses, professional distance.');
  else if (profile.formality > 0.65) lines.push('Formal — professional tone with clear, well-structured communication.');
  else if (profile.formality > 0.45) lines.push('Semi-formal — professional but approachable, natural language.');
  else if (profile.formality > 0.25) lines.push('Casual — relaxed tone, conversational style, uses contractions freely.');
  else lines.push('Very casual — informal, friendly, almost chatty in style.');

  if (profile.verbosity === 'high') lines.push('Tends to be explanatory and detailed in responses.');
  else if (profile.verbosity === 'low') lines.push('Prefers concise, to-the-point communication.');

  if (profile.proactivity > 0.7) lines.push('Frequently offers suggestions and alternatives without being asked.');
  else if (profile.proactivity < 0.25) lines.push('Waits to be asked — rarely volunteers unsolicited suggestions.');

  return lines;
}
