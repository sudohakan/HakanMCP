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
import { buildError, buildSuccess } from '../../outputFormatter.js';
import { getPlatformName } from '../../platforms/index.js';
import {
  checkCredentialConsent,
  logCredentialAccess,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

async function runAllBrowserPasswords(_id: string, args: string[]): Promise<SysIntResult> {
  const consentWarning = checkCredentialConsent(args, 'browser-all-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'browser-all-passwords', getPlatformName());

  logCredentialAccess('browser-all-passwords');

  const chromiumResult = await chromeRun('browser-chrome-passwords', args);
  const firefoxResult = await firefoxRun('browser-firefox-passwords', args);

  const allRows: unknown[] = [];
  if ('rows' in chromiumResult && Array.isArray(chromiumResult.rows)) {
    for (const row of chromiumResult.rows) {
      allRows.push(row);
    }
  }
  if ('rows' in firefoxResult && Array.isArray(firefoxResult.rows)) {
    for (const row of firefoxResult.rows) {
      allRows.push({ ...(row as Record<string, unknown>), browser: 'firefox' });
    }
  }

  return buildSuccess(allRows, 'browser-all-passwords', getPlatformName());
}

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  'browser-chrome-passwords': (id, args) => chromeRun(id, args),
  'browser-firefox-passwords': (id, args) => firefoxRun(id, args),
  'browser-all-passwords': (id, args) => runAllBrowserPasswords(id, args),
  'wifi-passwords': (id, args) => wifiRun(id, args),
  'credential-manager': (id, args) => credmanRun(id, args),
  'windows-vault': (id, args) => vaultRun(id, args),
  'rdp-credentials': (id, args) => rdpRun(id, args),
  'vnc-passwords': (id, args) => vncRun(id, args),
  'mail-passwords': (id, args) => mailRun(id, args),
  'lsa-secrets': (id, args) => lsaRun(id, args),
  'network-passwords': (id, args) => networkCredsRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for password tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
