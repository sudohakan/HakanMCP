/**
 * PWD-08: mail-passwords — Extract mail client passwords.
 * Thunderbird: NSS via nss3.dll (cross-platform) — reuses Firefox NSS approach.
 * Outlook: Windows Credential Manager (Windows-only).
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  checkCredentialConsent,
  logCredentialAccess,
  execPs,
} from './shared.js';
import { extractFirefoxPasswords } from './firefox.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface MailPasswordRow {
  client: string;
  profile: string;
  server: string;
  username: string;
  password: string;
  _sensitive: boolean;
}

// ── Thunderbird (reuse Firefox NSS nss3.dll approach) ────────────────────────

async function extractThunderbirdPasswords(): Promise<MailPasswordRow[]> {
  const ffRows = await extractFirefoxPasswords('thunderbird');
  return ffRows.map((r) => ({
    client: 'thunderbird',
    profile: r.profile,
    server: r.url,
    username: r.username,
    password: r.password,
    _sensitive: true,
  }));
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
