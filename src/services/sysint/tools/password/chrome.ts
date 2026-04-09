/**
 * PWD-01: browser-chrome-passwords — Extract Chromium-based browser saved passwords.
 *
 * Known browsers: Chrome, Edge, Opera, Brave, Vivaldi, Chromium, Yandex.
 * Auto-discovers unknown Chromium-based browsers by scanning AppData for
 * directories containing both `Local State` (with os_crypt) and `Login Data`.
 *
 * Decryption: Single PowerShell call decrypts all DPAPI master keys at once
 * (stdout JSON, no temp files). AES-256-GCM decrypt in TypeScript.
 *
 * Windows/WSL only. Returns PLATFORM_UNSUPPORTED on Linux.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { readdir, copyFile, mkdir, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createDecipheriv } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  assertWindowsOnly,
  checkCredentialConsent,
  logCredentialAccess,
  execPs,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChromePasswordRow {
  browser: string;
  profile: string;
  url: string;
  username: string;
  password: string;
  _sensitive: boolean;
}

interface LoginDataRow {
  origin_url: string;
  username_value: string;
  password_value: Buffer | null;
}

interface DiscoveredBrowser {
  name: string;
  userDataPath: string;
  localStatePath: string;
}

// ── Platform helpers ─────────────────────────────────────────────────────────

const isWsl = (): boolean => process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];

function getWinUser(): string {
  return process.env['WIN_USERNAME']
    ?? process.env['LOGNAME']
    ?? process.env['USER']
    ?? 'Hakan';
}

function toWinPath(p: string): string {
  const match = p.match(/^\/mnt\/([a-z])\/(.*)/);
  if (match) return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
  return p;
}

function getSharedTempDir(): string {
  if (isWsl()) return `/mnt/c/Users/${getWinUser()}/AppData/Local/Temp`;
  return require('node:os').tmpdir();
}

// ── Known browser definitions ────────────────────────────────────────────────

interface BrowserHint {
  name: string;
  /** Path segments under LocalAppData */
  localAppData?: string[];
  /** Path segments under RoamingAppData */
  roamingAppData?: string[];
}

const KNOWN_BROWSERS: BrowserHint[] = [
  { name: 'chrome', localAppData: ['Google', 'Chrome', 'User Data'] },
  { name: 'edge', localAppData: ['Microsoft', 'Edge', 'User Data'] },
  { name: 'opera', roamingAppData: ['Opera Software', 'Opera Stable'] },
  { name: 'opera-gx', roamingAppData: ['Opera Software', 'Opera GX Stable'] },
  { name: 'brave', localAppData: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
  { name: 'vivaldi', localAppData: ['Vivaldi', 'User Data'] },
  { name: 'chromium', localAppData: ['Chromium', 'User Data'] },
  { name: 'yandex', localAppData: ['Yandex', 'YandexBrowser', 'User Data'] },
  { name: 'arc', localAppData: ['Arc', 'User Data'] },
  { name: 'thorium', localAppData: ['Thorium', 'User Data'] },
  { name: 'ungoogled-chromium', localAppData: ['Chromium', 'User Data'] },
  { name: 'coccoc', localAppData: ['CocCoc', 'Browser', 'User Data'] },
  { name: 'naver-whale', localAppData: ['Naver', 'Naver Whale', 'User Data'] },
];

// ── Auto-discovery ───────────────────────────────────────────────────────────

function getAppDataPaths(): { local: string; roaming: string } {
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? join(require('node:os').homedir(), 'AppData', 'Local');
    const roaming = process.env['APPDATA'] ?? join(require('node:os').homedir(), 'AppData', 'Roaming');
    return { local, roaming };
  }
  if (isWsl()) {
    const user = getWinUser();
    return {
      local: `/mnt/c/Users/${user}/AppData/Local`,
      roaming: `/mnt/c/Users/${user}/AppData/Roaming`,
    };
  }
  return { local: '', roaming: '' };
}

/**
 * Check if a directory looks like a Chromium user data directory.
 * Must contain `Local State` with os_crypt key and at least one profile with `Login Data`.
 */
function isChromiumUserData(dirPath: string): boolean {
  const localState = join(dirPath, 'Local State');
  if (!existsSync(localState)) return false;
  try {
    const content = JSON.parse(readFileSync(localState, 'utf8'));
    if (!content?.os_crypt?.encrypted_key) return false;
  } catch {
    return false;
  }
  const defaultLogin = join(dirPath, 'Default', 'Login Data');
  return existsSync(defaultLogin);
}

/**
 * Check if a directory is an Opera-style browser (no "User Data" subdirectory,
 * Local State and Default/Login Data are directly in the dir or profiles are flat).
 */
function isOperaStyleData(dirPath: string): boolean {
  const localState = join(dirPath, 'Local State');
  const loginData = join(dirPath, 'Login Data');
  if (!existsSync(localState)) return false;
  try {
    const content = JSON.parse(readFileSync(localState, 'utf8'));
    if (!content?.os_crypt?.encrypted_key) return false;
  } catch {
    return false;
  }
  return existsSync(loginData);
}

/**
 * Discover all Chromium-based browsers by:
 * 1. Checking known browser paths
 * 2. Scanning AppData directories for unknown Chromium browsers
 */
function discoverBrowsers(): DiscoveredBrowser[] {
  const { local, roaming } = getAppDataPaths();
  if (!local && !roaming) return [];

  const found = new Map<string, DiscoveredBrowser>();

  // Phase 1: Check known browsers
  for (const hint of KNOWN_BROWSERS) {
    let userDataPath = '';
    if (hint.roamingAppData && roaming) {
      userDataPath = join(roaming, ...hint.roamingAppData);
    } else if (hint.localAppData && local) {
      userDataPath = join(local, ...hint.localAppData);
    }
    if (!userDataPath) continue;

    // Opera-style: userDataPath IS the profile directory (no User Data subdir)
    if (hint.roamingAppData && isOperaStyleData(userDataPath)) {
      found.set(userDataPath, {
        name: hint.name,
        userDataPath,
        localStatePath: join(userDataPath, 'Local State'),
      });
    } else if (isChromiumUserData(userDataPath)) {
      found.set(userDataPath, {
        name: hint.name,
        userDataPath,
        localStatePath: join(userDataPath, 'Local State'),
      });
    }
  }

  // Phase 2: Scan for unknown browsers
  const scanDirs = [local, roaming].filter(Boolean);
  for (const appDataDir of scanDirs) {
    let topLevel: string[];
    try {
      topLevel = readdirSync(appDataDir);
    } catch {
      continue;
    }

    for (const vendor of topLevel) {
      const vendorPath = join(appDataDir, vendor);
      try {
        if (!statSync(vendorPath).isDirectory()) continue;
      } catch {
        continue;
      }

      // Check direct: vendor/User Data pattern
      const userDataPath = join(vendorPath, 'User Data');
      if (!found.has(userDataPath) && isChromiumUserData(userDataPath)) {
        found.set(userDataPath, {
          name: vendor.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          userDataPath,
          localStatePath: join(userDataPath, 'Local State'),
        });
      }

      // Check nested: vendor/Product/User Data pattern (e.g., BraveSoftware/Brave-Browser/User Data)
      let subDirs: string[];
      try {
        subDirs = readdirSync(vendorPath);
      } catch {
        continue;
      }
      for (const sub of subDirs) {
        const subUserData = join(vendorPath, sub, 'User Data');
        if (!found.has(subUserData) && isChromiumUserData(subUserData)) {
          found.set(subUserData, {
            name: `${vendor}-${sub}`.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            userDataPath: subUserData,
            localStatePath: join(subUserData, 'Local State'),
          });
        }
      }

      // Check Opera-style: vendor directly has Local State + Login Data
      if (!found.has(vendorPath) && isOperaStyleData(vendorPath)) {
        found.set(vendorPath, {
          name: vendor.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          userDataPath: vendorPath,
          localStatePath: join(vendorPath, 'Local State'),
        });
      }
    }
  }

  return Array.from(found.values());
}

// ── DPAPI batch decryption ───────────────────────────────────────────────────

/**
 * Decrypt all browser master keys in a single PowerShell call.
 * Returns a Map from browser name to decrypted AES-256 key Buffer.
 * Uses stdout JSON — no temp file round-trip.
 */
async function getMasterKeysBatch(browsers: DiscoveredBrowser[]): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  if (browsers.length === 0) return result;

  // Build a PowerShell script that decrypts all Local State keys at once
  const entries = browsers.map((b) => {
    const winPath = toWinPath(b.localStatePath).replace(/'/g, "''");
    const safeName = b.name.replace(/'/g, "''");
    return `  try {
    $ls = Get-Content '${winPath}' -Raw | ConvertFrom-Json
    $enc = [Convert]::FromBase64String($ls.os_crypt.encrypted_key)
    $enc = $enc[5..($enc.Length-1)]
    $key = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $results['${safeName}'] = [Convert]::ToBase64String($key)
  } catch {}`;
  });

  const script = `Add-Type -AssemblyName System.Security
$results = @{}
${entries.join('\n')}
$results | ConvertTo-Json -Compress`;

  try {
    const { stdout } = await execPs(script, 20000);
    if (!stdout.trim()) return result;

    const parsed = JSON.parse(stdout.trim());
    for (const [name, b64] of Object.entries(parsed)) {
      if (typeof b64 === 'string' && b64.length > 0) {
        result.set(name, Buffer.from(b64, 'base64'));
      }
    }
  } catch {
    // If batch fails, try each browser individually as fallback
    for (const browser of browsers) {
      try {
        const key = await getMasterKeySingle(browser.localStatePath);
        if (key) result.set(browser.name, key);
      } catch { /* skip */ }
    }
  }

  return result;
}

/**
 * Fallback: decrypt a single browser's master key via PowerShell.
 */
async function getMasterKeySingle(localStatePath: string): Promise<Buffer | null> {
  const winPath = toWinPath(localStatePath).replace(/'/g, "''");
  const script = `Add-Type -AssemblyName System.Security
$ls = Get-Content '${winPath}' -Raw | ConvertFrom-Json
$enc = [Convert]::FromBase64String($ls.os_crypt.encrypted_key)
$enc = $enc[5..($enc.Length-1)]
$key = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($key)`;

  const { stdout } = await execPs(script, 10000);
  const b64 = stdout.trim();
  if (!b64) return null;
  return Buffer.from(b64, 'base64');
}

// ── AES-256-GCM decryption ───────────────────────────────────────────────────

function decryptAesGcm(encryptedPassword: Buffer, masterKey: Buffer): string {
  const nonce = encryptedPassword.subarray(3, 3 + 12);
  const ciphertextWithTag = encryptedPassword.subarray(3 + 12);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', masterKey, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function decryptPassword(passwordValue: Buffer, masterKey: Buffer | null): string {
  if (!passwordValue || passwordValue.length === 0) return '';

  const prefix = passwordValue.subarray(0, 3).toString('ascii');
  if ((prefix === 'v10' || prefix === 'v11') && masterKey) {
    return decryptAesGcm(passwordValue, masterKey);
  }

  // Legacy DPAPI entries cannot be batch-decrypted from WSL efficiently.
  // Return empty for legacy; v10/v11 without key also returns empty.
  return '';
}

// ── Profile extraction ───────────────────────────────────────────────────────

async function extractBrowserPasswords(
  browser: DiscoveredBrowser,
  masterKey: Buffer | null,
): Promise<ChromePasswordRow[]> {
  if (!existsSync(browser.userDataPath)) return [];

  const rows: ChromePasswordRow[] = [];

  // Determine profile directories
  let profileDirs: string[];
  if (isOperaStyleData(browser.userDataPath)) {
    // Opera-style: Login Data is directly in userDataPath
    profileDirs = ['.'];
  } else {
    try {
      const entries = await readdir(browser.userDataPath);
      profileDirs = entries.filter((d) => d.startsWith('Default') || d.startsWith('Profile'));
    } catch {
      return [];
    }
  }

  for (const dir of profileDirs) {
    const profileBase = dir === '.' ? browser.userDataPath : join(browser.userDataPath, dir);
    const dbPath = join(profileBase, 'Login Data');
    if (!existsSync(dbPath)) continue;

    const tmpDir = join(getSharedTempDir(), `sysint-pwd-${browser.name}-${Date.now()}`);
    try {
      await mkdir(tmpDir, { recursive: true });
      const tmpDb = join(tmpDir, 'Login Data');
      await copyFile(dbPath, tmpDb);
      for (const ext of ['-wal', '-shm']) {
        if (existsSync(dbPath + ext)) {
          await copyFile(dbPath + ext, tmpDb + ext).catch(() => {});
        }
      }

      const db = new Database(tmpDb, { readonly: true, fileMustExist: true });
      try {
        const loginRows = db
          .prepare('SELECT origin_url, username_value, password_value FROM logins ORDER BY origin_url')
          .all() as LoginDataRow[];

        for (const r of loginRows) {
          let password = '';
          if (r.password_value && r.password_value.length > 0) {
            try {
              password = decryptPassword(r.password_value, masterKey);
            } catch {
              password = '<decryption_failed>';
            }
          }
          rows.push({
            browser: browser.name,
            profile: dir === '.' ? 'Default' : dir,
            url: r.origin_url,
            username: r.username_value,
            password,
            _sensitive: true,
          });
        }
      } finally {
        db.close();
      }
    } catch {
      // Skip profile on error
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return rows;
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function runChromePasswords(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOnly('browser-chrome-passwords');
  if (platformGuard) return platformGuard;

  const consentWarning = checkCredentialConsent(args, 'browser-chrome-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'browser-chrome-passwords', getPlatformName());

  logCredentialAccess('browser-chrome-passwords');

  try {
    // Step 1: Auto-discover all Chromium browsers
    const browsers = discoverBrowsers();
    if (browsers.length === 0) {
      return buildSuccess([], 'browser-chrome-passwords', getPlatformName());
    }

    // Step 2: Batch-decrypt all master keys in one PowerShell call
    const masterKeys = await getMasterKeysBatch(browsers);

    // Step 3: Extract passwords using decrypted keys
    const allRows: ChromePasswordRow[] = [];
    for (const browser of browsers) {
      const key = masterKeys.get(browser.name) ?? null;
      const rows = await extractBrowserPasswords(browser, key);
      allRows.push(...rows);
    }

    return buildSuccess(allRows, 'browser-chrome-passwords', getPlatformName());
  } catch (err) {
    return buildError(`browser-chrome-passwords failed: ${String(err)}`, 'EXEC_FAILED', 'browser-chrome-passwords');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-chrome-passwords': runChromePasswords,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
