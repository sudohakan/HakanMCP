/**
 * CLI chat user preferences stored in ~/.hakanmcp/chat-settings.json.
 * Controls Ollama usage in console chat (separate from config for scheduled tasks).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SETTINGS_DIR = path.join(os.homedir(), '.hakanmcp');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'chat-settings.json');

export interface ChatSettings {
  useOllamaInChat?: boolean;
  /** When false, CLI chat uses only CLI providers (codex/gemini/claude cli), not API. Default true. */
  useApiKeys?: boolean;
}

const DEFAULTS: ChatSettings = {
  useOllamaInChat: false,
  useApiKeys: true,
};

function ensureDir(): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

export function getChatSettings(): ChatSettings {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setChatSettings(partial: Partial<ChatSettings>): ChatSettings {
  ensureDir();
  const current = getChatSettings();
  const next = { ...current, ...partial };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function getChatSettingsPath(): string {
  return SETTINGS_FILE;
}
