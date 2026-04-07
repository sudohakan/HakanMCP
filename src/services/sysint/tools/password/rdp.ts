/**
 * PWD-06: rdp-credentials — Read saved RDP credentials from registry and Credential Manager.
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

export interface RdpCredentialRow {
  host: string;
  username: string;
  hasPassword: boolean;
  _sensitive: boolean;
}

export function parseRdpOutput(output: string): RdpCredentialRow[] {
  const rows: RdpCredentialRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [host, username, hasPassStr] = parts;
    if (!host || host.trim() === '') continue;
    rows.push({
      host: (host ?? '').trim(),
      username: (username ?? '').trim(),
      hasPassword: (hasPassStr ?? '').trim() === 'true',
      _sensitive: true,
    });
  }
  return rows;
}

async function runRdpCredentials(args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOnly('rdp-credentials');
  if (platformGuard) return platformGuard;

  const consentWarning = checkCredentialConsent(args, 'rdp-credentials');
  if (consentWarning) return buildSuccess(consentWarning, 'rdp-credentials', getPlatformName());

  logCredentialAccess('rdp-credentials');

  const script = `
$regPath = 'HKCU:\\SOFTWARE\\Microsoft\\Terminal Server Client\\Servers'
try {
  Get-ChildItem -Path $regPath -ErrorAction SilentlyContinue | ForEach-Object {
    $host = $_.PSChildName
    $userHint = (Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue).UsernameHint
    $hasPass = $false
    try {
      $credList = cmdkey /list:TERMSRV/$host 2>$null
      $hasPass = ($credList | Select-String -Pattern 'User:') -ne $null
    } catch {}
    "$host\t$([string]$userHint)\t$($hasPass.ToString().ToLower())"
  }
} catch {}
`.trim();

  try {
    const { stdout } = await execPs(script);
    const rows = parseRdpOutput(stdout);
    return buildSuccess(rows, 'rdp-credentials', getPlatformName());
  } catch (err) {
    return buildError(`rdp-credentials failed: ${String(err)}`, 'EXEC_FAILED', 'rdp-credentials');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'rdp-credentials': runRdpCredentials,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
