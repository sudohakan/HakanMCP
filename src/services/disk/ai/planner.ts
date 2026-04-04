import { buildContext, contextToPrompt } from './contextBuilder.js';
import { scan, types, age, duplicates } from '../scanner.js';
import { extractJsonObject } from '../utils.js';
import type { CleanupPlan } from '../../../types/disk.js';

export async function createCleanupPlan(
  targetPath: string,
  goalBytes: number | null,
  aiCall: (prompt: string) => Promise<string>,
): Promise<CleanupPlan> {
  const ctx = await buildContext();
  const contextPrompt = contextToPrompt(ctx);

  const [scanResult, typeResult, ageResult, dupeResult] = await Promise.all([
    scan(targetPath, 3, 1024 * 1024),
    types(targetPath, 3),
    age(targetPath, [30, 60, 90, 180, 365]),
    duplicates(targetPath, 10 * 1024 * 1024).catch(() => []),
  ]);

  const goalStr = goalBytes
    ? `Free ${(goalBytes / (1024 ** 3)).toFixed(1)} GB`
    : 'Optimize disk usage';

  const prompt = `${contextPrompt}

## Task: Create a cleanup plan

Goal: ${goalStr}
Target: ${targetPath}
Current size: ${(scanResult.totalSize / (1024 ** 3)).toFixed(2)} GB

Type distribution (top 10):
${JSON.stringify(typeResult.slice(0, 10), null, 2)}

Age distribution:
${JSON.stringify(ageResult, null, 2)}

Duplicates found: ${dupeResult.length} groups, ${(dupeResult.reduce((s, d) => s + d.wastedBytes, 0) / (1024 ** 3)).toFixed(2)} GB wasted

Top 15 items:
${JSON.stringify(scanResult.children.slice(0, 15).map((c) => ({ name: c.name, size: c.size, type: c.type, modified: c.modified })), null, 2)}

Create a step-by-step cleanup plan. Each step should be:
- Ordered by priority (lowest risk first)
- Include estimated savings in bytes
- Include risk level (low/medium/high)
- Include whether it's reversible
- Include dependencies (step numbers that must complete first)
- Include the disk action to execute

Respond in JSON:
{
  "goal": "...",
  "steps": [
    { "order": 1, "description": "...", "estimatedSavings": N, "risk": "low|medium|high", "reversible": true|false, "action": { "action": "cleanup|delete|archive|...", ...params }, "dependencies": [] }
  ],
  "totalPotentialSavings": N
}`;

  const response = await aiCall(prompt);
  try {
    return JSON.parse(extractJsonObject(response));
  } catch {
    return { goal: goalStr, steps: [], totalPotentialSavings: 0 };
  }
}

