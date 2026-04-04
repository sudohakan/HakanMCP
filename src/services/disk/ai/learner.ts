import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getDataDir } from '../history.js';
import type { FileCategory, UserPreferences } from '../../../types/disk.js';

async function getAiDir(): Promise<string> {
  const dataDir = await getDataDir();
  const dir = path.join(dataDir, 'ai');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  acceptedCategories: {} as Record<FileCategory, number>,
  rejectedCategories: {} as Record<FileCategory, number>,
  exceptions: [],
  largeFileThreshold: 100 * 1024 * 1024,
  lastUpdated: new Date().toISOString(),
};

export async function loadPreferences(): Promise<UserPreferences> {
  const dir = await getAiDir();
  try {
    const content = await fs.readFile(path.join(dir, 'preferences.json'), 'utf-8');
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(content) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

async function savePreferences(prefs: UserPreferences): Promise<void> {
  const dir = await getAiDir();
  const updated = { ...prefs, lastUpdated: new Date().toISOString() };
  await fs.writeFile(path.join(dir, 'preferences.json'), JSON.stringify(updated, null, 2));
}

export async function recordFeedback(
  decision: 'accept' | 'reject',
  category: FileCategory,
  filePath?: string,
): Promise<void> {
  const prefs = await loadPreferences();
  if (decision === 'accept') {
    prefs.acceptedCategories[category] = (prefs.acceptedCategories[category] || 0) + 1;
  } else {
    prefs.rejectedCategories[category] = (prefs.rejectedCategories[category] || 0) + 1;
    if (filePath && !prefs.exceptions.includes(filePath)) {
      prefs.exceptions.push(filePath);
    }
  }
  await savePreferences(prefs);

  const dir = await getAiDir();
  const entry = { decision, category, filePath, timestamp: new Date().toISOString() };
  await fs.appendFile(path.join(dir, 'feedback.jsonl'), JSON.stringify(entry) + '\n');
}

export async function addException(filePath: string): Promise<void> {
  const prefs = await loadPreferences();
  if (!prefs.exceptions.includes(filePath)) {
    prefs.exceptions.push(filePath);
    await savePreferences(prefs);
  }
}

export async function removeException(filePath: string): Promise<void> {
  const prefs = await loadPreferences();
  prefs.exceptions = prefs.exceptions.filter((e) => e !== filePath);
  await savePreferences(prefs);
}

export async function updateThreshold(thresholdBytes: number): Promise<void> {
  const prefs = await loadPreferences();
  prefs.largeFileThreshold = thresholdBytes;
  await savePreferences(prefs);
}

export function getCategoryConfidence(prefs: UserPreferences, category: FileCategory): number {
  const accepted = prefs.acceptedCategories[category] || 0;
  const rejected = prefs.rejectedCategories[category] || 0;
  const total = accepted + rejected;
  if (total === 0) return 0.5;
  return accepted / total;
}
