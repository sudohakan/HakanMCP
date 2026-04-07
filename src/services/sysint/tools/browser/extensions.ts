/**
 * BRW-05: browser-extensions — Extension/addon listing for Chrome, Edge, and Firefox.
 * Chrome/Edge: parse manifest.json from Extensions directory + Preferences for enabled state.
 * Firefox: parse extensions.json from profile root.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  findBrowserProfiles,
  parseBrowserArg,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';
import type { BrowserName } from './shared.js';

export interface ExtensionRow {
  browser: string;
  profile: string;
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  permissions: string[];
  description: string;
}

// ── Chrome / Edge ────────────────────────────────────────────────────────────

interface ChromeManifest {
  name?: string;
  version?: string;
  description?: string;
  permissions?: unknown[];
}

interface ChromePreferences {
  extensions?: {
    settings?: Record<string, { state?: number; manifest?: ChromeManifest }>;
  };
}

/**
 * Parse a single extension manifest.json into a partial ExtensionRow.
 */
export function parseChromiumManifest(
  raw: string,
  id: string,
  browser: string,
  profile: string,
  enabled = true,
): ExtensionRow | null {
  let manifest: ChromeManifest;
  try {
    manifest = JSON.parse(raw) as ChromeManifest;
  } catch {
    return null;
  }

  const permissions = (manifest.permissions ?? [])
    .filter((p): p is string => typeof p === 'string');

  return {
    browser,
    profile,
    id,
    name: String(manifest.name ?? id),
    version: String(manifest.version ?? ''),
    enabled,
    permissions,
    description: String(manifest.description ?? ''),
  };
}

async function queryChromiumExtensions(browser: BrowserName): Promise<ExtensionRow[]> {
  const profiles = await findBrowserProfiles(browser);
  if (!profiles.length) return [];

  const allRows: ExtensionRow[] = [];

  for (const profile of profiles) {
    const extensionsDir = join(profile.path, 'Extensions');
    if (!existsSync(extensionsDir)) continue;

    // Load Preferences for enabled state
    let enabledMap: Record<string, boolean> = {};
    const prefsPath = join(profile.path, 'Preferences');
    if (existsSync(prefsPath)) {
      try {
        const prefsRaw = await readFile(prefsPath, 'utf8');
        const prefs = JSON.parse(prefsRaw) as ChromePreferences;
        const settings = prefs?.extensions?.settings ?? {};
        for (const [extId, extData] of Object.entries(settings)) {
          // state: 1 = enabled, 0 = disabled
          enabledMap[extId] = (extData?.state ?? 1) === 1;
        }
      } catch {
        // ignore prefs parse failure
      }
    }

    // Enumerate extension directories
    let extIds: string[];
    try {
      extIds = await readdir(extensionsDir);
    } catch {
      continue;
    }

    for (const extId of extIds) {
      const extDir = join(extensionsDir, extId);
      let extStat;
      try {
        extStat = await stat(extDir);
      } catch {
        continue;
      }
      if (!extStat.isDirectory()) continue;

      // Find the latest version subdirectory
      let versionDirs: string[];
      try {
        versionDirs = await readdir(extDir);
      } catch {
        continue;
      }

      // Pick the highest version string directory
      const versionDir = versionDirs
        .filter((d) => /^\d+/.test(d))
        .sort()
        .reverse()[0];

      if (!versionDir) continue;

      const manifestPath = join(extDir, versionDir, 'manifest.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const raw = await readFile(manifestPath, 'utf8');
        const enabled = enabledMap[extId] ?? true;
        const row = parseChromiumManifest(raw, extId, browser, profile.name, enabled);
        if (row) allRows.push(row);
      } catch {
        // Skip unreadable extensions
      }
    }
  }

  return allRows;
}

// ── Firefox ──────────────────────────────────────────────────────────────────

interface FirefoxExtensionEntry {
  id?: string;
  defaultLocale?: { name?: string; description?: string };
  version?: string;
  active?: boolean;
  userPermissions?: { permissions?: string[] };
  optionalPermissions?: { permissions?: string[] };
}

interface FirefoxExtensionsJson {
  addons?: FirefoxExtensionEntry[];
}

export function parseFirefoxExtensionsJson(
  raw: string,
  profile: string,
): ExtensionRow[] {
  let data: FirefoxExtensionsJson;
  try {
    data = JSON.parse(raw) as FirefoxExtensionsJson;
  } catch {
    return [];
  }

  const addons = data.addons ?? [];
  return addons.map((addon) => {
    const permissions = [
      ...(addon.userPermissions?.permissions ?? []),
      ...(addon.optionalPermissions?.permissions ?? []),
    ];
    return {
      browser: 'firefox',
      profile,
      id: String(addon.id ?? ''),
      name: String(addon.defaultLocale?.name ?? addon.id ?? ''),
      version: String(addon.version ?? ''),
      enabled: Boolean(addon.active ?? true),
      permissions,
      description: String(addon.defaultLocale?.description ?? ''),
    };
  });
}

async function queryFirefoxExtensions(): Promise<ExtensionRow[]> {
  const profiles = await findBrowserProfiles('firefox');
  if (!profiles.length) return [];

  const allRows: ExtensionRow[] = [];

  for (const profile of profiles) {
    const extJsonPath = join(profile.path, 'extensions.json');
    if (!existsSync(extJsonPath)) continue;

    try {
      const raw = await readFile(extJsonPath, 'utf8');
      allRows.push(...parseFirefoxExtensionsJson(raw, profile.name));
    } catch {
      // Skip
    }
  }

  return allRows;
}

// ── Run dispatcher ───────────────────────────────────────────────────────────

async function runBrowserExtensions(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const browsers = parseBrowserArg(args);

  try {
    const queries: Promise<ExtensionRow[]>[] = [];
    for (const browser of browsers) {
      if (browser === 'firefox') {
        queries.push(queryFirefoxExtensions());
      } else {
        queries.push(queryChromiumExtensions(browser));
      }
    }

    const results = await Promise.all(queries);
    const rows = results.flat();

    return buildSuccess(rows, 'browser-extensions', platform);
  } catch (err) {
    return buildError(`browser-extensions failed: ${String(err)}`, 'EXEC_FAILED', 'browser-extensions');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-extensions': runBrowserExtensions,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
