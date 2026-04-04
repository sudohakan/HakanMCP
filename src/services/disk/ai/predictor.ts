import { listSnapshots } from '../archiver.js';
import { drives } from '../scanner.js';
import { extractJsonArray } from '../utils.js';
import * as fs from 'node:fs/promises';
import type { PredictionResult } from '../../../types/disk.js';

export async function predictDiskUsage(
  aiCall: (prompt: string) => Promise<string>,
): Promise<PredictionResult[]> {
  const driveList = await drives().catch(() => []);
  const snapshots = await listSnapshots();

  if (snapshots.length < 2) {
    return driveList.map((d) => ({
      drive: d.name,
      currentUsedPercent: d.usedPercent,
      trend: 'stable' as const,
      dailyChangeBytes: 0,
      daysUntilFull: null,
      hotspots: [],
    }));
  }

  const [latest, previous] = snapshots.slice(0, 2);
  const latestData = JSON.parse(await fs.readFile(latest.path, 'utf-8'));
  const previousData = JSON.parse(await fs.readFile(previous.path, 'utf-8'));

  const prompt = `Analyze disk usage trend between two snapshots.

Previous snapshot (${previous.createdAt}): ${previous.totalSize} bytes, ${previous.fileCount} files
Latest snapshot (${latest.createdAt}): ${latest.totalSize} bytes, ${latest.fileCount} files

Drives: ${JSON.stringify(driveList.map((d) => ({ name: d.name, usedPercent: d.usedPercent, freeBytes: d.freeBytes })))}

Previous top dirs: ${JSON.stringify((previousData.children || []).slice(0, 10).map((c: Record<string, unknown>) => ({ name: c.name, size: c.size })))}
Latest top dirs: ${JSON.stringify((latestData.children || []).slice(0, 10).map((c: Record<string, unknown>) => ({ name: c.name, size: c.size })))}

Respond in JSON: [{ "drive": "...", "currentUsedPercent": N, "trend": "growing|stable|shrinking", "dailyChangeBytes": N, "daysUntilFull": N|null, "hotspots": [{"path": "...", "weeklyGrowthBytes": N}] }]`;

  const response = await aiCall(prompt);
  try {
    return JSON.parse(extractJsonArray(response));
  } catch {
    return driveList.map((d) => ({
      drive: d.name,
      currentUsedPercent: d.usedPercent,
      trend: 'stable' as const,
      dailyChangeBytes: 0,
      daysUntilFull: null,
      hotspots: [],
    }));
  }
}
