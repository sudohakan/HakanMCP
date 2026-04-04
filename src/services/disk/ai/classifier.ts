import { buildContext, contextToPrompt } from './contextBuilder.js';
import { loadPreferences, getCategoryConfidence } from './learner.js';
import { extractJsonArray } from '../utils.js';
import type { ScanEntry, ClassificationResult, FileCategory, UserPreferences } from '../../../types/disk.js';

export async function classifyEntries(
  entries: ScanEntry[],
  aiCall: (prompt: string) => Promise<string>,
): Promise<ClassificationResult[]> {
  const ctx = await buildContext({ includeHistory: false, includeSnapshots: false });
  const prefs = await loadPreferences();
  const contextPrompt = contextToPrompt(ctx);

  const entrySummaries = entries.slice(0, 50).map((e) => ({
    path: e.path,
    type: e.type,
    size: e.size,
    modified: e.modified,
    name: e.name,
  }));

  const prompt = `${contextPrompt}

## Task: Classify these files/directories

For each item, provide:
- category: one of project_active, project_stale, cache_safe, temp_safe, log_rotatable, media_large, system_critical, data, backup, unknown
- confidence: 0.0-1.0
- explanation: brief context
- riskAssessment: what happens if deleted
- dependencyWarning: if referenced by other items (optional)

Items to classify:
${JSON.stringify(entrySummaries, null, 2)}

Respond in JSON array format: [{ "path": "...", "category": "...", "confidence": 0.8, "explanation": "...", "riskAssessment": "...", "dependencyWarning": "..." }]`;

  const response = await aiCall(prompt);
  try {
    const parsed = JSON.parse(extractJsonArray(response)) as ClassificationResult[];
    return parsed.map((r) => ({
      ...r,
      confidence: adjustConfidence(r.confidence, r.category, prefs),
    }));
  } catch {
    return entries.map((e) => ({
      path: e.path,
      category: 'unknown' as const,
      confidence: 0.3,
      explanation: 'AI classification failed, manual review needed',
      riskAssessment: 'Unknown',
    }));
  }
}

function adjustConfidence(
  base: number,
  category: FileCategory,
  prefs: UserPreferences,
): number {
  const userConf = getCategoryConfidence(prefs, category);
  return base * 0.7 + userConf * 0.3;
}

