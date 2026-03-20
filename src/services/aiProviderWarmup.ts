/**
 * AI Provider Warmup Service — pre-warms CLI and API connections at startup.
 * Runs in background when chat starts; caches provider availability for faster first response.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { PROJECT_ROOT } from '../utils/projectRoot.js';
import { resolveProviderApiKey } from '../tools/aiProviders.js';
import { setCooldownsBasePath, setProviderAvailability, checkApiKeyExists } from './aiProviderCooldown.js';
import type { AiProviderId } from './aiProviderCooldown.js';

const execAsync = promisify(exec);

export type ChatProviderId = 'codex' | 'claude' | 'gemini' | 'cursor';

const CLI_PROBE_COMMANDS: Record<ChatProviderId, string> = {
  codex: 'codex --version',
  claude: process.platform === 'win32' ? 'where.exe claude' : 'which claude',
  gemini: process.platform === 'win32' ? 'where.exe gemini' : 'which gemini',
  cursor: process.platform === 'win32' ? 'where.exe agent' : 'which agent',
};

const PROBE_TIMEOUT_MS = 5000;
const API_WARMUP_TIMEOUT_MS = 6000;

export interface WarmupState {
  /** CLI providers that passed probe (available first in order) */
  cliOrder: ChatProviderId[];
  /** API providers with resolved keys (for faster key resolution) */
  apiKeysReady: { codex?: string; claude?: string; gemini?: string };
  /** Whether warmup has completed at least once */
  ready: boolean;
  /** Timestamp when warmup completed */
  completedAt?: number;
}

const state: WarmupState = {
  cliOrder: ['codex', 'claude', 'gemini', 'cursor'],
  apiKeysReady: {},
  ready: false,
};

/** Last successful provider (in-memory + disk for cross-session) */
let lastSuccessProvider: ChatProviderId | null = null;

/**
 * Probe a single CLI with short timeout.
 */
async function probeCli(provider: ChatProviderId): Promise<boolean> {
  const cmd = CLI_PROBE_COMMANDS[provider];
  try {
    await execAsync(cmd, {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 1024,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe all CLIs in parallel and build availability order.
 */
async function probeAllClis(): Promise<ChatProviderId[]> {
  const results = await Promise.all(
    (['codex', 'claude', 'gemini', 'cursor'] as ChatProviderId[]).map(async (p) => ({
      provider: p,
      available: await probeCli(p),
    })),
  );

  for (const r of results) {
    setProviderAvailability(
      `${r.provider}_cli`,
      r.available ? 'available' : 'unavailable',
      r.available ? 'CLI found' : 'CLI not found',
    );
  }

  const available = results.filter((r) => r.available).map((r) => r.provider);
  const unavailable = results.filter((r) => !r.available).map((r) => r.provider);
  return [...available, ...unavailable];
}

/**
 * Pre-resolve API keys (including decrypt). Caches for getPreferredLLMResponse.
 */
function resolveApiKeys(): void {
  const codex = resolveProviderApiKey(
    'Codex',
    ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    config.aiProviders?.codexKeyEncrypted,
  );
  const claude = resolveProviderApiKey(
    'Claude Code',
    ['CLAUDE_CODE_API_KEY', 'ANTHROPIC_API_KEY'],
    config.aiProviders?.claudeKeyEncrypted,
  );
  const gemini = resolveProviderApiKey(
    'Gemini',
    ['GEMINI_API_KEY'],
    config.aiProviders?.geminiKeyEncrypted,
  );
  state.apiKeysReady = {
    codex: codex.key,
    claude: claude.key,
    gemini: gemini.key,
  };

  for (const provider of ['codex', 'claude', 'gemini'] as AiProviderId[]) {
    const check = checkApiKeyExists(provider);
    setProviderAvailability(
      `${provider}_api`,
      check.found ? 'available' : 'unavailable',
      check.source,
    );
  }
}

/**
 * Fire-and-forget API connection warmup (GET to establish TCP+TLS).
 * Uses models/list or similar cheap endpoint. Does not consume completion quota.
 */
function warmApiConnections(): void {
  const warm = async (url: string, headers?: Record<string, string>): Promise<void> => {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), API_WARMUP_TIMEOUT_MS);
    try {
      await fetch(url, {
        method: 'GET',
        headers: headers ?? {},
        signal: controller.signal,
      });
    } catch { /* empty */
    } finally {
      clearTimeout(to);
    }
  };

  if (state.apiKeysReady.codex) {
    const base =
      process.env.CODEX_BASE_URL?.replace(/\/chat\/completions.*$/, '') ||
      'https://api.openai.com/v1';
    const modelsUrl = base.endsWith('/v1') ? `${base}/models` : `${base}/models`;
    warm(modelsUrl, {
      Authorization: `Bearer ${state.apiKeysReady.codex}`,
    }).catch(() => {});
  }
  if (state.apiKeysReady.claude) {
    const base =
      process.env.CLAUDE_BASE_URL?.replace(/\/v1\/messages.*$/, '') || 'https://api.anthropic.com';
    warm(base, {}).catch(() => {});
  }
  if (state.apiKeysReady.gemini) {
    const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${base.replace(/\/models.*$/, '')}/models?key=${encodeURIComponent(state.apiKeysReady.gemini)}`;
    warm(url, {}).catch(() => {});
  }
}

/**
 * Run full warmup: CLI probe + API key resolution + optional API connection warm.
 * Non-blocking; safe to call and not await.
 */
export function startWarmup(basePath?: string, force?: boolean): void {
  if (!force && state.ready && state.completedAt && Date.now() - state.completedAt < 60_000) {
    return;
  }
  runWarmup(basePath).catch(() => {});
}

/**
 * Awaitable version of warmup — use when you need probes to finish before reading status.
 */
export async function runWarmupAsync(basePath?: string): Promise<void> {
  await runWarmup(basePath);
}

async function runWarmup(basePath?: string): Promise<void> {
  if (basePath) setCooldownsBasePath(basePath);
  try {
    lastSuccessProvider = loadLastSuccessFromDisk();
    resolveApiKeys();
    state.cliOrder = await probeAllClis();
    if (state.apiKeysReady.codex || state.apiKeysReady.claude || state.apiKeysReady.gemini) {
      warmApiConnections();
    }
    state.ready = true;
    state.completedAt = Date.now();
  } catch {
    /* non-fatal */
  }
}

/**
 * Get cached CLI order (available providers first). Falls back to default if not warmed.
 */
export function getWarmedCliOrder(fallback: ChatProviderId[]): ChatProviderId[] {
  if (!state.ready) return fallback;
  if (lastSuccessProvider && state.cliOrder.includes(lastSuccessProvider)) {
    const rest = state.cliOrder.filter((p) => p !== lastSuccessProvider);
    return [lastSuccessProvider, ...rest];
  }
  return state.cliOrder;
}

/**
 * Get pre-resolved API key for provider. Returns undefined if not resolved.
 */
export function getWarmedApiKey(provider: 'codex' | 'claude' | 'gemini'): string | undefined {
  return state.apiKeysReady[provider];
}

/**
 * Record last successful provider for faster next request.
 */
export function recordLastSuccess(provider: ChatProviderId): void {
  lastSuccessProvider = provider;
}

/**
 * Persist last success to file for cross-session reuse (optional).
 */
const LAST_SUCCESS_PATH = path.join(
  PROJECT_ROOT,
  '.ai-provider-last-success.json',
);

export function loadLastSuccessFromDisk(): ChatProviderId | null {
  try {
    const p = LAST_SUCCESS_PATH;
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw) as { provider?: string; at?: number };
      const provider = data?.provider as ChatProviderId | undefined;
      if (provider && ['codex', 'claude', 'gemini', 'cursor'].includes(provider)) {
        const age = Date.now() - (data.at ?? 0);
        if (age < 24 * 60 * 60 * 1000) return provider;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveLastSuccessToDisk(provider: ChatProviderId): void {
  try {
    const dir = path.dirname(LAST_SUCCESS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      LAST_SUCCESS_PATH,
      JSON.stringify({ provider, at: Date.now() }, null, 0),
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

/**
 * Whether warmup has completed (for callers that want to know).
 */
export function isWarmupReady(): boolean {
  return state.ready;
}
