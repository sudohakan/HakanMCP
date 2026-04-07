/**
 * PWD-05: windows-vault — Read Web Credentials from Windows Vault.
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

export interface VaultRow {
  resource: string;
  username: string;
  password: string;
  _sensitive: boolean;
}

export function parseVaultOutput(output: string): VaultRow[] {
  const rows: VaultRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [resource, username, password] = parts;
    if (!resource || resource.trim() === '') continue;
    rows.push({
      resource: (resource ?? '').trim(),
      username: (username ?? '').trim(),
      password: (password ?? '').trim(),
      _sensitive: true,
    });
  }
  return rows;
}

async function runWindowsVault(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOnly('windows-vault');
  if (platformGuard) return platformGuard;

  const consentWarning = checkCredentialConsent(args, 'windows-vault');
  if (consentWarning) return buildSuccess(consentWarning, 'windows-vault', getPlatformName());

  logCredentialAccess('windows-vault');

  const script = `
$vaultOutput = vaultcmd /listcreds:"Web Credentials" /uniqid 2>$null
if (-not $vaultOutput) {
  $vaultOutput = vaultcmd /listcreds:"Web Credentials" 2>$null
}

$resource = ''
$user = ''

$vaultOutput | ForEach-Object {
  $line = $_.Trim()
  if ($line -match 'Resource: (.+)$') { $resource = $matches[1] }
  elseif ($line -match 'Identity: (.+)$') { $user = $matches[1] }
  elseif ($line -match 'Credential: (.+)$' -or ($resource -and $line -eq '')) {
    if ($resource) {
      $pass = ''
      try {
        # Try retrieving from PasswordVault
        $vault = New-Object Windows.Security.Credentials.PasswordVault
        $creds = $vault.FindAllByResource($resource) 2>$null
        if ($creds) {
          $creds[0].RetrievePassword()
          $pass = $creds[0].Password
        }
      } catch {}
      "$resource\t$user\t$pass"
      $resource = ''
      $user = ''
    }
  }
}
`.trim();

  try {
    const { stdout } = await execPs(script);
    const rows = parseVaultOutput(stdout);
    return buildSuccess(rows, 'windows-vault', getPlatformName());
  } catch (err) {
    return buildError(`windows-vault failed: ${String(err)}`, 'EXEC_FAILED', 'windows-vault');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'windows-vault': runWindowsVault,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
