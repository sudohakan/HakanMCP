/**
 * Wi-Fi tools — NET-04 (wifi-scan), NET-05 (wifi-history)
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { buildSuccess, buildError } from '../../outputFormatter.js';
import { getPlatformName } from '../../platforms/index.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export interface WifiNetworkRow {
  ssid: string;
  bssid: string;
  signalPercent: number;
  channel: number;
  security: string;
  inUse: boolean;
}

export interface WifiProfileRow {
  ssid: string;
  security: string;
}

// ── Parsers (exported for testing) ──────────────────────────────────────────

export function parseNetshNetworks(output: string): WifiNetworkRow[] {
  const rows: WifiNetworkRow[] = [];
  const normalized = output.replace(/\r\n/g, '\n');
  const ssidBlocks = normalized.split(/(?=^SSID \d+\s*:)/m);

  for (const block of ssidBlocks) {
    const ssidMatch = block.match(/^SSID \d+\s*:\s*(.+)/m);
    if (!ssidMatch) continue;
    const ssid = ssidMatch[1].trim();
    const bssidMatch = block.match(/BSSID \d+\s*:\s*(\S+)/m);
    const signalMatch = block.match(/Signal\s*:\s*(\d+)%/m);
    const channelMatch = block.match(/Channel\s*:\s*(\d+)/m);
    const authMatch = block.match(/Authentication\s*:\s*(.+)/m);

    rows.push({
      ssid,
      bssid: bssidMatch?.[1] ?? '',
      signalPercent: signalMatch ? parseInt(signalMatch[1], 10) : 0,
      channel: channelMatch ? parseInt(channelMatch[1], 10) : 0,
      security: authMatch ? authMatch[1].trim() : '',
      inUse: false,
    });
  }
  return rows;
}

export function parseNmcliWifi(output: string): WifiNetworkRow[] {
  const rows: WifiNetworkRow[] = [];
  const lines = output.replace(/\r\n/g, '\n').split('\n').slice(1); // skip header
  for (const line of lines) {
    if (!line.trim()) continue;
    const inUse = line.startsWith('*');
    // nmcli columns are fixed-width but tricky — use regex
    // Format: IN-USE  BSSID              SSID           MODE   CHAN  RATE        SIGNAL  BARS  SECURITY
    const match = line.match(/^[\*\s]\s+(\S{17})\s+(.+?)\s{2,}Infra\s+(\d+)\s+[\d.]+ Mbit\/s\s+(\d+)\s+\S+\s+(.*)/);
    if (match) {
      rows.push({
        ssid: match[2].trim(),
        bssid: match[1],
        signalPercent: parseInt(match[4], 10),
        channel: parseInt(match[3], 10),
        security: match[5].trim(),
        inUse,
      });
    }
  }
  return rows;
}

// ── NET-04: wifi-scan ─────────────────────────────────────────────────────────

async function scanWifiWindows(): Promise<WifiNetworkRow[]> {
  const isWsl = process.platform === 'linux';
  const cmd = isWsl
    ? 'powershell.exe -NoProfile -Command "netsh wlan show networks mode=bssid"'
    : 'netsh wlan show networks mode=bssid';
  const { stdout } = await execAsync(cmd, { timeout: 30_000 });
  return parseNetshNetworks(stdout);
}

async function scanWifiLinux(): Promise<WifiNetworkRow[]> {
  const { stdout } = await execAsync('nmcli dev wifi list 2>/dev/null', { timeout: 30_000 });
  return parseNmcliWifi(stdout);
}

async function runWifiScan(): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const rows = platform === 'linux' ? await scanWifiLinux() : await scanWifiWindows();
    return buildSuccess(rows, 'wifi-scan', platform);
  } catch (err) {
    return buildError(`wifi-scan failed: ${String(err)}`, 'EXEC_FAILED', 'wifi-scan');
  }
}

// ── NET-05: wifi-history ──────────────────────────────────────────────────────

async function getWifiHistoryWindows(): Promise<WifiProfileRow[]> {
  const isWsl = process.platform === 'linux';
  const cmd = isWsl
    ? 'powershell.exe -NoProfile -Command "netsh wlan show profiles"'
    : 'netsh wlan show profiles';
  const { stdout } = await execAsync(cmd, { timeout: 15_000 });
  return parseNetshProfiles(stdout);
}

export function parseNetshProfiles(output: string): WifiProfileRow[] {
  const rows: WifiProfileRow[] = [];
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/All User Profile\s*:\s*(.+)/);
    if (match) {
      rows.push({ ssid: match[1].trim(), security: '' });
    }
  }
  return rows;
}

async function getWifiHistoryLinux(): Promise<WifiProfileRow[]> {
  const rows: WifiProfileRow[] = [];
  try {
    const dir = '/etc/NetworkManager/system-connections';
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const file of files.filter((f) => f.endsWith('.nmconnection'))) {
      const content = await readFile(`${dir}/${file}`, 'utf8').catch(() => '');
      const ssidMatch = content.match(/^ssid=(.+)/m);
      const securityMatch = content.match(/^key-mgmt=(.+)/m);
      if (ssidMatch) {
        rows.push({ ssid: ssidMatch[1].trim(), security: securityMatch?.[1].trim() ?? '' });
      }
    }
  } catch {
    // May not have access to NM files
  }
  return rows;
}

async function runWifiHistory(): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const rows = platform === 'linux' ? await getWifiHistoryLinux() : await getWifiHistoryWindows();
    return buildSuccess(rows, 'wifi-history', platform);
  } catch (err) {
    return buildError(`wifi-history failed: ${String(err)}`, 'EXEC_FAILED', 'wifi-history');
  }
}

export async function run(toolId: string, _args: string[]): Promise<SysIntResult> {
  switch (toolId) {
    case 'wifi-scan': return runWifiScan();
    case 'wifi-history': return runWifiHistory();
    default: return buildError(`Unknown wifi tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
}
