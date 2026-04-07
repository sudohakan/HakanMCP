/**
 * PWD-10: network-passwords — Read saved network passwords from Windows (admin required).
 * Windows-only. Returns PLATFORM_UNSUPPORTED on Linux, PRIVILEGE_REQUIRED without admin.
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
import { getPrivilegeLevel } from '../../privilegeHelper.js';

export interface NetworkPasswordRow {
  target: string;
  credentialType: string;
  user: string;
  password: string;
  _sensitive: boolean;
}

export function parseNetworkCredsOutput(output: string): NetworkPasswordRow[] {
  const rows: NetworkPasswordRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [target, type, user, password] = parts;
    if (!target || target.trim() === '') continue;
    rows.push({
      target: (target ?? '').trim(),
      credentialType: (type ?? '').trim(),
      user: (user ?? '').trim(),
      password: (password ?? '').trim(),
      _sensitive: true,
    });
  }
  return rows;
}

async function runNetworkPasswords(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOnly('network-passwords');
  if (platformGuard) return platformGuard;

  // Privilege check (admin required for full access)
  const level = await getPrivilegeLevel();
  if (level !== 'admin') {
    return buildError(
      "Tool 'network-passwords' requires administrator privileges",
      'PRIVILEGE_REQUIRED',
      'network-passwords',
    );
  }

  const consentWarning = checkCredentialConsent(args, 'network-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'network-passwords', getPlatformName());

  logCredentialAccess('network-passwords');

  const script = `
$cmdkeyOutput = cmdkey /list 2>$null
$currentTarget = ''
$currentType = ''
$currentUser = ''

$cmdkeyOutput | ForEach-Object {
  $line = $_.Trim()
  if ($line -match '^Target: (.+)$') { $currentTarget = $matches[1] }
  elseif ($line -match '^Type: (.+)$') { $currentType = $matches[1] }
  elseif ($line -match '^User: (.+)$') {
    $currentUser = $matches[1]
    # Filter for network credential types
    $netTypes = @('Domain Password', 'Generic', 'Domain Certificate')
    if ($currentType -in $netTypes -and $currentTarget -match '^(\\\\\\\\|//|[A-Za-z0-9_-]+\\.[A-Za-z0-9_.-]+|[A-Za-z0-9_-]+$)') {
      $pass = ''
      try {
        $nc = New-Object System.Net.NetworkCredential($currentUser, (cmdkey /list:$currentTarget 2>$null | Out-String))
      } catch {}
      # Attempt vault retrieval
      try {
        $vault = New-Object Windows.Security.Credentials.PasswordVault
        $creds = $vault.FindAllByResource($currentTarget) 2>$null
        if ($creds) {
          $creds[0].RetrievePassword()
          $pass = $creds[0].Password
        }
      } catch {}
      "$currentTarget\t$currentType\t$currentUser\t$pass"
    }
    $currentTarget = ''
  }
}
`.trim();

  try {
    const { stdout } = await execPs(script);
    const rows = parseNetworkCredsOutput(stdout);
    return buildSuccess(rows, 'network-passwords', getPlatformName());
  } catch (err) {
    return buildError(`network-passwords failed: ${String(err)}`, 'EXEC_FAILED', 'network-passwords');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'network-passwords': runNetworkPasswords,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
