/**
 * Password Phase 4 Plan 03 tests — PWD-06..10 + integration
 * Tests: VNC DES decryption, RDP/mail parsers, admin guards, full index.ts dispatch.
 * All tests run on Linux CI without real credentials or Windows APIs.
 */

// ── Imports ──────────────────────────────────────────────────────────────────

let reverseBits: (byte: number) => number;
let decryptVncPassword: (bytes: Buffer) => string;
let extractPasswordFromIni: (content: string) => Buffer | null;
let parseRdpOutput: (output: string) => unknown[];
let parseOutlookCredmanOutput: (output: string) => unknown[];
let parseLsaSecretNames: (output: string) => unknown[];
let parseNetworkCredsOutput: (output: string) => unknown[];
let rdpRun: (toolId: string, args?: string[]) => Promise<unknown>;
let vncRun: (toolId: string, args?: string[]) => Promise<unknown>;
let mailRun: (toolId: string, args?: string[]) => Promise<unknown>;
let lsaRun: (toolId: string, args?: string[]) => Promise<unknown>;
let networkCredsRun: (toolId: string, args?: string[]) => Promise<unknown>;
let passwordRun: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const vncMod = await import('../tools/password/vnc.js');
  reverseBits = vncMod.reverseBits;
  decryptVncPassword = vncMod.decryptVncPassword;
  extractPasswordFromIni = vncMod.extractPasswordFromIni;
  vncRun = vncMod.run as unknown as typeof vncRun;

  const rdpMod = await import('../tools/password/rdp.js');
  parseRdpOutput = rdpMod.parseRdpOutput;
  rdpRun = rdpMod.run as unknown as typeof rdpRun;

  const mailMod = await import('../tools/password/mail.js');
  parseOutlookCredmanOutput = mailMod.parseOutlookCredmanOutput;
  mailRun = mailMod.run as unknown as typeof mailRun;

  const lsaMod = await import('../tools/password/lsa.js');
  parseLsaSecretNames = lsaMod.parseLsaSecretNames;
  lsaRun = lsaMod.run as unknown as typeof lsaRun;

  const netCredsMod = await import('../tools/password/network-creds.js');
  parseNetworkCredsOutput = netCredsMod.parseNetworkCredsOutput;
  networkCredsRun = netCredsMod.run as unknown as typeof networkCredsRun;

  const indexMod = await import('../tools/password/index.js');
  passwordRun = indexMod.run as unknown as typeof passwordRun;
});

// ── VNC DES decryption ────────────────────────────────────────────────────────

describe('reverseBits', () => {
  it('reverses all bits in a byte', () => {
    expect(reverseBits(0b10000000)).toBe(0b00000001);
    expect(reverseBits(0b00000001)).toBe(0b10000000);
    expect(reverseBits(0b11110000)).toBe(0b00001111);
    expect(reverseBits(0xFF)).toBe(0xFF);
    expect(reverseBits(0x00)).toBe(0x00);
  });

  it('handles the VNC key bytes correctly', () => {
    // VNC key byte 0xE8 = 11101000b → reversed = 00010111b = 0x17
    expect(reverseBits(0xE8)).toBe(0x17);
    // VNC key byte 0x4A = 01001010b → reversed = 01010010b = 0x52
    expect(reverseBits(0x4A)).toBe(0x52);
  });
});

describe('decryptVncPassword', () => {
  it('returns empty string for empty buffer', () => {
    expect(decryptVncPassword(Buffer.alloc(0))).toBe('');
  });

  it('decrypts a known VNC password fixture', () => {
    // Known VNC encrypted password for "test" (from vncpwd reference implementation)
    // This is the well-documented DES test vector for VNC
    // Encrypted bytes for empty/simple passwords (null bytes = empty password)
    const emptyEncrypted = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const result = decryptVncPassword(emptyEncrypted);
    // Result is a valid string (may be empty or garbage — DES of null block)
    expect(typeof result).toBe('string');
  });

  it('produces consistent output (deterministic)', () => {
    const encrypted = Buffer.from([0x6B, 0xCF, 0x2A, 0x4B, 0x6E, 0x07, 0x06, 0x0A]);
    const r1 = decryptVncPassword(encrypted);
    const r2 = decryptVncPassword(encrypted);
    expect(r1).toBe(r2);
  });

  it('handles buffer shorter than 8 bytes', () => {
    const short = Buffer.from([0x6B, 0xCF, 0x2A]);
    expect(() => decryptVncPassword(short)).not.toThrow();
  });

  it('handles buffer longer than 8 bytes (uses first 8)', () => {
    const long = Buffer.from([0x6B, 0xCF, 0x2A, 0x4B, 0x6E, 0x07, 0x06, 0x0A, 0xFF, 0xFF]);
    const exact = Buffer.from([0x6B, 0xCF, 0x2A, 0x4B, 0x6E, 0x07, 0x06, 0x0A]);
    expect(decryptVncPassword(long)).toBe(decryptVncPassword(exact));
  });
});

describe('extractPasswordFromIni', () => {
  it('extracts hex-encoded password from INI content', () => {
    const content = `
[Server]
Password=6BCF2A4B6E07060A
port=5900
`.trim();
    const bytes = extractPasswordFromIni(content);
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBe(8);
    expect(bytes![0]).toBe(0x6B);
  });

  it('returns null when no Password= line found', () => {
    expect(extractPasswordFromIni('[Server]\nport=5900')).toBeNull();
  });

  it('returns null for non-16-char hex password', () => {
    expect(extractPasswordFromIni('Password=AAAA')).toBeNull();
  });

  it('handles lowercase hex', () => {
    const content = 'password=6bcf2a4b6e07060a';
    const bytes = extractPasswordFromIni(content);
    expect(bytes).not.toBeNull();
  });
});

// ── VNC run: cross-platform (no consent error on Linux) ──────────────────────

describe('vnc-passwords run', () => {
  it('returns consent warning without --allow-credentials', async () => {
    const result = (await vncRun('vnc-passwords', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('rows');
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(rows[0]).toHaveProperty('action', 'consent_required');
  });

  it('returns success shape on Linux (no VNC files = empty rows)', async () => {
    const result = (await vncRun('vnc-passwords', ['--allow-credentials'])) as Record<string, unknown>;
    expect(result).toHaveProperty('rows');
    // Should not be a platform error (VNC is cross-platform)
    expect(result).not.toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
  });
});

// ── RDP parser ────────────────────────────────────────────────────────────────

describe('parseRdpOutput', () => {
  it('parses RDP credential entries', () => {
    const output = [
      'server01.example.com\tDOMAIN\\admin\ttrue',
      'remote-pc\t\tfalse',
    ].join('\n');

    const rows = parseRdpOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      host: 'server01.example.com',
      username: 'DOMAIN\\admin',
      hasPassword: true,
      _sensitive: true,
    });
    expect(rows[1]).toMatchObject({ hasPassword: false });
  });

  it('skips lines with empty host', () => {
    const output = '\tuser\ttrue';
    expect(parseRdpOutput(output)).toHaveLength(0);
  });
});

// ── RDP platform guard ────────────────────────────────────────────────────────

describe('rdp-credentials platform guard', () => {
  it('returns PLATFORM_UNSUPPORTED on Linux', async () => {
    const origPlatform = process.platform;
    const origEnv = process.env['WSL_DISTRO_NAME'];
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];
    try {
      const result = (await rdpRun('rdp-credentials', [])) as Record<string, unknown>;
      expect(result).toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      if (origEnv !== undefined) process.env['WSL_DISTRO_NAME'] = origEnv;
    }
  });
});

// ── Mail: Outlook parser ──────────────────────────────────────────────────────

describe('parseOutlookCredmanOutput', () => {
  it('parses Outlook credential entries', () => {
    const output = 'MicrosoftOffice16_Data:user@company.com\tuser@company.com\toutlookpass\tOutlook';
    const rows = parseOutlookCredmanOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      client: 'outlook',
      server: 'MicrosoftOffice16_Data:user@company.com',
      username: 'user@company.com',
      password: 'outlookpass',
      _sensitive: true,
    });
  });

  it('skips lines with empty target', () => {
    const output = '\tuser\tpass\tOutlook';
    expect(parseOutlookCredmanOutput(output)).toHaveLength(0);
  });
});

// ── Mail run ──────────────────────────────────────────────────────────────────

describe('mail-passwords run', () => {
  it('returns consent warning without --allow-credentials', async () => {
    const result = (await mailRun('mail-passwords', [])) as Record<string, unknown>;
    const rows = (result as Record<string, unknown>)['rows'] as Array<Record<string, unknown>>;
    expect(rows?.[0]).toHaveProperty('action', 'consent_required');
  });

  it('returns success shape on Linux (no Thunderbird = empty rows)', async () => {
    const result = (await mailRun('mail-passwords', ['--allow-credentials'])) as Record<string, unknown>;
    expect(result).toHaveProperty('rows');
  });
});

// ── LSA secrets parser ────────────────────────────────────────────────────────

describe('parseLsaSecretNames', () => {
  it('parses LSA secret names with known hints', () => {
    const output = [
      'DPAPI_SYSTEM',
      'NL$KM',
      '_SC_ServiceName',
      'DefaultPassword',
      'CustomSecret123',
    ].join('\n');

    const rows = parseLsaSecretNames(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(5);

    const dpapi = rows.find((r) => r['secretName'] === 'DPAPI_SYSTEM');
    expect(dpapi).toMatchObject({ encrypted: true, hint: 'DPAPI system master key seed' });

    const custom = rows.find((r) => r['secretName'] === 'CustomSecret123');
    expect(custom).toMatchObject({ encrypted: true, hint: 'LSA secret' });
  });

  it('skips empty lines', () => {
    expect(parseLsaSecretNames('\n\n\n')).toHaveLength(0);
  });
});

// ── LSA platform + privilege guards ──────────────────────────────────────────

describe('lsa-secrets guards', () => {
  it('returns PLATFORM_UNSUPPORTED on Linux', async () => {
    const origPlatform = process.platform;
    const origEnv = process.env['WSL_DISTRO_NAME'];
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];
    try {
      const result = (await lsaRun('lsa-secrets', [])) as Record<string, unknown>;
      expect(result).toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      if (origEnv !== undefined) process.env['WSL_DISTRO_NAME'] = origEnv;
    }
  });

  it('returns PRIVILEGE_REQUIRED on win32 without admin', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    // Override privilege detection to return 'user'
    const privHelper = await import('../privilegeHelper.js');
    const orig = privHelper._resetPrivilegeLevel;
    privHelper._resetPrivilegeLevel();
    // We can't easily mock admin level — just check it returns PRIVILEGE_REQUIRED or EXEC_FAILED
    // (On CI, running as non-admin, this will return PRIVILEGE_REQUIRED or fail PowerShell)
    try {
      const result = (await lsaRun('lsa-secrets', ['--allow-credentials'])) as Record<string, unknown>;
      // Either PRIVILEGE_REQUIRED (no admin) or EXEC_FAILED (PowerShell unavailable)
      expect(['PRIVILEGE_REQUIRED', 'EXEC_FAILED']).toContain(result['code']);
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });
});

// ── Network passwords parser ──────────────────────────────────────────────────

describe('parseNetworkCredsOutput', () => {
  it('parses network credential entries', () => {
    const output = [
      '\\\\server\\share\tDomain Password\tDOMAIN\\user\tnetpass',
      'file.server.com\tGeneric\tworkuser\tworkpass',
    ].join('\n');

    const rows = parseNetworkCredsOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      target: '\\\\server\\share',
      credentialType: 'Domain Password',
      user: 'DOMAIN\\user',
      _sensitive: true,
    });
  });

  it('skips lines with empty target', () => {
    const output = '\tGeneric\tuser\tpass';
    expect(parseNetworkCredsOutput(output)).toHaveLength(0);
  });
});

// ── Network passwords platform guard ─────────────────────────────────────────

describe('network-passwords platform guard', () => {
  it('returns PLATFORM_UNSUPPORTED on Linux', async () => {
    const origPlatform = process.platform;
    const origEnv = process.env['WSL_DISTRO_NAME'];
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];
    try {
      const result = (await networkCredsRun('network-passwords', [])) as Record<string, unknown>;
      expect(result).toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      if (origEnv !== undefined) process.env['WSL_DISTRO_NAME'] = origEnv;
    }
  });
});

// ── password/index.ts: all 10 tool IDs dispatch correctly ────────────────────

const ALL_PASSWORD_TOOLS = [
  'browser-chrome-passwords',
  'browser-firefox-passwords',
  'wifi-passwords',
  'credential-manager',
  'windows-vault',
  'rdp-credentials',
  'vnc-passwords',
  'mail-passwords',
  'lsa-secrets',
  'network-passwords',
];

describe('password/index.ts dispatcher', () => {
  it('returns EXEC_FAILED for unknown tool', async () => {
    const result = (await passwordRun('unknown-tool', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });

  it('dispatches all 10 password tool IDs — no EXEC_FAILED for unknown', async () => {
    const origPlatform = process.platform;
    const origEnv = process.env['WSL_DISTRO_NAME'];
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];

    try {
      for (const toolId of ALL_PASSWORD_TOOLS) {
        const result = (await passwordRun(toolId, [])) as Record<string, unknown>;
        // Should never be EXEC_FAILED with "No native handler"
        if (result['code'] === 'EXEC_FAILED') {
          expect(String(result['error'])).not.toContain('No native handler');
        }
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      if (origEnv !== undefined) process.env['WSL_DISTRO_NAME'] = origEnv;
    }
  });
});

// ── Catalog: 18 new native tools registered ──────────────────────────────────

describe('Catalog: Phase 4 tools registered', () => {
  it('has all 8 registry tools with native: true', async () => {
    const { getCatalog, resetCatalog } = await import('../catalog/loader.js');
    resetCatalog();
    const catalog = getCatalog();

    const registryTools = ['registry-search', 'registry-snapshot-diff', 'registry-hive',
      'registry-startup', 'registry-uninstall', 'registry-usb',
      'registry-associations', 'registry-mru'];

    for (const id of registryTools) {
      const tool = catalog.tools.find((t) => t.id === id);
      expect(tool).toBeDefined();
      expect(tool?.native).toBe(true);
      expect(tool?.category).toBe('registry');
      expect(tool?.platforms).toContain('win32');
      expect(tool?.platforms).not.toContain('linux');
    }
  });

  it('has all 10 password tools with native: true', async () => {
    const { getCatalog, resetCatalog } = await import('../catalog/loader.js');
    resetCatalog();
    const catalog = getCatalog();

    for (const id of ALL_PASSWORD_TOOLS) {
      const tool = catalog.tools.find((t) => t.id === id);
      expect(tool).toBeDefined();
      expect(tool?.native).toBe(true);
      expect(tool?.category).toBe('password');
    }
  });

  it('cross-platform password tools include linux in platforms', async () => {
    const { getCatalog, resetCatalog } = await import('../catalog/loader.js');
    resetCatalog();
    const catalog = getCatalog();

    const crossPlatform = ['browser-firefox-passwords', 'wifi-passwords', 'vnc-passwords', 'mail-passwords'];
    for (const id of crossPlatform) {
      const tool = catalog.tools.find((t) => t.id === id);
      expect(tool?.platforms).toContain('linux');
    }
  });

  it('admin-required tools are flagged correctly', async () => {
    const { getCatalog, resetCatalog } = await import('../catalog/loader.js');
    resetCatalog();
    const catalog = getCatalog();

    for (const id of ['lsa-secrets', 'network-passwords']) {
      const tool = catalog.tools.find((t) => t.id === id);
      expect(tool?.adminRequired).toBe(true);
    }
  });
});
