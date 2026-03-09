/**
 * AI Provider Limits Service — tracks:
 * - API 429 rate-limit cooldowns per provider
 * - CLI daily/weekly usage limits
 * Persists to .ai-provider-cooldowns.json and .ai-provider-usage.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { PROJECT_ROOT } from '../utils/projectRoot.js';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execAsync = promisify(exec);

export type AiProviderId = 'codex' | 'claude' | 'gemini';
export type CliProviderId = 'codex' | 'claude' | 'gemini' | 'cursor';

export interface CooldownEntry {
  until: number; // ms since epoch
  reason?: string;
}

export interface CooldownStatus {
  provider: AiProviderId | CliProviderId;
  label: string;
  status: 'unchecked' | 'available' | 'unavailable' | 'cooldown';
  reason?: string;
  until?: number;
  remainingMs?: number;
  /** 'api' = 429 from API; 'cli' = parsed limit from CLI stderr */
  source?: 'api' | 'cli';
}

export interface ProviderAvailabilityEntry {
  status: 'unchecked' | 'available' | 'unavailable';
  reason?: string;
  checkedAt: number; // ms epoch
}

export interface CliUsageEntry {
  date: string; // YYYY-MM-DD
  dailyCount: number;
  weekStart: string; // YYYY-MM-DD (Monday)
  weeklyCount: number;
}

export interface CliUsageStatus {
  provider: CliProviderId;
  label: string;
  dailyUsed: number;
  dailyLimit: number;
  weeklyUsed: number;
  weeklyLimit: number;
  limited: boolean;
}

export interface ApiUsageStatus {
  provider: AiProviderId;
  label: string;
  dailyUsed: number;
  dailyLimit: number;
  weeklyUsed: number;
  weeklyLimit: number;
  limited: boolean;
}

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  codex: 'Codex (OpenAI)',
  claude: 'Claude (Anthropic)',
  gemini: 'Gemini',
};

const CLI_LABELS: Record<CliProviderId, string> = {
  ...PROVIDER_LABELS,
  cursor: 'Cursor CLI',
};

const DEFAULT_COOLDOWN_MS = 60_000; // 1 min when Retry-After not provided
/** 15 min fallback when CLI limit message cannot be parsed. Exported for aiTools. */
export const CLI_LIMIT_FALLBACK_MS = 15 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_WEEKLY_LIMIT = 200;

const API_COOLDOWN_KEYS: Array<`${AiProviderId}_api`> = ['codex_api', 'claude_api', 'gemini_api'];
const CLI_COOLDOWN_KEYS: Array<`${CliProviderId}_cli`> = [
  'codex_cli',
  'claude_cli',
  'gemini_cli',
  'cursor_cli',
];
const COOLDOWN_KEYS_ALL = [...API_COOLDOWN_KEYS, ...CLI_COOLDOWN_KEYS] as string[];

let cooldownsPath: string | null = null;
let usagePath: string | null = null;
let statusPath: string | null = null;

/** 15 min stale threshold for provider availability revalidation */
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

function getBasePath(): string {
  return PROJECT_ROOT;
}

function getCooldownsPath(): string {
  if (cooldownsPath) return cooldownsPath;
  cooldownsPath = path.join(getBasePath(), '.ai-provider-cooldowns.json');
  return cooldownsPath;
}

function getUsagePath(): string {
  if (usagePath) return usagePath;
  usagePath = path.join(getBasePath(), '.ai-provider-usage.json');
  return usagePath;
}

function getStatusPath(): string {
  if (statusPath) return statusPath;
  statusPath = path.join(getBasePath(), '.ai-provider-status.json');
  return statusPath;
}

/**
 * Set the base path for limits files (for tests or non-cwd contexts).
 */
export function setCooldownsBasePath(basePath: string): void {
  cooldownsPath = path.join(basePath, '.ai-provider-cooldowns.json');
  usagePath = path.join(basePath, '.ai-provider-usage.json');
  statusPath = path.join(basePath, '.ai-provider-status.json');
}

// ─── Provider Availability Storage ────────────────────────────────

type AvailabilityKey = `${AiProviderId}_api` | `${CliProviderId}_cli`;

function loadProviderStatus(): Partial<Record<AvailabilityKey, ProviderAvailabilityEntry>> {
  try {
    const p = getStatusPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw) as Partial<Record<AvailabilityKey, ProviderAvailabilityEntry>>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveProviderStatus(map: Partial<Record<AvailabilityKey, ProviderAvailabilityEntry>>): void {
  try {
    const p = getStatusPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* ignore */
  }
}

export function setProviderAvailability(
  key: AvailabilityKey,
  status: 'available' | 'unavailable',
  reason?: string,
): void {
  const map = loadProviderStatus();
  map[key] = { status, reason, checkedAt: Date.now() };
  saveProviderStatus(map);
}

export function getProviderAvailability(key: AvailabilityKey): ProviderAvailabilityEntry {
  const map = loadProviderStatus();
  return map[key] ?? { status: 'unchecked', checkedAt: 0 };
}

export function isProviderStale(key: AvailabilityKey): boolean {
  const entry = getProviderAvailability(key);
  if (entry.status === 'unchecked') return true;
  return Date.now() - entry.checkedAt > STALE_THRESHOLD_MS;
}

/**
 * Check if an API key exists for a provider (env var or encrypted config).
 * Does NOT make API calls — only checks key presence.
 * Returns { found: boolean; source?: string }.
 */
export function checkApiKeyExists(provider: AiProviderId): { found: boolean; source?: string } {
  const envMap: Record<AiProviderId, string[]> = {
    codex: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    claude: ['CLAUDE_CODE_API_KEY', 'ANTHROPIC_API_KEY'],
    gemini: ['GEMINI_API_KEY'],
  };
  const encryptedMap: Record<AiProviderId, string | undefined> = {
    codex: config.aiProviders?.codexKeyEncrypted,
    claude: config.aiProviders?.claudeKeyEncrypted,
    gemini: config.aiProviders?.geminiKeyEncrypted,
  };

  for (const envVar of envMap[provider] ?? []) {
    if (process.env[envVar]) return { found: true, source: `key found (env: ${envVar})` };
  }
  if (encryptedMap[provider]) return { found: true, source: 'key found (encrypted config)' };
  return { found: false, source: 'no API key' };
}

const LEGACY_KEYS: Array<AiProviderId | CliProviderId> = ['codex', 'claude', 'gemini', 'cursor'];

function loadCooldowns(): Partial<Record<string, CooldownEntry>> {
  try {
    const p = getCooldownsPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw) as Record<string, CooldownEntry>;
      const result: Partial<Record<string, CooldownEntry>> = {};
      const now = Date.now();
      for (const id of COOLDOWN_KEYS_ALL) {
        const entry = data[id];
        if (entry && typeof entry.until === 'number' && entry.until > now) {
          result[id] = entry;
        }
      }
      // Migrate legacy keys (codex, claude, gemini, cursor) -> _cli, then rewrite file
      let migrated = false;
      for (const leg of LEGACY_KEYS) {
        const entry = data[leg];
        if (entry && typeof entry.until === 'number' && entry.until > now) {
          const newKey = leg === 'cursor' ? 'cursor_cli' : `${leg}_cli`;
          if (!result[newKey] || entry.until > (result[newKey]?.until ?? 0)) {
            result[newKey] = entry;
            migrated = true;
          }
        }
      }
      if (migrated) saveCooldowns(result);
      return result;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveCooldowns(map: Partial<Record<string, CooldownEntry>>): void {
  try {
    const p = getCooldownsPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* ignore */
  }
}

/** Resolve cooldown keys for a provider (api + cli for codex/claude/gemini; cli only for cursor) */
function getCooldownKeys(provider: AiProviderId | CliProviderId): string[] {
  if (provider === 'cursor') return ['cursor_cli'];
  return [`${provider}_api`, `${provider}_cli`];
}

/**
 * Check if a provider is currently in cooldown (API or CLI).
 */
export function isInCooldown(provider: AiProviderId | CliProviderId): boolean {
  const map = loadCooldowns();
  const keys = getCooldownKeys(provider);
  const now = Date.now();
  for (const key of keys) {
    const entry = map[key];
    if (entry && entry.until > now) return true;
  }
  return false;
}

/**
 * Set API cooldown (429 from HTTP). Used by aiProviders.
 */
export function setCooldown(
  provider: AiProviderId,
  durationMs = DEFAULT_COOLDOWN_MS,
  reason?: string,
): void {
  const map = loadCooldowns();
  const key = `${provider}_api`;
  const until = Date.now() + durationMs;
  (map as Record<string, CooldownEntry>)[key] = { until, reason };
  saveCooldowns(map);
}

/**
 * Reset all provider cooldowns, usage, and availability status.
 */
export function resetCooldowns(): void {
  try {
    const p = getCooldownsPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
  try {
    const p = getStatusPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
  resetCliUsage();
}

/**
 * Reset API cooldown entries (optionally for a specific provider).
 * Clears cooldown + sets availability to unchecked.
 */
export function resetApiCooldowns(provider?: AiProviderId): void {
  const map = loadCooldowns();
  const statusMap = loadProviderStatus();
  const keys = provider ? [`${provider}_api`] : API_COOLDOWN_KEYS;
  for (const key of keys) {
    delete map[key];
    statusMap[key as AvailabilityKey] = { status: 'unchecked', checkedAt: 0 };
  }
  saveCooldowns(map);
  saveProviderStatus(statusMap);
}

/**
 * Reset CLI cooldown entries (optionally for a specific provider).
 * Clears cooldown + sets availability to unchecked.
 */
export function resetCliCooldowns(provider?: CliProviderId): void {
  const map = loadCooldowns();
  const statusMap = loadProviderStatus();
  const keys = provider ? [`${provider}_cli`] : CLI_COOLDOWN_KEYS;
  for (const key of keys) {
    delete map[key];
    statusMap[key as AvailabilityKey] = { status: 'unchecked', checkedAt: 0 };
  }
  saveCooldowns(map);
  saveProviderStatus(statusMap);
}

/**
 * Reset API usage counts (optionally for a specific provider).
 */
export function resetApiUsage(provider?: AiProviderId): void {
  const map = loadUsage();
  if (provider) {
    delete map[`${provider}_api`];
  } else {
    for (const key of API_COOLDOWN_KEYS) {
      const usageKey = key as UsageKey;
      delete map[usageKey];
    }
  }
  saveUsage(map);
}

/**
 * Reset CLI usage counts (optionally for a specific provider).
 */
export function resetCliUsageFor(provider?: CliProviderId): void {
  if (!provider) {
    resetCliUsage();
    return;
  }
  const map = loadUsage();
  delete map[provider];
  saveUsage(map);
}

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

type UsageKey = CliProviderId | `${AiProviderId}_api`;

function loadUsage(): Partial<Record<UsageKey, CliUsageEntry>> {
  try {
    const p = getUsagePath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw) as Partial<Record<UsageKey, CliUsageEntry>>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveUsage(map: Partial<Record<UsageKey, CliUsageEntry>>): void {
  try {
    const p = getUsagePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* ignore */
  }
}

function getLimitsConfig(provider?: CliProviderId): { daily: number; weekly: number } {
  const providerOverride = provider ? (config.cli as Record<string, unknown> | undefined)?.[provider] as { dailyLimit?: number; weeklyLimit?: number } | undefined : undefined;
  return {
    daily: providerOverride?.dailyLimit ?? config.cli?.dailyLimit ?? DEFAULT_DAILY_LIMIT,
    weekly: providerOverride?.weeklyLimit ?? config.cli?.weeklyLimit ?? DEFAULT_WEEKLY_LIMIT,
  };
}

function getApiLimitsConfig(provider?: AiProviderId): { daily: number; weekly: number } {
  const providerOverride = provider ? (config.api as Record<string, unknown> | undefined)?.[provider] as { dailyLimit?: number; weeklyLimit?: number } | undefined : undefined;
  return {
    daily: providerOverride?.dailyLimit ?? config.api?.dailyLimit ?? DEFAULT_DAILY_LIMIT,
    weekly: providerOverride?.weeklyLimit ?? config.api?.weeklyLimit ?? DEFAULT_WEEKLY_LIMIT,
  };
}

/**
 * Record a CLI call for usage tracking. Call before or after a successful CLI invocation.
 */
export function recordCliUsage(provider: CliProviderId): void {
  const map = loadUsage();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekStart = getMonday(now);

  const entry = map[provider];
  let dailyCount = 0;
  let weeklyCount = 0;
  if (entry) {
    if (entry.date === today) {
      dailyCount = entry.dailyCount + 1;
    }
    if (entry.weekStart === weekStart) {
      weeklyCount = entry.weeklyCount + 1;
    }
  }
  if (dailyCount === 0) dailyCount = 1;
  if (weeklyCount === 0) weeklyCount = 1;

  (map as Record<CliProviderId, CliUsageEntry>)[provider] = {
    date: today,
    dailyCount,
    weekStart,
    weeklyCount,
  };
  saveUsage(map);
}

/**
 * Check if a CLI provider has reached its daily or weekly limit.
 */
export function isCliLimited(provider: CliProviderId): boolean {
  const map = loadUsage();
  const entry = map[provider];
  if (!entry) return false;
  const limits = getLimitsConfig(provider);
  if (limits.daily === 0 && limits.weekly === 0) return false;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekStart = getMonday(now);
  if (entry.date !== today || entry.weekStart !== weekStart) return false;

  const dailyLimited = limits.daily > 0 && entry.dailyCount >= limits.daily;
  const weeklyLimited = limits.weekly > 0 && entry.weeklyCount >= limits.weekly;
  return dailyLimited || weeklyLimited;
}

/**
 * Record an API call for usage tracking. Call after a successful API invocation.
 */
export function recordApiUsage(provider: AiProviderId): void {
  const map = loadUsage();
  const key: UsageKey = `${provider}_api`;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekStart = getMonday(now);

  const entry = map[key];
  let dailyCount = 0;
  let weeklyCount = 0;
  if (entry) {
    if (entry.date === today) {
      dailyCount = entry.dailyCount + 1;
    }
    if (entry.weekStart === weekStart) {
      weeklyCount = entry.weeklyCount + 1;
    }
  }
  if (dailyCount === 0) dailyCount = 1;
  if (weeklyCount === 0) weeklyCount = 1;

  (map as Partial<Record<UsageKey, CliUsageEntry>>)[key] = {
    date: today,
    dailyCount,
    weekStart,
    weeklyCount,
  };
  saveUsage(map);
}

/**
 * Check if an API provider has reached its daily or weekly limit.
 */
export function isApiLimited(provider: AiProviderId): boolean {
  const map = loadUsage();
  const key: UsageKey = `${provider}_api`;
  const entry = map[key];
  if (!entry) return false;
  const limits = getApiLimitsConfig(provider);
  if (limits.daily === 0 && limits.weekly === 0) return false;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekStart = getMonday(now);
  if (entry.date !== today || entry.weekStart !== weekStart) return false;

  const dailyLimited = limits.daily > 0 && entry.dailyCount >= limits.daily;
  const weeklyLimited = limits.weekly > 0 && entry.weeklyCount >= limits.weekly;
  return dailyLimited || weeklyLimited;
}

/**
 * Get API usage status for Codex, Claude, Gemini.
 */
export function getApiUsageStatus(): ApiUsageStatus[] {
  const map = loadUsage();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekStart = getMonday(now);
  const result: ApiUsageStatus[] = [];

  for (const provider of ['codex', 'claude', 'gemini'] as AiProviderId[]) {
    const limits = getApiLimitsConfig(provider);
    const key: UsageKey = `${provider}_api`;
    const entry = map[key];
    let dailyUsed = 0;
    let weeklyUsed = 0;
    if (entry && entry.date === today) dailyUsed = entry.dailyCount;
    if (entry && entry.weekStart === weekStart) weeklyUsed = entry.weeklyCount;
    const dailyLimited = limits.daily > 0 && dailyUsed >= limits.daily;
    const weeklyLimited = limits.weekly > 0 && weeklyUsed >= limits.weekly;
    const limited = dailyLimited || weeklyLimited;
    result.push({
      provider,
      label: PROVIDER_LABELS[provider],
      dailyUsed,
      dailyLimit: limits.daily,
      weeklyUsed,
      weeklyLimit: limits.weekly,
      limited,
    });
  }
  return result;
}

/**
 * Get CLI usage status for all providers.
 */
export function getCliUsageStatus(): CliUsageStatus[] {
  const map = loadUsage();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekStart = getMonday(now);
  const result: CliUsageStatus[] = [];

  for (const provider of ['codex', 'claude', 'gemini', 'cursor'] as CliProviderId[]) {
    const limits = getLimitsConfig(provider);
    const entry = map[provider];
    let dailyUsed = 0;
    let weeklyUsed = 0;
    if (entry && entry.date === today) dailyUsed = entry.dailyCount;
    if (entry && entry.weekStart === weekStart) weeklyUsed = entry.weeklyCount;
    const dailyLimited = limits.daily > 0 && dailyUsed >= limits.daily;
    const weeklyLimited = limits.weekly > 0 && weeklyUsed >= limits.weekly;
    const limited = dailyLimited || weeklyLimited;
    result.push({
      provider,
      label: CLI_LABELS[provider],
      dailyUsed,
      dailyLimit: limits.daily,
      weeklyUsed,
      weeklyLimit: limits.weekly,
      limited,
    });
  }
  return result;
}

/**
 * Reset CLI usage counts.
 */
export function resetCliUsage(): void {
  try {
    const p = getUsagePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

/**
 * Parse Retry-After header. Returns seconds, or null if invalid.
 */
export function parseRetryAfter(value: string | null): number | null {
  if (!value || typeof value !== 'string') return null;
  const s = value.trim();
  const num = parseInt(s, 10);
  if (!Number.isNaN(num) && num > 0) return num;
  const date = new Date(s);
  if (!Number.isNaN(date.getTime())) {
    const sec = Math.ceil((date.getTime() - Date.now()) / 1000);
    return Math.max(1, sec);
  }
  return null;
}

function stripAnsi(str: string): string {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    new RegExp('[\\u001b\\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]', 'g'),
    '',
  );
}

function parseTimeToday(timeStr: string, ampm?: string): number {
  const now = Date.now();
  const [hoursStr, minsStr] = timeStr.split(':');
  let hours = parseInt(hoursStr ?? '0', 10);
  const minutes = minsStr ? parseInt(minsStr, 10) : 0;
  if (ampm) {
    if (hours === 12) hours = 0;
    if (ampm.toLowerCase() === 'pm') hours += 12;
  }
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now - 60_000) target.setDate(target.getDate() + 1);
  return target.getTime();
}

/**
 * Parse CLI limit/rate-limit error message to extract "resets at" timestamp.
 * Returns untilMs (epoch) or null.
 */
export function parseCliLimitMessage(raw: string): number | null {
  const cleaned = stripAnsi(raw)
    .replace(/\u00A0/g, ' ')
    .trim();
  const normalized = cleaned.toLowerCase();
  const now = Date.now();

  // Try explicit time/date FIRST — relative "in 15 min" often wrong when "resets at 3pm" exists
  // Codex: "Access resets on Feb 24th, 2026 5:28 PM"
  const resetsOnMatch = normalized.match(
    /resets on\s+([A-Za-z]{3})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i,
  );
  if (resetsOnMatch) {
    const day = resetsOnMatch[2].replace(/(\d+)(st|nd|rd|th)/i, '$1');
    const dateStr = `${resetsOnMatch[1]} ${day}, ${resetsOnMatch[3]} ${resetsOnMatch[4]}:${resetsOnMatch[5]}${resetsOnMatch[6] ? ' ' + resetsOnMatch[6] : ''}`;
    const ts = new Date(dateStr).getTime();
    if (!Number.isNaN(ts)) return ts;
  }

  // "try again at Mon 24th, 2026 5:28 pm"
  const tryAgainMatch = normalized.match(
    /at\s+([a-z]{3})\s+(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(am|pm)/i,
  );
  if (tryAgainMatch) {
    const dateStr = `${tryAgainMatch[1]} ${tryAgainMatch[2]}, ${tryAgainMatch[3]} ${tryAgainMatch[4]}:${tryAgainMatch[5]} ${tryAgainMatch[6]}`;
    const ts = Date.parse(dateStr);
    if (!Number.isNaN(ts)) return ts;
  }

  // Claude CLI: "resets Feb 23, 3pm" or "resets Feb 20 at 12am" or "resets Feb 20, 5pm (Africa/Libreville)"
  const claudeDateMatch = normalized.match(
    /resets\s+([a-z]{3})\s+(\d{1,2})(?:\s+at\s+|\s*,\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\([^)]+\))?/i,
  );
  if (claudeDateMatch) {
    const month = claudeDateMatch[1];
    const day = claudeDateMatch[2];
    const h = claudeDateMatch[3];
    const m = claudeDateMatch[4] || '00';
    const ampm = claudeDateMatch[5];
    const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
    const year = new Date().getFullYear();
    const dateStr = `${monthCap} ${day}, ${year} ${h}:${m}${ampm ? ' ' + ampm : ''}`;
    const ts = Date.parse(dateStr);
    if (!Number.isNaN(ts)) return ts;
  }

  // Gemini: "Access resets at 4:16 PM GMT+3" or "resets at 4:16 PM"
  const timeResetsMatch = normalized.match(
    /resets(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+GMT[+-]\d+)?/i,
  );
  if (timeResetsMatch) {
    const timeStr = timeResetsMatch[2]
      ? `${timeResetsMatch[1]}:${timeResetsMatch[2]}`
      : timeResetsMatch[1];
    return parseTimeToday(timeStr, timeResetsMatch[3]);
  }

  // Gemini: "Your quota will reset after 4h58m24s" or "reset after 4h"
  const resetAfterMatch = normalized.match(
    /reset[s]?\s+after\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i,
  );
  if (resetAfterMatch) {
    const hours = parseInt(resetAfterMatch[1] || '0', 10);
    const minutes = parseInt(resetAfterMatch[2] || '0', 10);
    const seconds = parseInt(resetAfterMatch[3] || '0', 10);
    if (hours > 0 || minutes > 0 || seconds > 0) {
      return now + hours * 3_600_000 + minutes * 60_000 + seconds * 1000;
    }
  }

  // Claude CLI: "You've hit your limit · resets 3pm (Europe/Istanbul)" or "resets 4pm (Asia/Kuala_Lumpur)"
  const claudeResetsMatch = normalized.match(
    /(?:hit your limit|you've hit your limit)\s*[·•.]\s*resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\([^)]+\))?/i,
  );
  if (claudeResetsMatch) {
    const timeStr = claudeResetsMatch[2]
      ? `${claudeResetsMatch[1]}:${claudeResetsMatch[2]}`
      : claudeResetsMatch[1];
    return parseTimeToday(timeStr, claudeResetsMatch[3]);
  }

  // "resets 4pm" or "resets 4:30 PM" or "resets at 3pm" (standalone, e.g. Claude CLI stderr)
  const bareResetsMatch = normalized.match(
    /\bresets(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\([^)]+\))?/i,
  );
  if (bareResetsMatch) {
    const timeStr = bareResetsMatch[2]
      ? `${bareResetsMatch[1]}:${bareResetsMatch[2]}`
      : bareResetsMatch[1];
    return parseTimeToday(timeStr, bareResetsMatch[3]);
  }

  // Claude CLI: "resets in 2 hours" / "resets in 30 minutes"
  const resetsInMatch = normalized.match(
    /\bresets\s+in\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i,
  );
  if (resetsInMatch) {
    const amount = parseInt(resetsInMatch[1], 10);
    const unit = resetsInMatch[2].toLowerCase();
    if (!Number.isNaN(amount) && amount > 0) {
      let ms = amount * 60_000;
      if (unit.startsWith('h')) ms = amount * 3_600_000;
      return now + ms;
    }
  }

  // Claude CLI: full month "resets February 23, 3pm" or "resets March 15, 4:30pm"
  const monthNames =
    'january|february|march|april|may|june|july|august|september|october|november|december';
  const claudeFullMonthMatch = normalized.match(
    new RegExp(
      `resets\\s+(${monthNames})\\s+(\\d{1,2}),?\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?(?:\\s*\\([^)]+\\))?`,
      'i',
    ),
  );
  if (claudeFullMonthMatch) {
    const monthStr = claudeFullMonthMatch[1];
    const day = claudeFullMonthMatch[2];
    const h = claudeFullMonthMatch[3];
    const m = claudeFullMonthMatch[4] || '00';
    const ampm = claudeFullMonthMatch[5];
    const monthIdx = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ].indexOf(monthStr.slice(0, 3).toLowerCase());
    if (monthIdx >= 0) {
      const year = new Date().getFullYear();
      const hours = ampm
        ? (parseInt(h, 10) % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0)
        : parseInt(h, 10);
      const minutes = parseInt(m, 10);
      const target = new Date(year, monthIdx, parseInt(day, 10), hours, minutes, 0, 0);
      const ts = target.getTime();
      if (!Number.isNaN(ts)) return ts;
    }
  }

  // Claude CLI: 24-hour format "resets 15:00" or "resets at 15:00 (Europe/Istanbul)"
  const claude24hMatch = normalized.match(
    /\bresets(?:\s+at)?\s+(\d{1,2}):(\d{2})(?:\s*\([^)]+\))?/i,
  );
  if (claude24hMatch) {
    const h = parseInt(claude24hMatch[1], 10);
    const m = parseInt(claude24hMatch[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const target = new Date();
      target.setHours(h, m, 0, 0);
      if (target.getTime() <= now - 60_000) target.setDate(target.getDate() + 1);
      return target.getTime();
    }
  }

  // Claude CLI: "Resets: 3pm" or "Resets: 4:30 PM (Europe/Istanbul)" (colon after resets)
  const claudeColonMatch = normalized.match(
    /\bresets\s*:\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\([^)]+\))?/i,
  );
  if (claudeColonMatch) {
    const timeStr = claudeColonMatch[2]
      ? `${claudeColonMatch[1]}:${claudeColonMatch[2]}`
      : claudeColonMatch[1];
    return parseTimeToday(timeStr, claudeColonMatch[3]);
  }

  // Claude CLI: "limit resets at 3pm" (limit before resets)
  const limitResetsMatch = normalized.match(
    /\blimit\s+resets\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\([^)]+\))?/i,
  );
  if (limitResetsMatch) {
    const timeStr = limitResetsMatch[2]
      ? `${limitResetsMatch[1]}:${limitResetsMatch[2]}`
      : limitResetsMatch[1];
    return parseTimeToday(timeStr, limitResetsMatch[3]);
  }

  // Claude: "Your limit will reset at 7pm (Asia/Tokyo)" or "limit resets at 10pm today"
  const resetAtMatch = normalized.match(
    /\b(?:limit\s+will\s+)?reset[s]?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(?:today|\([^)]+\)))?/i,
  );
  if (resetAtMatch) {
    const timeStr = resetAtMatch[2] ? `${resetAtMatch[1]}:${resetAtMatch[2]}` : resetAtMatch[1];
    return parseTimeToday(timeStr, resetAtMatch[3]);
  }

  // Relative (LAST — prefer explicit time): "try again in 20s", "retry in 5 minutes"
  const relativeMatch = normalized.match(
    /(?:try again in|retry in|in)\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    if (!Number.isNaN(amount) && amount > 0) {
      let ms = amount * 1000;
      if (unit.startsWith('m')) ms = amount * 60_000;
      if (unit.startsWith('h')) ms = amount * 3_600_000;
      return now + ms;
    }
  }

  return null;
}

/**
 * Set CLI cooldown until a specific timestamp (from parsed CLI limit message).
 * Only call when parseCliLimitMessage returns a valid timestamp — avoids false positives.
 * Returns false if untilMs is null (no cooldown set).
 */
export function setCooldownUntil(
  provider: CliProviderId,
  untilMs: number | null,
  reason?: string,
): boolean {
  if (untilMs == null || untilMs <= Date.now()) return false;
  const map = loadCooldowns();
  const key = `${provider}_cli`;
  (map as Record<string, CooldownEntry>)[key] = { until: untilMs, reason };
  saveCooldowns(map);
  return true;
}

/** Check if message looks like a CLI rate/usage limit error. */
export function isCliLimitError(message: string): boolean {
  const n = message.toLowerCase();
  return (
    /limit|resets|usage limit|hit your|rate limit|rate limit reached|rate limit exceeded|quota/i.test(
      n,
    ) ||
    /\breset\s+after\b/i.test(n) ||
    /try again (at|in)|retry (at|in)/i.test(n) ||
    /429|529|resource_exhausted|no capacity|capacity.*exhausted|model capacity|api error.*rate/i.test(
      n,
    ) ||
    /rate_limit_error|overloaded_error|overloaded|daily limit|free tier limit/i.test(n)
  );
}

/**
 * Get API cooldown status (429 from Codex/Claude/Gemini API).
 * Priority: cooldown > unchecked > unavailable > available (with stale recheck).
 */
export function getApiCooldownStatus(): CooldownStatus[] {
  const map = loadCooldowns();
  const now = Date.now();
  const result: CooldownStatus[] = [];
  for (const key of API_COOLDOWN_KEYS) {
    const provider = key.replace(/_api$/, '') as AiProviderId;
    const entry = map[key];
    const label = PROVIDER_LABELS[provider];

    // Cooldown takes priority
    if (entry && entry.until > now) {
      result.push({
        provider,
        label,
        status: 'cooldown',
        until: entry.until,
        remainingMs: entry.until - now,
        source: 'api',
      });
      continue;
    }

    // Check availability (stale-while-revalidate)
    const avail = getProviderAvailability(key);
    if (avail.status === 'unchecked') {
      result.push({ provider, label, status: 'unchecked', reason: 'not yet verified', source: 'api' });
      continue;
    }

    // Inline recheck if stale
    if (isProviderStale(key)) {
      const check = checkApiKeyExists(provider);
      const newStatus = check.found ? 'available' : 'unavailable';
      setProviderAvailability(key, newStatus, check.source);
      result.push({ provider, label, status: newStatus, reason: check.source, source: 'api' });
      continue;
    }

    result.push({ provider, label, status: avail.status, reason: avail.reason, source: 'api' });
  }
  return result;
}

/**
 * Get CLI cooldown status (parsed limit from CLI stderr).
 * Priority: cooldown > unchecked > unavailable > available (with stale check).
 */
export function getCliCooldownStatus(): CooldownStatus[] {
  const map = loadCooldowns();
  const now = Date.now();
  const result: CooldownStatus[] = [];
  for (const key of CLI_COOLDOWN_KEYS) {
    const provider = key.replace(/_cli$/, '') as CliProviderId;
    const entry = map[key];
    const label = CLI_LABELS[provider];

    // Cooldown takes priority
    if (entry && entry.until > now) {
      result.push({
        provider,
        label,
        status: 'cooldown',
        until: entry.until,
        remainingMs: entry.until - now,
        source: 'cli',
      });
      continue;
    }

    // Check availability
    const avail = getProviderAvailability(key);
    if (avail.status === 'unchecked') {
      result.push({ provider, label, status: 'unchecked', reason: 'not yet verified', source: 'cli' });
      continue;
    }

    result.push({ provider, label, status: avail.status, reason: avail.reason, source: 'cli' });
  }
  return result;
}

/** @deprecated Use getApiCooldownStatus + getCliCooldownStatus for separate display */
export function getCooldownStatus(): CooldownStatus[] {
  return [...getApiCooldownStatus(), ...getCliCooldownStatus()];
}

export interface OllamaModelInfo {
  name: string;
  size: string;
  modifiedAt: string;
  stale: boolean; // true if not updated in 30+ days
}

export interface OllamaStatusResult {
  online: boolean;
  url: string;
  defaultModel: string;
  runningModel?: string;
  models: OllamaModelInfo[];
  disabled: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return -1;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Check Ollama status (connectivity + running model + model details).
 * Always probes Ollama even if disabled in config (to show model info).
 */
export async function getOllamaStatus(): Promise<OllamaStatusResult> {
  const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
  const ollamaModel = config.ollamaModel || 'unknown';
  const disabled =
    !(config.aiProviders?.localModels) ||
    process.env.DISABLE_LOCAL_MODELS === '1';
  const result: OllamaStatusResult = {
    online: false,
    url: ollamaUrl,
    defaultModel: ollamaModel,
    runningModel: undefined,
    models: [],
    disabled,
  };

  // Always probe Ollama (even when disabled) to show model info
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${ollamaUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (resp.ok) {
      result.online = true;
      const data = (await resp.json()) as {
        models?: Array<{ name?: string; size?: number; modified_at?: string }>;
      };
      result.models = (data.models ?? [])
        .filter((m) => m.name)
        .map((m) => {
          const days = daysSince(m.modified_at ?? '');
          return {
            name: m.name!,
            size: formatBytes(m.size ?? 0),
            modifiedAt: m.modified_at ?? '',
            stale: days >= 30,
          };
        });
    }
  } catch {
    /* offline */
  }

  if (result.online) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${ollamaUrl}/api/ps`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = (await resp.json()) as { models?: Array<{ name?: string }> };
        const running = (data.models ?? []).map((m) => m.name ?? '').filter(Boolean);
        if (running.length > 0) result.runningModel = running.join(', ');
      }
    } catch {
      /* ignore */
    }
  }

  return result;
}

/**
 * Logs any active cooldowns or CLI limits using the provided logger or console.error.
 */
export function logActiveCooldowns(): void {
  const apiStatus = getApiCooldownStatus();
  const cliCooldown = getCliCooldownStatus();
  const cliUsageStatus = getCliUsageStatus();

  let hasCooldowns = false;

  apiStatus.forEach((s) => {
    if (s.status === 'cooldown' && s.until) {
      if (!hasCooldowns) {
        console.error(
          '\x1b[36m[INFO] The following AI providers are currently on cooldown or rate limited:\x1b[0m',
        );
        hasCooldowns = true;
      }
      const resets = new Date(s.until).toLocaleString();
      const minLeft = Math.ceil((s.remainingMs ?? 0) / 60_000);
      console.error(
        `  - \x1b[36m${s.label} (API)\x1b[0m: 429 rate limited. Resets at ${resets} (~${minLeft} min left)`,
      );
    }
  });

  cliCooldown.forEach((s) => {
    if (s.status === 'cooldown' && s.until) {
      if (!hasCooldowns) {
        console.error(
          '\x1b[36m[INFO] The following AI providers are currently on cooldown or rate limited:\x1b[0m',
        );
        hasCooldowns = true;
      }
      const resets = new Date(s.until).toLocaleString();
      const minLeft = Math.ceil((s.remainingMs ?? 0) / 60_000);
      console.error(
        `  - \x1b[36m${s.label} (CLI)\x1b[0m: Limit parsed. Resets at ${resets} (~${minLeft} min left)`,
      );
    }
  });

  cliUsageStatus.forEach((s) => {
    if (s.limited) {
      if (!hasCooldowns) {
        console.error(
          '\x1b[36m[INFO] The following AI providers are currently on cooldown or rate limited:\x1b[0m',
        );
        hasCooldowns = true;
      }
      console.error(
        `  - \x1b[36m${s.label}\x1b[0m: CLI usage limit reached. (Daily: ${s.dailyUsed}/${s.dailyLimit}, Weekly: ${s.weeklyUsed}/${s.weeklyLimit})`,
      );
    }
  });

  if (hasCooldowns) {
    console.error(
      '\x1b[36m[INFO] Fallback providers or Ollama will be used where applicable.\x1b[0m',
    );
  }

  // Log Ollama status (async, fire-and-forget)
  getOllamaStatus()
    .then((ollama) => {
      const modelCount = ollama.models.length;
      const staleCount = ollama.models.filter((m) => m.stale).length;
      if (ollama.disabled) {
        const source = process.env.DISABLE_LOCAL_MODELS === '1' ? 'env' : 'config';
        console.error(`\x1b[33m[INFO] Ollama: disabled (${source}) | ${modelCount} model(s)${staleCount ? ` (${staleCount} stale)` : ''}\x1b[0m`);
      } else if (!ollama.online) {
        console.error(`\x1b[33m[INFO] Ollama: offline (${ollama.url})\x1b[0m`);
      } else {
        const running = ollama.runningModel ? `active: ${ollama.runningModel}` : 'idle';
        const staleInfo = staleCount ? ` | \x1b[33m${staleCount} stale\x1b[32m` : '';
        console.error(
          `\x1b[32m[INFO] Ollama: online (${ollama.url}) | default: ${ollama.defaultModel} | ${running} | ${modelCount} model(s)${staleInfo}\x1b[0m`,
        );
      }
    })
    .catch(() => {
      console.error('\x1b[33m[INFO] Ollama: status check failed\x1b[0m');
    });
}

/**
 * Filter provider list to exclude those in cooldown.
 */
export function filterAvailableProviders<T extends AiProviderId>(providers: T[]): T[] {
  return providers.filter((p) => {
    if (isInCooldown(p)) return false;
    const avail = getProviderAvailability(`${p}_api`);
    if (avail.status === 'unavailable') return false;
    return true;
  });
}

// ── CLI Provider Version Info ───────────────────────────────────────

export interface CliVersionInfo {
  provider: string;
  installed: string | null;
  latest: string | null;
  upToDate: boolean | null; // null if either version unknown
  updateCommand: string;
}

const CLI_VERSION_COMMANDS: Record<string, string> = {
  codex: 'codex --version',
  gemini: 'gemini --version',
  ollama: 'ollama --version',
};

const NPM_PACKAGES: Record<string, string> = {
  codex: '@openai/codex',
  claude: '@anthropic-ai/claude-code',
  gemini: '@google/gemini-cli',
};

const UPDATE_COMMANDS: Record<string, string> = {
  codex: 'npm update -g @openai/codex',
  claude: 'npm update -g @anthropic-ai/claude-code',
  gemini: 'npm update -g @google/gemini-cli',
  ollama: 'ollama pull <model>',
};

async function getInstalledVersion(provider: string): Promise<string | null> {
  // For providers that block nested sessions (claude), use npm ls instead of --version
  const npmPkg = NPM_PACKAGES[provider];
  if (npmPkg && !CLI_VERSION_COMMANDS[provider]) {
    return getInstalledNpmVersion(npmPkg);
  }
  const cmd = CLI_VERSION_COMMANDS[provider];
  if (!cmd) return null;
  try {
    const { stdout } = await execAsync(cmd, { timeout: 15000, maxBuffer: 1024 });
    const out = stdout.trim();
    // Parse various formats: "0.31.0", "codex-cli 0.105.0", "ollama version is 0.17.4"
    const m = out.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
    return m ? m[1] : out;
  } catch {
    // Fallback to npm ls if --version fails
    if (npmPkg) return getInstalledNpmVersion(npmPkg);
    return null;
  }
}

async function getInstalledNpmVersion(pkg: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`npm ls -g ${pkg} --depth=0`, { timeout: 30000, maxBuffer: 2048 });
    const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const m = stdout.match(new RegExp(`${escapedPkg}@(\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?)`));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function getLatestNpmVersion(pkg: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`npm view ${pkg} version`, { timeout: 30000, maxBuffer: 1024 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get latest Ollama version via winget show.
 */
async function getOllamaLatestVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('winget show Ollama.Ollama --accept-source-agreements', {
      timeout: 30_000,
      maxBuffer: 4096,
    });
    const m = stdout.match(/Version\s*:\s*(\d+\.\d+\.\d+(?:-[\w.]+)?)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Get version info for all CLI providers (installed vs latest).
 */
export async function getCliVersions(): Promise<CliVersionInfo[]> {
  const providers = ['codex', 'claude', 'gemini', 'ollama'];
  const results = await Promise.all(
    providers.map(async (p) => {
      const installed = await getInstalledVersion(p);
      let latest: string | null = null;
      if (NPM_PACKAGES[p]) {
        latest = await getLatestNpmVersion(NPM_PACKAGES[p]);
      } else if (p === 'ollama') {
        latest = await getOllamaLatestVersion();
      }
      let upToDate: boolean | null = null;
      if (installed && latest) {
        upToDate = installed === latest;
      }
      return {
        provider: p,
        installed,
        latest,
        upToDate,
        updateCommand: UPDATE_COMMANDS[p] || '',
      };
    }),
  );
  return results;
}

// ── Ollama Model Update ─────────────────────────────────────────────

export interface OllamaUpdateProgress {
  model: string;
  status: string;
  percent: number;
  done: boolean;
  error?: string;
}

/**
 * Pull (update) an Ollama model with streaming progress callback.
 */
export async function pullOllamaModel(
  modelName: string,
  onProgress: (p: OllamaUpdateProgress) => void,
): Promise<boolean> {
  const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
  try {
    const resp = await fetch(`${ollamaUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });
    if (!resp.ok || !resp.body) {
      onProgress({ model: modelName, status: `HTTP ${resp.status}`, percent: 0, done: true, error: `HTTP ${resp.status}` });
      return false;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastPercent = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line) as {
            status?: string;
            completed?: number;
            total?: number;
            error?: string;
          };
          if (data.error) {
            onProgress({ model: modelName, status: data.error, percent: lastPercent, done: true, error: data.error });
            return false;
          }
          let percent = lastPercent;
          if (data.total && data.total > 0 && data.completed != null) {
            percent = Math.round((data.completed / data.total) * 100);
            lastPercent = percent;
          }
          onProgress({
            model: modelName,
            status: data.status ?? '',
            percent,
            done: false,
          });
        } catch {
          /* malformed JSON line — skip */
        }
      }
    }
    onProgress({ model: modelName, status: 'done', percent: 100, done: true });
    return true;
  } catch (e) {
    const errMsg = (e as Error)?.message ?? String(e);
    onProgress({ model: modelName, status: errMsg, percent: 0, done: true, error: errMsg });
    return false;
  }
}

// ── Ollama Model Upgrade Detection ──────────────────────────────────

export interface ParsedModelName {
  raw: string;            // original full name e.g. "llama3.1:8b"
  family: string;         // e.g. "llama"
  version: string | null; // e.g. "3.1"
  tag: string;            // e.g. "8b" or "latest"
}

export function parseOllamaModelName(fullName: string): ParsedModelName {
  const [name, ...tagParts] = fullName.split(':');
  const tag = tagParts.join(':') || 'latest';
  // Extract version from end of name: llama3.1 → family="llama", version="3.1"
  const m = name.match(/^(.+?)(\d+(?:\.\d+)*)$/);
  if (m) {
    return { raw: fullName, family: m[1], version: m[2], tag };
  }
  return { raw: fullName, family: name, version: null, tag };
}

export function getNextVersionCandidates(version: string): string[] {
  const candidates: string[] = [];
  const parts = version.split('.');
  if (parts.length >= 2) {
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    // Try incrementing minor: 3.1 → 3.2, 3.3, ..., 3.9
    for (let m = minor + 1; m <= minor + 8 && m <= 99; m++) {
      candidates.push(`${major}.${m}`);
    }
    // Try next major with minor 0
    candidates.push(`${major + 1}`);
  } else {
    const num = parseInt(parts[0], 10);
    for (let n = num + 1; n <= num + 5; n++) {
      candidates.push(`${n}`);
    }
  }
  return candidates;
}

export async function checkOllamaModelInRegistry(model: string, tag: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(`https://registry.ollama.ai/v2/library/${model}/manifests/${tag}`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}

export interface ModelUpgradeInfo {
  current: string;        // e.g. "llama3.1:8b"
  upgrade: string;        // e.g. "llama3.3:8b"
  family: string;
  currentVersion: string;
  newVersion: string;
}

function getBaseParamTag(tag: string): string {
  const m = tag.match(/^(\d+b)/i);
  return m ? m[1] : tag;
}

/**
 * Generate nearby param size tags within ±15% tolerance.
 * E.g. 13b → [11b..15b], 8b → [7b..9b]
 */
function getNearbyParamTags(baseTag: string): string[] {
  const m = baseTag.match(/^(\d+)b$/i);
  if (!m) return [baseTag];
  const size = parseInt(m[1], 10);
  const tolerance = config.ollamaUpgradeTolerance ?? 0.15;
  const lo = Math.max(1, Math.floor(size * (1 - tolerance)));
  const hi = Math.ceil(size * (1 + tolerance));
  const tags: string[] = [];
  for (let s = hi; s >= lo; s--) {
    tags.push(`${s}b`);
  }
  return tags;
}

export async function findOllamaModelUpgrades(
  onProgress?: (model: string, status: string) => void,
): Promise<ModelUpgradeInfo[]> {
  const ollama = await getOllamaStatus();
  if (!ollama.online || ollama.models.length === 0) return [];

  const upgrades: ModelUpgradeInfo[] = [];

  for (const model of ollama.models) {
    const parsed = parseOllamaModelName(model.name);
    if (!parsed.version) continue; // Can't determine version, skip

    onProgress?.(model.name, 'checking for newer version...');

    const candidates = getNextVersionCandidates(parsed.version);
    let bestUpgrade: string | null = null;
    let bestVersion: string | null = null;

    const baseTag = getBaseParamTag(parsed.tag);
    // Tags to try: exact first, then base param tag, then nearby sizes (±10%)
    const nearbyTags = getNearbyParamTags(baseTag).filter((t) => t !== baseTag);
    const tagsToTry = parsed.tag !== baseTag
      ? [parsed.tag, baseTag, ...nearbyTags]
      : [parsed.tag, ...nearbyTags];

    // Check candidates from highest to lowest (reverse), take the first one that exists
    for (const candidateVer of candidates.reverse()) {
      const candidateModel = `${parsed.family}${candidateVer}`;
      let foundTag: string | null = null;
      for (const tryTag of tagsToTry) {
        const exists = await checkOllamaModelInRegistry(candidateModel, tryTag);
        if (exists) {
          foundTag = tryTag;
          break;
        }
      }
      if (foundTag) {
        bestUpgrade = `${candidateModel}:${foundTag}`;
        bestVersion = candidateVer;
        break; // Found highest available version
      }
    }

    if (bestUpgrade && bestVersion) {
      onProgress?.(model.name, `\u2192 ${bestUpgrade}`);
      upgrades.push({
        current: model.name,
        upgrade: bestUpgrade,
        family: parsed.family,
        currentVersion: parsed.version,
        newVersion: bestVersion,
      });
    } else {
      onProgress?.(model.name, 'latest version');
    }
  }

  return upgrades;
}

/**
 * Update all installed Ollama models with progress, then check for version upgrades.
 */
export async function updateAllOllamaModels(
  onProgress: (overall: number, model: string, modelPercent: number, status: string) => void,
): Promise<{ updated: string[]; failed: string[]; upgrades: ModelUpgradeInfo[] }> {
  const ollama = await getOllamaStatus();
  if (!ollama.online) throw new Error('Ollama is offline');
  const models = ollama.models.map((m) => m.name);
  if (models.length === 0) throw new Error('No models installed');

  const updated: string[] = [];
  const failed: string[] = [];

  // Step 1: Pull (re-download) existing models to get latest layers
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const basePercent = Math.round((i / models.length) * 100);
    onProgress(basePercent, model, 0, 'pulling latest');

    const ok = await pullOllamaModel(model, (p) => {
      const overall = Math.round(((i + p.percent / 100) / models.length) * 100);
      onProgress(overall, model, p.percent, p.status);
    });

    if (ok) {
      updated.push(model);
    } else {
      failed.push(model);
    }
  }
  onProgress(100, '', 100, 'checking for version upgrades...');

  // Step 2: Check for version upgrades
  const upgrades = await findOllamaModelUpgrades((model, status) => {
    onProgress(100, model, 0, status);
  });

  // Step 3: Pull upgrade models
  if (upgrades.length > 0) {
    for (let i = 0; i < upgrades.length; i++) {
      const u = upgrades[i];
      const ok = await pullOllamaModel(u.upgrade, (p) => {
        const upgradeOverall = Math.round(((i + p.percent / 100) / upgrades.length) * 100);
        onProgress(upgradeOverall, `\u2191 ${u.current} \u2192 ${u.upgrade}`, p.percent, p.status);
      });
      if (ok) {
        // Delete old model after successful upgrade
        const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
        try {
          await fetch(`${ollamaUrl}/api/delete`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: u.current }),
          });
        } catch {
          /* old model deletion is best-effort */
        }
      } else {
        upgrades.splice(i, 1);
        i--;
      }
    }
  }

  onProgress(100, '', 100, 'complete');
  return { updated, failed, upgrades };
}
