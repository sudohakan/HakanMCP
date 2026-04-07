/**
 * Registry Phase 4 Plan 01 tests — REG-01..08
 * Tests: platform guards, parser functions, snapshot diff logic.
 * All tests run on Linux CI without Windows registry access.
 */

// ── Imports ──────────────────────────────────────────────────────────────────

let parseRegistrySearchOutput: (output: string) => unknown[];
let parseSnapshotOutput: (output: string) => unknown[];
let diffSnapshots: (before: unknown[], after: unknown[]) => unknown[];
let parseHiveOutput: (output: string) => unknown[];
let parseStartupOutput: (output: string) => unknown[];
let parseUninstallOutput: (output: string) => unknown[];
let parseUsbOutput: (output: string) => unknown[];
let parseAssociationsOutput: (output: string) => unknown[];
let parseMruOutput: (output: string) => unknown[];
let searchRun: (toolId: string, args?: string[]) => Promise<unknown>;
let snapshotRun: (toolId: string, args?: string[]) => Promise<unknown>;
let hiveRun: (toolId: string, args?: string[]) => Promise<unknown>;
let startupRun: (toolId: string, args?: string[]) => Promise<unknown>;
let uninstallRun: (toolId: string, args?: string[]) => Promise<unknown>;
let usbRun: (toolId: string, args?: string[]) => Promise<unknown>;
let associationsRun: (toolId: string, args?: string[]) => Promise<unknown>;
let mruRun: (toolId: string, args?: string[]) => Promise<unknown>;
let registryRun: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const searchMod = await import('../tools/registry/search.js');
  parseRegistrySearchOutput = searchMod.parseRegistrySearchOutput;
  searchRun = searchMod.run as unknown as typeof searchRun;

  const snapshotMod = await import('../tools/registry/snapshot.js');
  parseSnapshotOutput = snapshotMod.parseSnapshotOutput;
  diffSnapshots = snapshotMod.diffSnapshots as typeof diffSnapshots;
  snapshotRun = snapshotMod.run as unknown as typeof snapshotRun;

  const hiveMod = await import('../tools/registry/hive.js');
  parseHiveOutput = hiveMod.parseHiveOutput;
  hiveRun = hiveMod.run as unknown as typeof hiveRun;

  const startupMod = await import('../tools/registry/startup.js');
  parseStartupOutput = startupMod.parseStartupOutput;
  startupRun = startupMod.run as unknown as typeof startupRun;

  const uninstallMod = await import('../tools/registry/uninstall.js');
  parseUninstallOutput = uninstallMod.parseUninstallOutput;
  uninstallRun = uninstallMod.run as unknown as typeof uninstallRun;

  const usbMod = await import('../tools/registry/usb.js');
  parseUsbOutput = usbMod.parseUsbOutput;
  usbRun = usbMod.run as unknown as typeof usbRun;

  const assocMod = await import('../tools/registry/associations.js');
  parseAssociationsOutput = assocMod.parseAssociationsOutput;
  associationsRun = assocMod.run as unknown as typeof associationsRun;

  const mruMod = await import('../tools/registry/mru.js');
  parseMruOutput = mruMod.parseMruOutput;
  mruRun = mruMod.run as unknown as typeof mruRun;

  const indexMod = await import('../tools/registry/index.js');
  registryRun = indexMod.run as unknown as typeof registryRun;
});

// ── Platform guards (all tools return PLATFORM_UNSUPPORTED on Linux) ─────────

const REGISTRY_TOOLS = [
  'registry-search',
  'registry-snapshot-diff',
  'registry-hive',
  'registry-startup',
  'registry-uninstall',
  'registry-usb',
  'registry-associations',
  'registry-mru',
];

describe('Platform guards — Linux returns PLATFORM_UNSUPPORTED', () => {
  const origPlatform = process.platform;
  const origEnv = process.env['WSL_DISTRO_NAME'];

  beforeEach(() => {
    // Simulate plain Linux (not WSL)
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    if (origEnv !== undefined) {
      process.env['WSL_DISTRO_NAME'] = origEnv;
    }
  });

  for (const toolId of REGISTRY_TOOLS) {
    it(`${toolId} returns PLATFORM_UNSUPPORTED on Linux`, async () => {
      const result = (await registryRun(toolId, [])) as Record<string, unknown>;
      expect(result).toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
      expect(result).toHaveProperty('tool', toolId);
    });
  }
});

// ── REG-01: registry-search parser ───────────────────────────────────────────

describe('parseRegistrySearchOutput', () => {
  it('parses tab-delimited search output', () => {
    const output = [
      'HKLM\tSOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\tProductName\tString\tWindows 10',
      'HKCU\tSOFTWARE\\Test\tMyValue\tDWORD\t42',
    ].join('\n');

    const rows = parseRegistrySearchOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      hive: 'HKLM',
      key: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',
      valueName: 'ProductName',
      valueType: 'String',
      valueData: 'Windows 10',
    });
    expect(rows[1]).toMatchObject({
      hive: 'HKCU',
      valueName: 'MyValue',
      valueData: '42',
    });
  });

  it('skips lines with insufficient fields', () => {
    const output = 'HKLM\tSomePath\n\nHKCU\tOther\tName\tType\tData';
    const rows = parseRegistrySearchOutput(output);
    expect(rows).toHaveLength(1);
  });

  it('returns empty array for empty output', () => {
    expect(parseRegistrySearchOutput('')).toEqual([]);
    expect(parseRegistrySearchOutput('\n\n')).toEqual([]);
  });
});

// ── REG-01: registry-search requires --pattern ────────────────────────────────

describe('registry-search run', () => {
  it('returns EXEC_FAILED when --pattern is missing (platform check skipped on win32)', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const result = (await searchRun('registry-search', [])) as Record<string, unknown>;
      // On win32 without --pattern, should return EXEC_FAILED
      expect(result).toHaveProperty('code', 'EXEC_FAILED');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });
});

// ── REG-02: parseSnapshotOutput ──────────────────────────────────────────────

describe('parseSnapshotOutput', () => {
  it('parses tab-delimited snapshot output', () => {
    const output = [
      'HKLM\\SOFTWARE\\Test\tMyVal\tString\tHello',
      'HKLM\\SOFTWARE\\Other\tNum\tDWORD\t100',
    ].join('\n');

    const rows = parseSnapshotOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: 'HKLM\\SOFTWARE\\Test',
      valueName: 'MyVal',
      valueType: 'String',
      valueData: 'Hello',
    });
  });

  it('returns empty for empty input', () => {
    expect(parseSnapshotOutput('')).toEqual([]);
  });
});

// ── REG-02: diffSnapshots ────────────────────────────────────────────────────

describe('diffSnapshots', () => {
  const makeEntry = (key: string, name: string, data: string) => ({
    key,
    valueName: name,
    valueType: 'String',
    valueData: data,
  });

  it('detects added entry', () => {
    const before = [makeEntry('HKLM\\A', 'Val1', 'OldData')];
    const after = [makeEntry('HKLM\\A', 'Val1', 'OldData'), makeEntry('HKLM\\B', 'Val2', 'NewData')];

    const diff = diffSnapshots(before, after) as Array<Record<string, unknown>>;
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ change: 'added', key: 'HKLM\\B', valueName: 'Val2', after: 'NewData' });
  });

  it('detects removed entry', () => {
    const before = [makeEntry('HKLM\\A', 'Val1', 'Data'), makeEntry('HKLM\\B', 'Val2', 'Data2')];
    const after = [makeEntry('HKLM\\A', 'Val1', 'Data')];

    const diff = diffSnapshots(before, after) as Array<Record<string, unknown>>;
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ change: 'removed', valueName: 'Val2', before: 'Data2' });
  });

  it('detects changed entry', () => {
    const before = [makeEntry('HKLM\\A', 'Val1', 'OldValue')];
    const after = [makeEntry('HKLM\\A', 'Val1', 'NewValue')];

    const diff = diffSnapshots(before, after) as Array<Record<string, unknown>>;
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ change: 'changed', before: 'OldValue', after: 'NewValue' });
  });

  it('returns empty diff for identical snapshots', () => {
    const snap = [makeEntry('HKLM\\A', 'Val1', 'Same'), makeEntry('HKLM\\B', 'Val2', 'Same2')];
    expect(diffSnapshots(snap, snap)).toEqual([]);
  });

  it('handles multiple changes simultaneously', () => {
    const before = [
      makeEntry('HKLM\\A', 'V1', 'old'),
      makeEntry('HKLM\\B', 'V2', 'data'),
    ];
    const after = [
      makeEntry('HKLM\\A', 'V1', 'new'),
      makeEntry('HKLM\\C', 'V3', 'added'),
    ];

    const diff = diffSnapshots(before, after) as Array<Record<string, unknown>>;
    const changes = diff.map((d) => d['change']);
    expect(changes).toContain('removed');
    expect(changes).toContain('changed');
    expect(changes).toContain('added');
  });
});

// ── REG-03: parseHiveOutput ───────────────────────────────────────────────────

describe('parseHiveOutput', () => {
  it('parses tab-delimited hive output', () => {
    const output = 'SOFTWARE\\Microsoft\tProductName\tString\tWindows 10\n';
    const rows = parseHiveOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'SOFTWARE\\Microsoft', valueName: 'ProductName' });
  });
});

// ── REG-04: parseStartupOutput ────────────────────────────────────────────────

describe('parseStartupOutput', () => {
  it('parses startup entries with runOnce flag', () => {
    const output = [
      'HKLM\tSOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run\tMyApp\tC:\\MyApp.exe\tfalse',
      'HKCU\tSOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce\tUpdater\tC:\\Update.exe\ttrue',
    ].join('\n');

    const rows = parseStartupOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ hive: 'HKLM', name: 'MyApp', runOnce: false });
    expect(rows[1]).toMatchObject({ hive: 'HKCU', name: 'Updater', runOnce: true });
  });

  it('skips lines with empty name', () => {
    const output = 'HKLM\tSOFTWARE\\Run\t\tC:\\App.exe\tfalse';
    expect(parseStartupOutput(output)).toHaveLength(0);
  });
});

// ── REG-05: parseUninstallOutput ─────────────────────────────────────────────

describe('parseUninstallOutput', () => {
  it('parses uninstall entries', () => {
    const output = 'Visual Studio Code\tMicrosoft\t1.85.0\t20240101\tC:\\VSCode\tC:\\VSCode\\uninstall.exe\ttrue';
    const rows = parseUninstallOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      displayName: 'Visual Studio Code',
      publisher: 'Microsoft',
      version: '1.85.0',
      is64Bit: true,
    });
  });

  it('skips entries with empty displayName', () => {
    const output = '\tPublisher\t1.0\t20240101\t\t\tfalse';
    expect(parseUninstallOutput(output)).toHaveLength(0);
  });
});

// ── REG-06: parseUsbOutput ────────────────────────────────────────────────────

describe('parseUsbOutput', () => {
  it('parses USB entries', () => {
    const output = 'USBSTOR\tDisk&Ven_Samsung&Prod_T7\tSamsung T7\tSamsung\tusbstor';
    const rows = parseUsbOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deviceClass: 'USBSTOR',
      deviceId: 'Disk&Ven_Samsung&Prod_T7',
      friendlyName: 'Samsung T7',
    });
  });

  it('skips lines with empty deviceId', () => {
    const output = 'USB\t\tfriendly\tmfg\tsvc';
    expect(parseUsbOutput(output)).toHaveLength(0);
  });
});

// ── REG-07: parseAssociationsOutput ──────────────────────────────────────────

describe('parseAssociationsOutput', () => {
  it('parses file association rows', () => {
    const output = '.pdf\tAcroExch.Document.DC\tAdobe Acrobat Document\t"C:\\Acrobat.exe" "%1"';
    const rows = parseAssociationsOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      extension: '.pdf',
      progId: 'AcroExch.Document.DC',
      description: 'Adobe Acrobat Document',
    });
  });

  it('skips lines with empty extension', () => {
    const output = '\tsome.progid\tdesc\tcmd';
    expect(parseAssociationsOutput(output)).toHaveLength(0);
  });
});

// ── REG-08: parseMruOutput ────────────────────────────────────────────────────

describe('parseMruOutput', () => {
  it('parses MRU rows', () => {
    const output = [
      '.docx\t0\tC:\\Users\\Test\\Documents\\report.docx',
      '.pdf\t1\tC:\\Users\\Test\\Downloads\\manual.pdf',
    ].join('\n');

    const rows = parseMruOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ extension: '.docx', slot: 0, path: 'C:\\Users\\Test\\Documents\\report.docx' });
    expect(rows[1]).toMatchObject({ extension: '.pdf', slot: 1 });
  });

  it('skips entries with empty path', () => {
    const output = '.pdf\t0\t';
    expect(parseMruOutput(output)).toHaveLength(0);
  });
});

// ── Category dispatcher: index.ts covers all 8 tool IDs ──────────────────────

describe('registry/index.ts dispatcher', () => {
  it('returns EXEC_FAILED for unknown tool ID', async () => {
    const result = (await registryRun('unknown-tool', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });

  it('dispatches all 8 known registry tool IDs without EXEC_FAILED for unknown', async () => {
    // On Linux, all tools return PLATFORM_UNSUPPORTED — but they are dispatched (not EXEC_FAILED unknown)
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];

    try {
      for (const toolId of REGISTRY_TOOLS) {
        const result = (await registryRun(toolId, [])) as Record<string, unknown>;
        // Must be platform error, NOT exec_failed "no handler"
        expect(result['code']).not.toBe('EXEC_FAILED');
        expect(result['code']).toBe('PLATFORM_UNSUPPORTED');
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });
});

// ── Snapshot run: requires args ──────────────────────────────────────────────

describe('registry-snapshot-diff run', () => {
  it('returns EXEC_FAILED without required args (on win32)', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const result = (await snapshotRun('registry-snapshot-diff', [])) as Record<string, unknown>;
      expect(result).toHaveProperty('code', 'EXEC_FAILED');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });
});
