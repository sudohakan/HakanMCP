/**
 * PWD-01: browser-chrome-passwords — Extract Chrome saved passwords via DPAPI.
 * Windows-only. Returns PLATFORM_UNSUPPORTED on Linux.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  assertWindowsOnly,
  checkCredentialConsent,
  logCredentialAccess,
  writeTempSecure,
  execPs,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

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

function chromiumBasePath(browser: 'chrome' | 'edge'): string {
  if (process.platform === 'win32') {
    const base = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    return browser === 'chrome'
      ? join(base, 'Google', 'Chrome', 'User Data')
      : join(base, 'Microsoft', 'Edge', 'User Data');
  }
  // WSL: attempt Windows paths via wslpath
  return '';
}

/** Decrypt DPAPI-encrypted bytes via PowerShell ProtectedData. */
async function decryptDpapi(encryptedBytes: Buffer): Promise<string> {
  const tempIn = writeTempSecure(encryptedBytes);
  const tempOut = writeTempSecure('');

  const script = `
$bytes = [System.IO.File]::ReadAllBytes('${tempIn.path.replace(/\\/g, '\\\\')}')
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $bytes, $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[System.IO.File]::WriteAllBytes('${tempOut.path.replace(/\\/g, '\\\\')}', $decrypted)
`.trim();

  try {
    await execPs(`Add-Type -AssemblyName System.Security\n${script}`, 10000);
    const { readFileSync } = await import('node:fs');
    const result = readFileSync(tempOut.path);
    return result.toString('utf8').replace(/\0/g, '');
  } finally {
    tempIn.cleanup();
    tempOut.cleanup();
  }
}

async function extractChromiumPasswords(browser: 'chrome' | 'edge'): Promise<ChromePasswordRow[]> {
  const base = chromiumBasePath(browser);
  if (!base || !existsSync(base)) return [];

  const rows: ChromePasswordRow[] = [];
  const { readdir } = await import('node:fs/promises');
  const { copyFile, mkdir, rm } = await import('node:fs/promises');

  let profileDirs: string[];
  try {
    profileDirs = await readdir(base);
  } catch {
    return [];
  }

  for (const dir of profileDirs) {
    if (!dir.startsWith('Default') && !dir.startsWith('Profile')) continue;
    const dbPath = join(base, dir, 'Login Data');
    if (!existsSync(dbPath)) continue;

    const tmpDir = join(require('node:os').tmpdir(), `sysint-chrome-${Date.now()}`);
    try {
      await mkdir(tmpDir, { recursive: true });
      const tmpDb = join(tmpDir, 'Login Data');
      await copyFile(dbPath, tmpDb);
      // Copy WAL/SHM if they exist
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
              password = await decryptDpapi(r.password_value);
            } catch {
              password = '<decryption_failed>';
            }
          }
          rows.push({
            browser,
            profile: dir,
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

async function runChromePasswords(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOnly('browser-chrome-passwords');
  if (platformGuard) return platformGuard;

  const consentWarning = checkCredentialConsent(args, 'browser-chrome-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'browser-chrome-passwords', getPlatformName());

  logCredentialAccess('browser-chrome-passwords');

  try {
    const rows = [
      ...await extractChromiumPasswords('chrome'),
      ...await extractChromiumPasswords('edge'),
    ];
    return buildSuccess(rows, 'browser-chrome-passwords', getPlatformName());
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
