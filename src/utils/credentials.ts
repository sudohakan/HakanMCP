import { readFileSync } from 'fs';

const DEFAULT_PATH = process.env.CREDENTIALS_FILE || `${process.env.HOME || '/home'}/.credentials.env`;

export function loadCredentials(filePath: string = DEFAULT_PATH): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) result[key] = value;
  }

  return result;
}

export function resolveEnvKeys(
  keys: string[],
  filePath: string = DEFAULT_PATH,
): Record<string, string> {
  const all = loadCredentials(filePath);
  const result: Record<string, string> = {};

  for (const key of keys) {
    if (!(key in all)) {
      throw new Error(`Credential key "${key}" not found in ${filePath}`);
    }
    result[key] = all[key];
  }

  return result;
}
