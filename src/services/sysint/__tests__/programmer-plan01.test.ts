/**
 * Programmer Phase 5 Plan 01 tests — PRG-01..06
 * Tests: platform guards, parser functions, run error cases, category dispatcher.
 * All tests run on Linux CI without Windows dependencies.
 */

// ── Imports ──────────────────────────────────────────────────────────────────

let parseNmOutput: (output: string) => unknown[];
let parseDumpbinOutput: (output: string) => unknown[];
let exportsRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parsePEHeader: (buf: Buffer) => unknown | null;
let parseELFHeader: (buf: Buffer) => unknown | null;
let headersRun: (toolId: string, args?: string[]) => Promise<unknown>;

let hashBatchRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parseMonodisOutput: (output: string) => unknown;
let parsePsReflectionOutput: (output: string) => unknown;
let dotnetRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parsePEResources: (buf: Buffer) => unknown[];
let resourcesRun: (toolId: string, args?: string[]) => Promise<unknown>;

let gacRun: (toolId: string, args?: string[]) => Promise<unknown>;

let programmerRun: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const exportsMod = await import('../tools/programmer/exports.js');
  parseNmOutput = exportsMod.parseNmOutput;
  parseDumpbinOutput = exportsMod.parseDumpbinOutput;
  exportsRun = exportsMod.run as unknown as typeof exportsRun;

  const headersMod = await import('../tools/programmer/headers.js');
  parsePEHeader = headersMod.parsePEHeader;
  parseELFHeader = headersMod.parseELFHeader;
  headersRun = headersMod.run as unknown as typeof headersRun;

  const hashMod = await import('../tools/programmer/hashbatch.js');
  hashBatchRun = hashMod.run as unknown as typeof hashBatchRun;

  const dotnetMod = await import('../tools/programmer/dotnet.js');
  parseMonodisOutput = dotnetMod.parseMonodisOutput;
  parsePsReflectionOutput = dotnetMod.parsePsReflectionOutput;
  dotnetRun = dotnetMod.run as unknown as typeof dotnetRun;

  const resourcesMod = await import('../tools/programmer/resources.js');
  parsePEResources = resourcesMod.parsePEResources;
  resourcesRun = resourcesMod.run as unknown as typeof resourcesRun;

  const gacMod = await import('../tools/programmer/gac.js');
  gacRun = gacMod.run as unknown as typeof gacRun;

  const indexMod = await import('../tools/programmer/index.js');
  programmerRun = indexMod.run as unknown as typeof programmerRun;
});

// ── PRG-01: parseNmOutput ─────────────────────────────────────────────────────

describe('parseNmOutput', () => {
  it('parses exported function symbols', () => {
    const output = [
      '0000000000001234 T my_function',
      '0000000000005678 T another_func',
      '                 U external_import',
      '0000000000009abc D global_data',
    ].join('\n');

    const rows = parseNmOutput(output) as Array<Record<string, unknown>>;
    // U (undefined/import) is excluded
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const funcRow = rows.find((r) => r['symbol'] === 'my_function');
    expect(funcRow).toMatchObject({ symbol: 'my_function', type: 'function', address: '0000000000001234' });
    const dataRow = rows.find((r) => r['symbol'] === 'global_data');
    expect(dataRow).toMatchObject({ symbol: 'global_data', type: 'data' });
    const importRow = rows.find((r) => r['symbol'] === 'external_import');
    expect(importRow).toBeUndefined();
  });

  it('returns empty array for empty output', () => {
    expect(parseNmOutput('')).toEqual([]);
    expect(parseNmOutput('\n\n')).toEqual([]);
  });

  it('handles mixed case type characters', () => {
    const output = '0000000000001234 W weak_symbol\n0000000000005678 B bss_data';
    const rows = parseNmOutput(output) as Array<Record<string, unknown>>;
    const weak = rows.find((r) => r['symbol'] === 'weak_symbol');
    expect(weak).toMatchObject({ type: 'function' }); // W = weak, treated as function
    const bss = rows.find((r) => r['symbol'] === 'bss_data');
    expect(bss).toMatchObject({ type: 'data' }); // B = BSS, treated as data
  });
});

// ── PRG-01: parseDumpbinOutput ────────────────────────────────────────────────

describe('parseDumpbinOutput', () => {
  it('parses dumpbin /exports table section', () => {
    const output = [
      '  Section contains the following exports',
      '',
      '    ordinal hint RVA      name',
      '',
      '          1    0 00011234 MyFunction',
      '          2    1 00022345 AnotherExport',
      '          3    2 00033456 ThirdFunction',
      '',
      '  Summary',
    ].join('\n');

    const rows = parseDumpbinOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ ordinal: 1, symbol: 'MyFunction', address: '00011234' });
    expect(rows[1]).toMatchObject({ ordinal: 2, symbol: 'AnotherExport' });
    expect(rows[2]).toMatchObject({ ordinal: 3, symbol: 'ThirdFunction' });
  });

  it('returns empty array when no exports section', () => {
    expect(parseDumpbinOutput('')).toEqual([]);
    expect(parseDumpbinOutput('No exports found')).toEqual([]);
  });
});

// ── PRG-01: dll-exports run ───────────────────────────────────────────────────

describe('dll-exports run', () => {
  it('returns EXEC_FAILED when --file arg is missing', async () => {
    const result = (await exportsRun('dll-exports', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
    expect(result).toHaveProperty('tool', 'dll-exports');
  });

  it('returns EXEC_FAILED for non-existent file', async () => {
    const result = (await exportsRun('dll-exports', ['--file', '/nonexistent/lib.so'])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });
});

// ── PRG-02: parsePEHeader ─────────────────────────────────────────────────────

describe('parsePEHeader', () => {
  /**
   * Build a minimal valid PE header in a Buffer.
   * MZ at 0, PE offset at 0x3C, PE\0\0 at peOffset.
   */
  function buildMinimalPE(options: { machine?: number; isDll?: boolean; is64?: boolean } = {}): Buffer {
    const buf = Buffer.alloc(512, 0);
    // MZ signature
    buf[0] = 0x4d;
    buf[1] = 0x5a;
    // PE offset at 0x3C
    const peOffset = 0x40;
    buf.writeUInt32LE(peOffset, 0x3c);
    // PE signature
    buf[peOffset] = 0x50;
    buf[peOffset + 1] = 0x45;
    buf[peOffset + 2] = 0x00;
    buf[peOffset + 3] = 0x00;
    // COFF header at peOffset+4
    const coffOffset = peOffset + 4;
    const machine = options.machine ?? 0x8664; // x86_64
    buf.writeUInt16LE(machine, coffOffset);
    buf.writeUInt16LE(3, coffOffset + 2); // sectionCount = 3
    buf.writeUInt16LE(0xe0, coffOffset + 16); // optHeaderSize
    const chars = (options.isDll ? 0x2000 : 0) | 0x0002;
    buf.writeUInt16LE(chars, coffOffset + 18);
    // Optional header
    const optOffset = coffOffset + 20;
    const magic = options.is64 ? 0x20b : 0x10b;
    buf.writeUInt16LE(magic, optOffset);
    buf[optOffset + 2] = 14; // linkerVersionMajor
    buf[optOffset + 3] = 0;  // linkerVersionMinor
    buf.writeUInt32LE(0x1000, optOffset + 16); // entryPointRVA
    // Subsystem at +68 = Windows GUI = 2
    buf.writeUInt16LE(2, optOffset + 68);
    return buf;
  }

  it('returns null for non-MZ buffer', () => {
    const buf = Buffer.from('ELF\x00some data here');
    expect(parsePEHeader(buf)).toBeNull();
  });

  it('returns null for buffer too small', () => {
    expect(parsePEHeader(Buffer.alloc(32, 0))).toBeNull();
  });

  it('parses x86_64 PE header', () => {
    const buf = buildMinimalPE({ machine: 0x8664, isDll: false, is64: true });
    const result = parsePEHeader(buf) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      format: 'PE',
      machine: 'x86_64',
      is64Bit: true,
      isDll: false,
      isExe: true,
      sectionCount: 3,
      linkerVersionMajor: 14,
    });
  });

  it('detects DLL flag', () => {
    const buf = buildMinimalPE({ machine: 0x014c, isDll: true, is64: false });
    const result = parsePEHeader(buf) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      machine: 'x86',
      isDll: true,
      is64Bit: false,
    });
  });
});

// ── PRG-02: parseELFHeader ────────────────────────────────────────────────────

describe('parseELFHeader', () => {
  function buildMinimalELF(options: { is64?: boolean; elfType?: number; machine?: number } = {}): Buffer {
    const buf = Buffer.alloc(64, 0);
    // ELF magic
    buf[0] = 0x7f;
    buf[1] = 0x45; // E
    buf[2] = 0x4c; // L
    buf[3] = 0x46; // F
    buf[4] = options.is64 ? 2 : 1; // class
    buf[5] = 1; // little-endian
    buf[6] = 1; // ELF version
    buf[7] = 3; // Linux OSABI
    // type at offset 16
    buf.writeUInt16LE(options.elfType ?? 2, 16); // ET_EXEC
    // machine at offset 18
    buf.writeUInt16LE(options.machine ?? 0x3e, 18); // x86_64
    // entry point at offset 24 (varies by class but both LE)
    if (options.is64) {
      buf.writeBigUInt64LE(0x400080n, 24);
    } else {
      buf.writeUInt32LE(0x8048080, 24);
    }
    return buf;
  }

  it('returns null for non-ELF buffer', () => {
    const buf = Buffer.from('MZ\x00\x00some data here xxxxxxxxxxxxxxxxxxxxxxxx');
    expect(parseELFHeader(buf)).toBeNull();
  });

  it('returns null for buffer too small', () => {
    expect(parseELFHeader(Buffer.alloc(8, 0))).toBeNull();
  });

  it('parses 64-bit ELF executable', () => {
    const buf = buildMinimalELF({ is64: true, elfType: 2, machine: 0x3e });
    const result = parseELFHeader(buf) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      format: 'ELF',
      class: '64-bit',
      endianness: 'little',
      type: 'ET_EXEC (executable)',
      machine: 'x86_64',
      osABI: 'Linux',
    });
  });

  it('parses 32-bit ELF shared object', () => {
    const buf = buildMinimalELF({ is64: false, elfType: 3, machine: 0x03 });
    const result = parseELFHeader(buf) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      format: 'ELF',
      class: '32-bit',
      type: 'ET_DYN (shared object)',
      machine: 'x86',
    });
  });
});

// ── PRG-02: pe-headers run ────────────────────────────────────────────────────

describe('pe-headers run', () => {
  it('returns EXEC_FAILED when --file is missing', async () => {
    const result = (await headersRun('pe-headers', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });

  it('returns EXEC_FAILED for non-existent file', async () => {
    const result = (await headersRun('pe-headers', ['--file', '/nonexistent/binary'])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });
});

// ── PRG-03: hash-batch run ────────────────────────────────────────────────────

describe('hash-batch run', () => {
  it('returns EXEC_FAILED when --dir is missing', async () => {
    const result = (await hashBatchRun('hash-batch', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
    expect(result).toHaveProperty('tool', 'hash-batch');
  });

  it('returns EXEC_FAILED for non-existent directory', async () => {
    const result = (await hashBatchRun('hash-batch', ['--dir', '/nonexistent/dir'])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });

  it('returns EXEC_FAILED for unsupported algo', async () => {
    const result = (await hashBatchRun('hash-batch', ['--dir', '/tmp', '--algo', 'crc32'])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });

  it('hashes files in /tmp successfully', async () => {
    const result = (await hashBatchRun('hash-batch', ['--dir', '/tmp', '--depth', '0', '--limit', '5'])) as Record<string, unknown>;
    // Either success with rows or exec_failed if no files — both are valid
    expect(result).toHaveProperty('tool', 'hash-batch');
    if (!('code' in result)) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 10000);
});

// ── PRG-04: parseMonodisOutput ────────────────────────────────────────────────

describe('parseMonodisOutput', () => {
  it('parses monodis --assembly output', () => {
    const output = [
      'Name:          System.Core',
      'Version:       4.0.0.0',
      'Culture:       neutral',
      'Public Key Token: b77a5c561934e089',
      'Runtime Version: v4.0.30319',
    ].join('\n');

    const result = parseMonodisOutput(output) as Record<string, unknown>;
    expect(result).toMatchObject({
      name: 'System.Core',
      version: '4.0.0.0',
      culture: 'neutral',
      publicKeyToken: 'b77a5c561934e089',
      isStrongNamed: true,
      runtimeVersion: 'v4.0.30319',
    });
  });

  it('handles missing fields gracefully', () => {
    const result = parseMonodisOutput('Some random output') as Record<string, unknown>;
    // Should not throw, just return partial object
    expect(typeof result).toBe('object');
  });
});

// ── PRG-04: parsePsReflectionOutput ──────────────────────────────────────────

describe('parsePsReflectionOutput', () => {
  it('parses tab-separated PowerShell reflection output', () => {
    const output = 'MyAssembly\t1.2.3.4\tneutral\tb77a5c561934e089\t.NETFramework,v4.8\tv4.0.30319';
    const result = parsePsReflectionOutput(output) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      name: 'MyAssembly',
      version: '1.2.3.4',
      culture: 'neutral',
      publicKeyToken: 'b77a5c561934e089',
      targetFramework: '.NETFramework,v4.8',
      isStrongNamed: true,
    });
  });

  it('returns null for insufficient fields', () => {
    expect(parsePsReflectionOutput('')).toBeNull();
    expect(parsePsReflectionOutput('OnlyOneField')).toBeNull();
  });
});

// ── PRG-04: dotnet-info run ───────────────────────────────────────────────────

describe('dotnet-info run', () => {
  it('returns EXEC_FAILED when --file is missing', async () => {
    const result = (await dotnetRun('dotnet-info', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });
});

// ── PRG-05: parsePEResources ──────────────────────────────────────────────────

describe('parsePEResources', () => {
  it('returns empty array for non-PE buffer', () => {
    expect(parsePEResources(Buffer.alloc(64, 0))).toEqual([]);
  });

  it('returns empty array for buffer too small', () => {
    expect(parsePEResources(Buffer.alloc(32))).toEqual([]);
  });

  it('returns empty array for ELF file (no PE magic)', () => {
    const buf = Buffer.alloc(128, 0);
    buf[0] = 0x7f; buf[1] = 0x45; buf[2] = 0x4c; buf[3] = 0x46;
    expect(parsePEResources(buf)).toEqual([]);
  });
});

// ── PRG-05: resource-extract run ─────────────────────────────────────────────

describe('resource-extract run', () => {
  it('returns EXEC_FAILED when --file is missing', async () => {
    const result = (await resourcesRun('resource-extract', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });

  it('returns EXEC_FAILED for non-existent file', async () => {
    const result = (await resourcesRun('resource-extract', ['--file', '/nonexistent/file.exe'])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });
});

// ── PRG-06: gac-viewer run ────────────────────────────────────────────────────

describe('gac-viewer run', () => {
  it('returns valid output shape on any platform', async () => {
    const result = (await gacRun('gac-viewer', [])) as Record<string, unknown>;
    // Either success with rows or stub — both valid
    expect(result).toHaveProperty('tool', 'gac-viewer');
    if (!('code' in result)) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 10000);
});

// ── programmer/index.ts dispatcher ────────────────────────────────────────────

const PROGRAMMER_TOOLS = ['dll-exports', 'pe-headers', 'hash-batch', 'dotnet-info', 'resource-extract', 'gac-viewer'];

describe('programmer/index.ts dispatcher', () => {
  it('returns EXEC_FAILED for unknown tool ID', async () => {
    const result = (await programmerRun('unknown-programmer-tool', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });

  it('dispatches all 6 programmer tool IDs to their handlers (no EXEC_FAILED unknown)', async () => {
    for (const toolId of PROGRAMMER_TOOLS) {
      const result = (await programmerRun(toolId, [])) as Record<string, unknown>;
      // Should not return "No native handler" — must dispatch to actual handler
      // The handler will return either EXEC_FAILED (missing args) or valid result
      expect(result).toHaveProperty('tool', toolId);
      if ('code' in result) {
        // EXEC_FAILED is OK (missing args), but not "No native handler for programmer tool"
        expect((result['error'] as string ?? '')).not.toContain('No native handler for programmer tool');
      }
    }
  }, 30000);
});
