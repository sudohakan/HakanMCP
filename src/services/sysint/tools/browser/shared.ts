/**
 * Shared utilities for browser sub-modules.
 * Centralizes profile discovery, DB temp-copy, and timestamp conversion.
 */
import { copyFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';

export { buildSuccess, buildError } from '../../outputFormatter.js';
export { getPlatformName } from '../../platforms/index.js';
export type { SysIntResult, SysIntPlatform } from '../../outputFormatter.js';

export type BrowserName = 'chrome' | 'edge' | 'firefox';

export interface ProfileInfo {
  browser: BrowserName;
  name: string;
  path: string;
  isDefault: boolean;
}

// ── Platform path helpers ────────────────────────────────────────────────────

function windowsLocalAppData(): string {
  return process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
}

function windowsAppData(): string {
  return process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
}

/** Base directories where Chrome/Edge store their "User Data" folder. */
function chromiumBasePath(browser: 'chrome' | 'edge'): string {
  const platform = process.platform;
  if (platform === 'win32') {
    const base = windowsLocalAppData();
    return browser === 'chrome'
      ? join(base, 'Google', 'Chrome', 'User Data')
      : join(base, 'Microsoft', 'Edge', 'User Data');
  }
  // Linux / WSL calling Linux paths
  const home = homedir();
  return browser === 'chrome'
    ? join(home, '.config', 'google-chrome')
    : join(home, '.config', 'microsoft-edge');
}

/** Base directory where Firefox stores profiles. */
function firefoxBasePath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return join(windowsAppData(), 'Mozilla', 'Firefox', 'Profiles');
  }
  return join(homedir(), '.mozilla', 'firefox');
}

// ── Profile discovery ────────────────────────────────────────────────────────

/** List browser profiles. Returns empty array if browser not installed. */
export async function findBrowserProfiles(browser: BrowserName): Promise<ProfileInfo[]> {
  try {
    if (browser === 'firefox') {
      return await findFirefoxProfiles();
    }
    return await findChromiumProfiles(browser);
  } catch {
    return [];
  }
}

async function findChromiumProfiles(browser: 'chrome' | 'edge'): Promise<ProfileInfo[]> {
  const base = chromiumBasePath(browser);
  if (!existsSync(base)) return [];

  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return [];
  }

  const profiles: ProfileInfo[] = [];
  for (const entry of entries) {
    const fullPath = join(base, entry);
    // Default profile or Profile N directories
    if (entry === 'Default' || /^Profile \d+$/.test(entry)) {
      try {
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          profiles.push({
            browser,
            name: entry,
            path: fullPath,
            isDefault: entry === 'Default',
          });
        }
      } catch {
        // skip unreadable entries
      }
    }
  }

  return profiles;
}

async function findFirefoxProfiles(): Promise<ProfileInfo[]> {
  const base = firefoxBasePath();
  if (!existsSync(base)) return [];

  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return [];
  }

  const profiles: ProfileInfo[] = [];
  for (const entry of entries) {
    const fullPath = join(base, entry);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        profiles.push({
          browser: 'firefox',
          name: entry,
          path: fullPath,
          isDefault: entry.endsWith('.default') || entry.endsWith('.default-release'),
        });
      }
    } catch {
      // skip
    }
  }

  return profiles;
}

/** Get all profiles for all browsers. */
export async function findAllProfiles(): Promise<ProfileInfo[]> {
  const [chrome, edge, firefox] = await Promise.all([
    findBrowserProfiles('chrome'),
    findBrowserProfiles('edge'),
    findBrowserProfiles('firefox'),
  ]);
  return [...chrome, ...edge, ...firefox];
}

/** Get the first (default) profile for a browser. Returns null if not installed. */
export async function getDefaultProfile(browser: BrowserName): Promise<ProfileInfo | null> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return null;
  return profiles.find((p) => p.isDefault) ?? profiles[0] ?? null;
}

// ── DB temp-copy (WAL lock safety) ──────────────────────────────────────────

export interface TempDb {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Copy a SQLite database (+ -wal, -shm) to a temp directory.
 * This avoids issues when the browser holds a WAL lock on the original file.
 * Returns the temp path and a cleanup function.
 */
export async function copyDbToTemp(srcPath: string): Promise<TempDb> {
  const tempDir = join(tmpdir(), `sysint-browser-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });

  const destPath = join(tempDir, basename(srcPath));

  // Copy main db
  await copyFile(srcPath, destPath);

  // Copy WAL and SHM files if they exist (best-effort)
  for (const suffix of ['-wal', '-shm']) {
    const walSrc = `${srcPath}${suffix}`;
    if (existsSync(walSrc)) {
      await copyFile(walSrc, `${destPath}${suffix}`).catch(() => {});
    }
  }

  return {
    path: destPath,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

// ── Timestamp conversion ─────────────────────────────────────────────────────

/**
 * Convert Chrome/Edge WebKit microsecond timestamp to ISO string.
 * WebKit epoch: 1601-01-01T00:00:00Z
 * Formula: subtract 11644473600 seconds (difference between WebKit and Unix epochs), then convert microseconds to ms.
 */
export function webkitToIso(webkitMicros: number): string {
  if (!webkitMicros || webkitMicros === 0) return '';
  const unixMs = Math.floor(webkitMicros / 1000) - 11644473600000;
  return new Date(unixMs).toISOString();
}

/**
 * Convert Firefox microsecond timestamp (since Unix epoch) to ISO string.
 */
export function firefoxMicrosToIso(micros: number): string {
  if (!micros || micros === 0) return '';
  return new Date(Math.floor(micros / 1000)).toISOString();
}

/**
 * Convert Unix seconds timestamp to ISO string.
 */
export function unixSecondsToIso(seconds: number): string {
  if (!seconds || seconds === 0) return '';
  return new Date(seconds * 1000).toISOString();
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Get path to a Chrome/Edge SQLite DB file within a profile. */
export function chromiumDbPath(profilePath: string, dbName: string): string {
  return join(profilePath, dbName);
}

/** Get path to a Firefox SQLite DB file within a profile. */
export function firefoxDbPath(profilePath: string, dbName: string): string {
  return join(profilePath, dbName);
}

/** Parse --browser arg from args array. Returns array of browsers to query. */
export function parseBrowserArg(args: string[]): BrowserName[] {
  const idx = args.indexOf('--browser');
  if (idx === -1) return ['chrome', 'edge', 'firefox'];
  const val = args[idx + 1] ?? 'all';
  if (val === 'all') return ['chrome', 'edge', 'firefox'];
  if (val === 'chrome' || val === 'edge' || val === 'firefox') return [val];
  return ['chrome', 'edge', 'firefox'];
}

/** Parse --limit arg from args array. Returns numeric limit (default 100). */
export function parseLimitArg(args: string[], defaultLimit = 100): number {
  const idx = args.indexOf('--limit');
  if (idx === -1) return defaultLimit;
  const val = parseInt(args[idx + 1] ?? '', 10);
  return isNaN(val) || val <= 0 ? defaultLimit : val;
}
