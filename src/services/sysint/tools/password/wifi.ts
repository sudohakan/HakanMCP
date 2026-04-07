/**
 * PWD-03: wifi-passwords — Extract saved Wi-Fi passwords.
 * Windows: netsh wlan. Linux: NetworkManager system-connections.
 * Cross-platform.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

export interface WifiPasswordRow {
  ssid: string;
  security: string;
  password: string;
  _sensitive: boolean;
}

// ── Windows: netsh ────────────────────────────────────────────────────────────

/**
 * Parse `netsh wlan show profiles` output — extract SSIDs.
 */
export function parseNetshProfileList(output: string): string[] {
  const ssids: string[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/:\s+(.+?)\s*$/);
    // Lines like "    All User Profile     : MySSID"
    if (line.includes('Profile') && match?.[1]) {
      const ssid = match[1].trim();
      if (ssid) ssids.push(ssid);
    }
  }
  return ssids;
}

/**
 * Parse `netsh wlan show profile name=X key=clear` output.
 * Extracts Key Content and Authentication type.
 */
export function parseNetshProfileDetail(output: string): { password: string; security: string } {
  let password = '';
  let security = '';

  for (const line of output.split('\n')) {
    const keyMatch = line.match(/Key Content\s*:\s*(.+)$/i);
    if (keyMatch?.[1]) password = keyMatch[1].trim();

    const authMatch = line.match(/Authentication\s*:\s*(.+)$/i);
    if (authMatch?.[1]) security = authMatch[1].trim();
  }

  return { password, security };
}

async function getWindowsWifiPasswords(): Promise<WifiPasswordRow[]> {
  let profileListOutput: string;
  try {
    const { stdout } = await execAsync('netsh wlan show profiles', { timeout: 10000 });
    profileListOutput = stdout;
  } catch {
    return [];
  }

  const ssids = parseNetshProfileList(profileListOutput);
  const rows: WifiPasswordRow[] = [];

  for (const ssid of ssids) {
    try {
      const { stdout } = await execAsync(`netsh wlan show profile name="${ssid}" key=clear`, { timeout: 5000 });
      const { password, security } = parseNetshProfileDetail(stdout);
      rows.push({ ssid, security, password, _sensitive: true });
    } catch {
      rows.push({ ssid, security: 'unknown', password: '', _sensitive: true });
    }
  }

  return rows;
}

// ── Linux: NetworkManager ─────────────────────────────────────────────────────

const NM_CONNECTIONS_DIR = '/etc/NetworkManager/system-connections';
const WPA_SUPPLICANT_CONF = '/etc/wpa_supplicant/wpa_supplicant.conf';

/**
 * Parse a NetworkManager .nmconnection file (INI format).
 * Returns parsed sections as Record<string, Record<string, string>>.
 */
export function parseNmConnection(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch?.[1]) {
      currentSection = sectionMatch[1];
      sections[currentSection] = {};
      continue;
    }

    if (currentSection) {
      const kv = trimmed.match(/^([^=]+)=(.*)$/);
      if (kv?.[1] && kv[2] !== undefined) {
        sections[currentSection]![kv[1].trim()] = kv[2].trim();
      }
    }
  }

  return sections;
}

async function getLinuxWifiPasswords(): Promise<WifiPasswordRow[]> {
  const rows: WifiPasswordRow[] = [];

  // NetworkManager connections
  if (existsSync(NM_CONNECTIONS_DIR)) {
    let files: string[] = [];
    try {
      files = readdirSync(NM_CONNECTIONS_DIR).filter((f) => f.endsWith('.nmconnection'));
    } catch {
      // Permission denied (requires root)
    }

    for (const file of files) {
      try {
        const content = readFileSync(join(NM_CONNECTIONS_DIR, file), 'utf8');
        const sections = parseNmConnection(content);
        const conn = sections['connection'] ?? {};
        const wifi = sections['wifi'] ?? {};
        const security = sections['wifi-security'] ?? {};

        const connType = conn['type'] ?? '';
        if (connType !== 'wifi') continue;

        const ssid = wifi['ssid'] ?? conn['id'] ?? file.replace('.nmconnection', '');
        const keyMgmt = security['key-mgmt'] ?? '';
        const psk = security['psk'] ?? '';

        rows.push({
          ssid,
          security: keyMgmt || 'unknown',
          password: psk,
          _sensitive: true,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  // wpa_supplicant fallback
  if (rows.length === 0 && existsSync(WPA_SUPPLICANT_CONF)) {
    try {
      const content = readFileSync(WPA_SUPPLICANT_CONF, 'utf8');
      rows.push(...parseWpaSupplicant(content));
    } catch {
      // Permission denied
    }
  }

  return rows;
}

/**
 * Parse wpa_supplicant.conf for network blocks.
 */
export function parseWpaSupplicant(content: string): WifiPasswordRow[] {
  const rows: WifiPasswordRow[] = [];
  const networkBlocks = content.split(/network\s*=\s*\{/);

  for (const block of networkBlocks.slice(1)) {
    const ssidMatch = block.match(/ssid\s*=\s*"([^"]+)"/);
    const pskMatch = block.match(/psk\s*=\s*"([^"]+)"/);
    const keyMgmtMatch = block.match(/key_mgmt\s*=\s*(\S+)/);

    if (ssidMatch?.[1]) {
      rows.push({
        ssid: ssidMatch[1],
        security: keyMgmtMatch?.[1] ?? 'unknown',
        password: pskMatch?.[1] ?? '',
        _sensitive: true,
      });
    }
  }

  return rows;
}

async function runWifiPasswords(args: string[]): Promise<SysIntResult> {
  const consentWarning = checkCredentialConsent(args, 'wifi-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'wifi-passwords', getPlatformName());

  logCredentialAccess('wifi-passwords');

  try {
    const isWsl = process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];
    let rows: WifiPasswordRow[];

    if (process.platform === 'win32' || isWsl) {
      rows = await getWindowsWifiPasswords();
    } else {
      rows = await getLinuxWifiPasswords();
    }

    return buildSuccess(rows, 'wifi-passwords', getPlatformName());
  } catch (err) {
    return buildError(`wifi-passwords failed: ${String(err)}`, 'EXEC_FAILED', 'wifi-passwords');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'wifi-passwords': runWifiPasswords,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
