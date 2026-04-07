/**
 * Password category entry point — dispatches to sub-modules.
 * PWD-01..10 implemented across chrome.ts, firefox.ts, wifi.ts, credman.ts,
 * vault.ts, rdp.ts, vnc.ts, mail.ts, lsa.ts, network-creds.ts
 */
import { run as chromeRun } from './chrome.js';
import { run as firefoxRun } from './firefox.js';
import { run as wifiRun } from './wifi.js';
import { run as credmanRun } from './credman.js';
import { run as vaultRun } from './vault.js';
import { run as rdpRun } from './rdp.js';
import { run as vncRun } from './vnc.js';
import { run as mailRun } from './mail.js';
import { run as lsaRun } from './lsa.js';
import { run as networkCredsRun } from './network-creds.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  // PWD-01: Chrome DPAPI passwords (Windows-only)
  'browser-chrome-passwords': (id, args) => chromeRun(id, args),
  // PWD-02: Firefox NSS passwords (cross-platform)
  'browser-firefox-passwords': (id, args) => firefoxRun(id, args),
  // PWD-03: Wi-Fi passwords (cross-platform)
  'wifi-passwords': (id, args) => wifiRun(id, args),
  // PWD-04: Windows Credential Manager (Windows-only)
  'credential-manager': (id, args) => credmanRun(id, args),
  // PWD-05: Windows Vault (Windows-only)
  'windows-vault': (id, args) => vaultRun(id, args),
  // PWD-06: RDP credentials (Windows-only)
  'rdp-credentials': (id, args) => rdpRun(id, args),
  // PWD-07: VNC passwords (cross-platform)
  'vnc-passwords': (id, args) => vncRun(id, args),
  // PWD-08: Mail passwords (cross-platform: Thunderbird NSS + Outlook Windows)
  'mail-passwords': (id, args) => mailRun(id, args),
  // PWD-09: LSA secrets (Windows-only, admin required)
  'lsa-secrets': (id, args) => lsaRun(id, args),
  // PWD-10: Network passwords (Windows-only, admin required)
  'network-passwords': (id, args) => networkCredsRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for password tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
