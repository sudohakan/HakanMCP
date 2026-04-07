/**
 * PWD-09: lsa-secrets — Read Windows LSA secret names (admin required).
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

export interface LsaSecretRow {
  secretName: string;
  encrypted: boolean;
  hint: string;
}

export function parseLsaSecretNames(output: string): LsaSecretRow[] {
  const rows: LsaSecretRow[] = [];
  const wellKnown: Record<string, string> = {
    'DPAPI_SYSTEM': 'DPAPI system master key seed',
    'NL$KM': 'Cached domain credential encryption key',
    '_SC_': 'Service account password prefix',
    'DefaultPassword': 'AutoLogon password',
    'ASPNET_WP_PASSWORD': 'ASP.NET worker process account',
    'SCM:{': 'Service Control Manager secret',
  };

  for (const line of output.split('\n')) {
    const name = line.trim();
    if (!name || name.startsWith('#')) continue;

    let hint = 'LSA secret';
    for (const [prefix, description] of Object.entries(wellKnown)) {
      if (name.startsWith(prefix)) {
        hint = description;
        break;
      }
    }

    rows.push({ secretName: name, encrypted: true, hint });
  }
  return rows;
}

async function runLsaSecrets(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOnly('lsa-secrets');
  if (platformGuard) return platformGuard;

  // Privilege check (admin required)
  const level = await getPrivilegeLevel();
  if (level !== 'admin') {
    return buildError(
      "Tool 'lsa-secrets' requires administrator privileges",
      'PRIVILEGE_REQUIRED',
      'lsa-secrets',
    );
  }

  const consentWarning = checkCredentialConsent(args, 'lsa-secrets');
  if (consentWarning) return buildSuccess(consentWarning, 'lsa-secrets', getPlatformName());

  logCredentialAccess('lsa-secrets');

  // Enumerate LSA secret names only (decryption requires SYSTEM key — out of scope)
  const script = `
try {
  $securityPath = 'HKLM:\\SECURITY\\Policy\\Secrets'
  Get-ChildItem -Path $securityPath -ErrorAction SilentlyContinue | ForEach-Object {
    $_.PSChildName
  }
} catch {
  Write-Error "Access denied to LSA secrets: $_"
}
`.trim();

  try {
    const { stdout, stderr } = await execPs(script, 20000);
    if (stderr && !stdout) {
      return buildError(`lsa-secrets: ${stderr}`, 'EXEC_FAILED', 'lsa-secrets');
    }
    const rows = parseLsaSecretNames(stdout);
    return buildSuccess(rows, 'lsa-secrets', getPlatformName());
  } catch (err) {
    return buildError(`lsa-secrets failed: ${String(err)}`, 'EXEC_FAILED', 'lsa-secrets');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'lsa-secrets': runLsaSecrets,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
