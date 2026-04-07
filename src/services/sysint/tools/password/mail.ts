/**
 * PWD-08: mail-passwords — Extract mail client passwords.
 * Thunderbird: NSS (cross-platform) — reuses Firefox NSS decoder.
 * Outlook: Windows Credential Manager (Windows-only).
 */
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  checkCredentialConsent,
  logCredentialAccess,
  execPs,
} from './shared.js';
import { deriveKey4Key, decodeFirefoxLogins } from './firefox.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface MailPasswordRow {
  client: string;
  profile: string;
  server: string;
  username: string;
  password: string;
  _sensitive: boolean;
}

// ── Thunderbird (reuse Firefox NSS decoder) ───────────────────────────────────

function thunderbirdBasePath(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Thunderbird', 'Profiles');
  }
  return join(homedir(), '.thunderbird');
}

async function findThunderbirdProfiles(): Promise<string[]> {
  const base = thunderbirdBasePath();
  if (!existsSync(base)) return [];
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && (e.name.includes('.default') || e.name.includes('-release') || e.name.length > 8))
      .map((e) => join(base, e.name));
  } catch {
    return [];
  }
}

async function extractThunderbirdPasswords(): Promise<MailPasswordRow[]> {
  const profiles = await findThunderbirdProfiles();
  const rows: MailPasswordRow[] = [];

  for (const profilePath of profiles) {
    const key4DbPath = join(profilePath, 'key4.db');
    const loginsPath = join(profilePath, 'logins.json');
    if (!existsSync(key4DbPath) || !existsSync(loginsPath)) continue;

    const tmpDir = join(tmpdir(), `sysint-tb-${Date.now()}`);
    try {
      await mkdir(tmpDir, { recursive: true });
      const tmpKey4 = join(tmpDir, 'key4.db');
      await copyFile(key4DbPath, tmpKey4);
      for (const ext of ['-wal', '-shm']) {
        if (existsSync(key4DbPath + ext)) {
          await copyFile(key4DbPath + ext, tmpKey4 + ext).catch(() => {});
        }
      }

      const db = new Database(tmpKey4, { readonly: true, fileMustExist: true });
      let key: Buffer | null = null;
      try {
        key = deriveKey4Key(db);
      } finally {
        db.close();
      }
      if (!key) continue;

      const loginsRaw = readFileSync(loginsPath, 'utf8');
      const loginsJson = JSON.parse(loginsRaw) as { logins: Array<{ hostname: string; encryptedUsername: string; encryptedPassword: string }> };
      const profileName = profilePath.split('/').pop() ?? profilePath.split('\\').pop() ?? 'unknown';
      const ffRows = decodeFirefoxLogins(loginsJson.logins ?? [], key, profileName);

      for (const r of ffRows as Array<{ profile: string; url: string; username: string; password: string }>) {
        rows.push({
          client: 'thunderbird',
          profile: r.profile,
          server: r.url,
          username: r.username,
          password: r.password,
          _sensitive: true,
        });
      }
    } catch {
      // Skip profile
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return rows;
}

// ── Outlook (Windows Credential Manager) ─────────────────────────────────────

export function parseOutlookCredmanOutput(output: string): MailPasswordRow[] {
  const rows: MailPasswordRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [target, user, pass, profile] = parts;
    if (!target || target.trim() === '') continue;
    rows.push({
      client: 'outlook',
      profile: (profile ?? '').trim(),
      server: (target ?? '').trim(),
      username: (user ?? '').trim(),
      password: (pass ?? '').trim(),
      _sensitive: true,
    });
  }
  return rows;
}

async function extractOutlookPasswords(): Promise<MailPasswordRow[]> {
  // Only on Windows/WSL
  const isWsl = process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];
  if (process.platform !== 'win32' && !isWsl) return [];

  const script = `
$cmdkeyOutput = cmdkey /list 2>$null
$currentTarget = ''
$currentUser = ''

$cmdkeyOutput | ForEach-Object {
  $line = $_.Trim()
  if ($line -match '^Target: (.+)$') { $currentTarget = $matches[1] }
  elseif ($line -match '^User: (.+)$') {
    $currentUser = $matches[1]
    # Filter for Outlook/Exchange credentials
    if ($currentTarget -match 'MicrosoftOffice|Exchange|Outlook|MAPI') {
      $pass = ''
      try {
        $vault = New-Object Windows.Security.Credentials.PasswordVault
        $creds = $vault.FindAllByResource($currentTarget) 2>$null
        if ($creds) {
          $creds[0].RetrievePassword()
          $pass = $creds[0].Password
        }
      } catch {}
      "$currentTarget\t$currentUser\t$pass\tOutlook"
    }
    $currentTarget = ''
  }
}
`.trim();

  try {
    const { stdout } = await execPs(script);
    return parseOutlookCredmanOutput(stdout);
  } catch {
    return [];
  }
}

async function runMailPasswords(args: string[]): Promise<SysIntResult> {
  const consentWarning = checkCredentialConsent(args, 'mail-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'mail-passwords', getPlatformName());

  logCredentialAccess('mail-passwords');

  try {
    const [tbRows, outlookRows] = await Promise.all([
      extractThunderbirdPasswords(),
      extractOutlookPasswords(),
    ]);
    return buildSuccess([...tbRows, ...outlookRows], 'mail-passwords', getPlatformName());
  } catch (err) {
    return buildError(`mail-passwords failed: ${String(err)}`, 'EXEC_FAILED', 'mail-passwords');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'mail-passwords': runMailPasswords,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
