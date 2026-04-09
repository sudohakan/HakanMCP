/**
 * Password Phase 4 Plan 02 tests — PWD-01..05
 * Tests: consent mechanism, temp file security, Firefox NSS decoder,
 *        Wi-Fi parsers, platform guards.
 * All tests run on Linux CI without real credentials or Windows APIs.
 */
import { statSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Imports ──────────────────────────────────────────────────────────────────

let checkCredentialConsent: (args: string[], toolId: string) => unknown[] | null;
let writeTempSecure: (content: string | Buffer) => { path: string; cleanup: () => void };
let logCredentialAccess: (toolId: string) => void;
let parseNetshProfileList: (output: string) => string[];
let parseNetshProfileDetail: (output: string) => { password: string; security: string };
let parseNmConnection: (content: string) => Record<string, Record<string, string>>;
let parseWpaSupplicant: (content: string) => unknown[];
let parseCredmanOutput: (output: string) => unknown[];
let parseVaultOutput: (output: string) => unknown[];
let chromeRun: (toolId: string, args?: string[]) => Promise<unknown>;
let firefoxRun: (toolId: string, args?: string[]) => Promise<unknown>;
let wifiRun: (toolId: string, args?: string[]) => Promise<unknown>;
let credmanRun: (toolId: string, args?: string[]) => Promise<unknown>;
let vaultRun: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const sharedMod = await import('../tools/password/shared.js');
  checkCredentialConsent = sharedMod.checkCredentialConsent;
  writeTempSecure = sharedMod.writeTempSecure;
  logCredentialAccess = sharedMod.logCredentialAccess;

  const ffMod = await import('../tools/password/firefox.js');
  firefoxRun = ffMod.run as unknown as typeof firefoxRun;

  const wifiMod = await import('../tools/password/wifi.js');
  parseNetshProfileList = wifiMod.parseNetshProfileList;
  parseNetshProfileDetail = wifiMod.parseNetshProfileDetail;
  parseNmConnection = wifiMod.parseNmConnection;
  parseWpaSupplicant = wifiMod.parseWpaSupplicant;
  wifiRun = wifiMod.run as unknown as typeof wifiRun;

  const credmanMod = await import('../tools/password/credman.js');
  parseCredmanOutput = credmanMod.parseCredmanOutput;
  credmanRun = credmanMod.run as unknown as typeof credmanRun;

  const vaultMod = await import('../tools/password/vault.js');
  parseVaultOutput = vaultMod.parseVaultOutput;
  vaultRun = vaultMod.run as unknown as typeof vaultRun;

  const chromeMod = await import('../tools/password/chrome.js');
  chromeRun = chromeMod.run as unknown as typeof chromeRun;
});

// ── Consent mechanism ─────────────────────────────────────────────────────────

describe('checkCredentialConsent', () => {
  it('returns warning rows when --allow-credentials is absent', () => {
    const result = checkCredentialConsent([], 'test-tool');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result![0]).toHaveProperty('action', 'consent_required');
    expect(result![0]).toHaveProperty('warning');
  });

  it('returns null when --allow-credentials is present', () => {
    const result = checkCredentialConsent(['--allow-credentials'], 'test-tool');
    expect(result).toBeNull();
  });

  it('consent message references the tool name', () => {
    const result = checkCredentialConsent([], 'wifi-passwords');
    expect(result![0]).toHaveProperty('warning');
    expect(String((result![0] as Record<string, unknown>)['warning'])).toContain('wifi-passwords');
  });
});

// ── writeTempSecure ──────────────────────────────────────────────────────────

describe('writeTempSecure', () => {
  it('creates a file in tmpdir', () => {
    const { path, cleanup } = writeTempSecure('test content');
    try {
      expect(existsSync(path)).toBe(true);
      expect(path.startsWith(tmpdir())).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('cleanup removes the file', () => {
    const { path, cleanup } = writeTempSecure('test content');
    cleanup();
    expect(existsSync(path)).toBe(false);
  });

  it('file contains the written content', () => {
    const { readFileSync } = require('node:fs');
    const { path, cleanup } = writeTempSecure('hello secret');
    try {
      expect(readFileSync(path, 'utf8')).toBe('hello secret');
    } finally {
      cleanup();
    }
  });

  it('works with Buffer content', () => {
    const data = Buffer.from([0x01, 0x02, 0x03]);
    const { readFileSync } = require('node:fs');
    const { path, cleanup } = writeTempSecure(data);
    try {
      const read = readFileSync(path);
      expect(Buffer.compare(read, data)).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('cleanup is idempotent — no error on double call', () => {
    const { path, cleanup } = writeTempSecure('data');
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });
});

// ── logCredentialAccess ───────────────────────────────────────────────────────

describe('logCredentialAccess', () => {
  it('does not throw on normal call', () => {
    expect(() => logCredentialAccess('test-tool')).not.toThrow();
  });
});

// ── Wi-Fi: Windows netsh parser ───────────────────────────────────────────────

describe('parseNetshProfileList', () => {
  it('extracts SSIDs from netsh profile list output', () => {
    const output = `
Profile information on interface Wi-Fi:

Group policy profiles (read only)
---------------------------------
    <None>

User profiles
-------------
    All User Profile     : HomeNetwork
    All User Profile     : WorkWifi
    All User Profile     : GuestNet
`.trim();

    const ssids = parseNetshProfileList(output);
    expect(ssids).toContain('HomeNetwork');
    expect(ssids).toContain('WorkWifi');
    expect(ssids).toContain('GuestNet');
  });

  it('returns empty array for empty output', () => {
    expect(parseNetshProfileList('')).toEqual([]);
  });
});

describe('parseNetshProfileDetail', () => {
  it('extracts Key Content and Authentication', () => {
    const output = `
Profile HomeNetwork on interface Wi-Fi:
=======================================================================

Applied: All User

Profile information
-------------------
    Version                : 1
    Type                   : Wireless LAN
    Name                   : HomeNetwork
    Control options        :

Connectivity settings
---------------------
    Number of SSIDs        : 1
    SSID name              : "HomeNetwork"

Security settings
-----------------
    Authentication         : WPA2-Personal
    Cipher                 : CCMP
    Authentication         : WPA2-Personal
    Cipher                 : GCMP

Security key
------------
    Key Content            : MySecretPassword123
`.trim();

    const { password, security } = parseNetshProfileDetail(output);
    expect(password).toBe('MySecretPassword123');
    expect(security).toBe('WPA2-Personal');
  });

  it('returns empty strings when not found', () => {
    const { password, security } = parseNetshProfileDetail('no matching lines here');
    expect(password).toBe('');
    expect(security).toBe('');
  });
});

// ── Wi-Fi: Linux NetworkManager parser ───────────────────────────────────────

describe('parseNmConnection', () => {
  it('parses INI-format nmconnection file', () => {
    const content = `
[connection]
id=HomeNetwork
type=wifi

[wifi]
ssid=HomeNetwork
mode=infrastructure

[wifi-security]
key-mgmt=wpa-psk
psk=MyPassword123

[ipv4]
method=auto
`.trim();

    const sections = parseNmConnection(content);
    expect(sections['connection']?.['type']).toBe('wifi');
    expect(sections['wifi']?.['ssid']).toBe('HomeNetwork');
    expect(sections['wifi-security']?.['psk']).toBe('MyPassword123');
  });

  it('ignores comment lines', () => {
    const content = `
[connection]
# this is a comment
id=Test
`.trim();
    const sections = parseNmConnection(content);
    expect(sections['connection']?.['id']).toBe('Test');
    expect(Object.keys(sections['connection'] ?? {})).not.toContain('# this is a comment');
  });
});

describe('parseWpaSupplicant', () => {
  it('parses network blocks from wpa_supplicant.conf', () => {
    const content = `
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
  ssid="HomeNetwork"
  psk="SecretPass"
  key_mgmt=WPA-PSK
}

network={
  ssid="OpenNet"
  key_mgmt=NONE
}
`.trim();

    const rows = parseWpaSupplicant(content) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ssid: 'HomeNetwork', password: 'SecretPass', security: 'WPA-PSK' });
    expect(rows[1]).toMatchObject({ ssid: 'OpenNet', security: 'NONE' });
  });

  it('returns empty for empty config', () => {
    expect(parseWpaSupplicant('ctrl_interface=...\n')).toEqual([]);
  });
});

// ── Wi-Fi: cross-platform consent + run ──────────────────────────────────────

describe('wifi-passwords run', () => {
  it('returns consent warning without --allow-credentials', async () => {
    const result = (await wifiRun('wifi-passwords', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('rows');
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows[0]).toHaveProperty('action', 'consent_required');
  });

  it('returns success shape with --allow-credentials on Linux (empty result)', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];
    try {
      const result = (await wifiRun('wifi-passwords', ['--allow-credentials'])) as Record<string, unknown>;
      // On Linux CI without NM, should return empty rows (not error)
      expect(result).toHaveProperty('rows');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });
});

// ── Credential Manager parser ─────────────────────────────────────────────────

describe('parseCredmanOutput', () => {
  it('parses tab-delimited credential entries', () => {
    const output = [
      'https://example.com\tGeneric\tjohn@example.com\tpassword123',
      'TERMSRV/server01\tDomain Password\tDOMAIN\\user\tsecretpass',
    ].join('\n');

    const rows = parseCredmanOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      target: 'https://example.com',
      type: 'Generic',
      user: 'john@example.com',
      credential: 'password123',
      _sensitive: true,
    });
  });

  it('skips lines with empty target', () => {
    const output = '\tGeneric\tuser\tpass';
    expect(parseCredmanOutput(output)).toHaveLength(0);
  });
});

// ── Vault parser ──────────────────────────────────────────────────────────────

describe('parseVaultOutput', () => {
  it('parses tab-delimited vault entries', () => {
    const output = 'https://example.com\tjohnuser\twebpass123\n';
    const rows = parseVaultOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resource: 'https://example.com',
      username: 'johnuser',
      password: 'webpass123',
      _sensitive: true,
    });
  });
});

// ── Platform guards: Windows-only tools on Linux ─────────────────────────────

describe('Platform guards for Windows-only password tools', () => {
  const origPlatform = process.platform;
  const origEnv = process.env['WSL_DISTRO_NAME'];

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    if (origEnv !== undefined) process.env['WSL_DISTRO_NAME'] = origEnv;
  });

  it('browser-chrome-passwords returns PLATFORM_UNSUPPORTED on Linux', async () => {
    const result = (await chromeRun('browser-chrome-passwords', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
  });

  it('credential-manager returns PLATFORM_UNSUPPORTED on Linux', async () => {
    const result = (await credmanRun('credential-manager', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
  });

  it('windows-vault returns PLATFORM_UNSUPPORTED on Linux', async () => {
    const result = (await vaultRun('windows-vault', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
  });
});

// ── Firefox passwords: runs on Linux (cross-platform) ────────────────────────

describe('browser-firefox-passwords run', () => {
  it('returns consent warning without --allow-credentials', async () => {
    const result = (await firefoxRun('browser-firefox-passwords', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('rows');
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows[0]).toHaveProperty('action', 'consent_required');
  });

  it('returns success shape on Linux (no Firefox installed = empty rows)', async () => {
    const result = (await firefoxRun('browser-firefox-passwords', ['--allow-credentials'])) as Record<string, unknown>;
    expect(result).toHaveProperty('rows');
    expect(Array.isArray((result as Record<string, unknown>)['rows'])).toBe(true);
  });
});
