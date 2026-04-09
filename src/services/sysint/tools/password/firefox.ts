/**
 * PWD-02: browser-firefox-passwords — Extract Firefox saved passwords via nss3.dll.
 * Uses Firefox's own NSS library (PK11SDR_Decrypt) for reliable decryption.
 * Works regardless of master password state.
 * Windows/WSL: nss3.dll via PowerShell script file.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  checkCredentialConsent,
  logCredentialAccess,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export interface FirefoxPasswordRow {
  profile: string;
  url: string;
  username: string;
  password: string;
  _sensitive: boolean;
}

const isWsl = (): boolean => process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];

function getWinUser(): string {
  return process.env['WIN_USERNAME']
    ?? process.env['LOGNAME']
    ?? process.env['USER']
    ?? 'Hakan';
}

export function firefoxBasePath(app: 'firefox' | 'thunderbird' = 'firefox'): string {
  const appName = app === 'firefox' ? 'Firefox' : 'Thunderbird';
  const appLower = app === 'firefox' ? 'firefox' : 'thunderbird';

  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Mozilla', appName, 'Profiles');
  }

  if (isWsl()) {
    return join(`/mnt/c/Users/${getWinUser()}/AppData/Roaming`, 'Mozilla', appName, 'Profiles');
  }

  return join(homedir(), `.${appLower}`);
}

export async function findFirefoxProfiles(app: 'firefox' | 'thunderbird' = 'firefox'): Promise<string[]> {
  const base = firefoxBasePath(app);
  if (!existsSync(base)) return [];
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && (
        e.name.includes('.default') || e.name.includes('-release') || e.name.includes('-esr') || e.name.length > 8
      ))
      .map((e) => join(base, e.name));
  } catch {
    return [];
  }
}

interface LoginsJson {
  logins: Array<{
    hostname: string;
    encryptedUsername: string;
    encryptedPassword: string;
  }>;
}

function toWinPath(p: string): string {
  const match = p.match(/^\/mnt\/([a-z])\/(.*)/);
  if (match) {
    return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
  }
  return p;
}

function findFirefoxInstall(): string {
  const candidates = [
    'C:\\Program Files\\Mozilla Firefox',
    'C:\\Program Files (x86)\\Mozilla Firefox',
  ];
  for (const c of candidates) {
    const wslPath = `/mnt/c/${c.slice(3).replace(/\\/g, '/')}`;
    const checkPath = isWsl() ? wslPath : c;
    if (existsSync(join(checkPath, 'nss3.dll'))) return c;
  }
  return '';
}

function getSharedTempDir(): string {
  if (isWsl()) {
    return `/mnt/c/Users/${getWinUser()}/AppData/Local/Temp`;
  }
  return tmpdir();
}

/**
 * Build PowerShell script content that loads nss3.dll and decrypts all logins.
 */
function buildNssScript(firefoxDir: string, winProfilePath: string, loginsJson: LoginsJson): string {
  const logins = loginsJson.logins.map((l, i) => `@{i=${i};u='${l.encryptedUsername}';p='${l.encryptedPassword}';h='${l.hostname.replace(/'/g, "''")}'}`).join(',\n  ');

  return `$firefoxDir = '${firefoxDir}'
$profileDir = '${winProfilePath}'
$env:PATH = "$firefoxDir;$env:PATH"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class NSSDecrypt {
    [DllImport("nss3.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int NSS_Init(string configdir);

    [DllImport("nss3.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int NSS_Shutdown();

    [StructLayout(LayoutKind.Sequential)]
    public struct SECItem {
        public uint type;
        public IntPtr data;
        public uint len;
    }

    [DllImport("nss3.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int PK11SDR_Decrypt(ref SECItem data, ref SECItem result, IntPtr cx);

    [DllImport("nss3.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr PK11_GetInternalKeySlot();

    [DllImport("nss3.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int PK11_CheckUserPassword(IntPtr slot, string pw);

    public static string Decrypt(byte[] encrypted) {
        SECItem input = new SECItem();
        input.data = Marshal.AllocHGlobal(encrypted.Length);
        Marshal.Copy(encrypted, 0, input.data, encrypted.Length);
        input.len = (uint)encrypted.Length;

        SECItem output = new SECItem();
        int result = PK11SDR_Decrypt(ref input, ref output, IntPtr.Zero);
        Marshal.FreeHGlobal(input.data);

        if (result != 0) return "";
        byte[] decrypted = new byte[output.len];
        Marshal.Copy(output.data, decrypted, 0, (int)output.len);
        return Encoding.UTF8.GetString(decrypted);
    }
}
"@

$initResult = [NSSDecrypt]::NSS_Init($profileDir)
if ($initResult -ne 0) { Write-Output "[]"; exit 0 }

$slot = [NSSDecrypt]::PK11_GetInternalKeySlot()
[NSSDecrypt]::PK11_CheckUserPassword($slot, "") | Out-Null

$entries = @(
  ${logins}
)

$results = @()
foreach ($e in $entries) {
    $u = [NSSDecrypt]::Decrypt([Convert]::FromBase64String($e.u))
    $pw = [NSSDecrypt]::Decrypt([Convert]::FromBase64String($e.p))
    $results += [PSCustomObject]@{ url=$e.h; username=$u; password=$pw }
}

[NSSDecrypt]::NSS_Shutdown() | Out-Null
$results | ConvertTo-Json -Depth 3 -Compress`;
}

/**
 * Decrypt all Firefox passwords for a profile using nss3.dll via PowerShell script file.
 */
async function decryptViaNss(profilePath: string): Promise<FirefoxPasswordRow[]> {
  const loginsPath = join(profilePath, 'logins.json');
  if (!existsSync(loginsPath)) return [];

  const loginsRaw = readFileSync(loginsPath, 'utf8');
  const loginsJson = JSON.parse(loginsRaw) as LoginsJson;
  if (!loginsJson.logins?.length) return [];

  const firefoxDir = findFirefoxInstall();
  if (!firefoxDir) return [];

  const winProfilePath = isWsl() ? toWinPath(profilePath) : profilePath;
  const profileName = basename(profilePath) || 'unknown';

  const scriptContent = buildNssScript(firefoxDir, winProfilePath, loginsJson);

  const sharedTmp = getSharedTempDir();
  const suffix = randomBytes(6).toString('hex');
  const scriptPath = join(sharedTmp, `sysint-ff-nss-${suffix}.ps1`);
  const winScriptPath = isWsl() ? toWinPath(scriptPath) : scriptPath;

  try {
    writeFileSync(scriptPath, scriptContent, { encoding: 'utf8' });

    const psExe = isWsl() ? 'powershell.exe' : 'powershell';
    const cmd = `${psExe} -NoProfile -ExecutionPolicy Bypass -File "${winScriptPath}"`;
    const { stdout } = await execAsync(cmd, { timeout: 30000 });

    const trimmed = stdout.replace(/\r\n/g, '\n').trim();
    if (!trimmed || trimmed === '[]') return [];

    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items.map((item: { url: string; username: string; password: string }) => ({
      profile: profileName,
      url: item.url,
      username: item.username,
      password: item.password,
      _sensitive: true,
    }));
  } catch {
    return [];
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

export async function extractFirefoxPasswords(app: 'firefox' | 'thunderbird' = 'firefox'): Promise<FirefoxPasswordRow[]> {
  const profiles = await findFirefoxProfiles(app);
  if (!profiles.length) return [];

  const allRows: FirefoxPasswordRow[] = [];
  for (const profilePath of profiles) {
    const rows = await decryptViaNss(profilePath);
    allRows.push(...rows);
  }
  return allRows;
}

async function runFirefoxPasswords(args: string[]): Promise<SysIntResult> {
  const consentWarning = checkCredentialConsent(args, 'browser-firefox-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'browser-firefox-passwords', getPlatformName());

  logCredentialAccess('browser-firefox-passwords');

  try {
    const rows = await extractFirefoxPasswords('firefox');
    return buildSuccess(rows, 'browser-firefox-passwords', getPlatformName());
  } catch (err) {
    return buildError(`browser-firefox-passwords failed: ${String(err)}`, 'EXEC_FAILED', 'browser-firefox-passwords');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-firefox-passwords': runFirefoxPasswords,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
