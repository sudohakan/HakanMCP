import { buildContext, contextToPrompt } from './contextBuilder.js';
import type { ScanResult, AnomalyResult } from '../../../types/disk.js';

export async function detectAnomalies(
  scanResult: ScanResult,
  aiCall: (prompt: string) => Promise<string>,
): Promise<AnomalyResult[]> {
  const ctx = await buildContext({ includeUser: false });
  const contextPrompt = contextToPrompt(ctx);

  const topEntries = scanResult.children
    .sort((a, b) => b.size - a.size)
    .slice(0, 30)
    .map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size, modified: e.modified }));

  const prompt = `${contextPrompt}

## Task: Detect anomalies in this disk scan

Scan path: ${scanResult.path}
Total size: ${scanResult.totalSize} bytes
Files: ${scanResult.fileCount}, Dirs: ${scanResult.dirCount}

Top entries:
${JSON.stringify(topEntries, null, 2)}

Look for:
- sudden_growth: unusually large or recently created items
- unexpected_type: files in unusual locations
- duplication_explosion: similar names suggesting copies
- hidden_consumption: unexpectedly large hidden folders
- recursive_link: potential circular references
- quota_trending: items approaching limits

Respond in JSON: [{ "type": "...", "severity": "critical|warning|info", "path": "...", "description": "...", "recommendedAction": "..." }]
Return empty array if no anomalies found.`;

  const response = await aiCall(prompt);
  try {
    return JSON.parse(extractJson(response));
  } catch {
    return [];
  }
}

function extractJson(text: string): string {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : '[]';
}
