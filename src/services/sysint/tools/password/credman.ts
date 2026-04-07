/**
 * PWD-04: credential-manager — Read credentials from Windows Credential Manager.
 * Windows-only. Returns PLATFORM_UNSUPPORTED on Linux.
 */
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

export interface CredentialRow {
  target: string;
  type: string;
  user: string;
  credential: string;
  _sensitive: boolean;
}

export function parseCredmanOutput(output: string): CredentialRow[] {
  const rows: CredentialRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [target, type, user, credential] = parts;
    if (!target || target.trim() === '') continue;
    rows.push({
      target: (target ?? '').trim(),
      type: (type ?? '').trim(),
      user: (user ?? '').trim(),
      credential: (credential ?? '').trim(),
      _sensitive: true,
    });
  }
  return rows;
}

async function runCredentialManager(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOnly('credential-manager');
  if (platformGuard) return platformGuard;

  const consentWarning = checkCredentialConsent(args, 'credential-manager');
  if (consentWarning) return buildSuccess(consentWarning, 'credential-manager', getPlatformName());

  logCredentialAccess('credential-manager');

  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$creds = cmdkey /list 2>$null
$currentTarget = ''
$currentType = ''
$currentUser = ''

$creds | ForEach-Object {
  $line = $_.Trim()
  if ($line -match '^Target: (.+)$') { $currentTarget = $matches[1] }
  elseif ($line -match '^Type: (.+)$') { $currentType = $matches[1] }
  elseif ($line -match '^User: (.+)$') {
    $currentUser = $matches[1]
    if ($currentTarget) {
      # Attempt to retrieve credential value via PasswordVault
      $cred = ''
      try {
        $vault = New-Object Windows.Security.Credentials.PasswordVault
        $vCreds = $vault.FindAllByResource($currentTarget) 2>$null
        if ($vCreds) {
          $vCreds[0].RetrievePassword()
          $cred = $vCreds[0].Password
        }
      } catch {}
      "$currentTarget\t$currentType\t$currentUser\t$cred"
      $currentTarget = ''
    }
  }
}
`.trim();

  try {
    const { stdout } = await execPs(script);
    const rows = parseCredmanOutput(stdout);
    return buildSuccess(rows, 'credential-manager', getPlatformName());
  } catch (err) {
    return buildError(`credential-manager failed: ${String(err)}`, 'EXEC_FAILED', 'credential-manager');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'credential-manager': runCredentialManager,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
