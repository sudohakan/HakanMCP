/**
 * PRG-02: pe-headers — Parse PE (Windows) or ELF (Linux) binary file headers.
 * Cross-platform: reads raw bytes from any binary file.
 */
import { readFileSync } from 'node:fs';
import { buildSuccess, buildError, getPlatformName, parseArg } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PEHeaderRow {
  format: 'PE';
  machine: string;
  is64Bit: boolean;
  isDll: boolean;
  isExe: boolean;
  subsystem: string;
  entryPoint: string;
  imageBase: string;
  sectionCount: number;
  linkerVersionMajor: number;
  linkerVersionMinor: number;
  characteristics: number;
}

export interface ELFHeaderRow {
  format: 'ELF';
  class: '32-bit' | '64-bit';
  endianness: 'little' | 'big';
  type: string;
  machine: string;
  entryPoint: string;
  osABI: string;
}

export type HeaderRow = PEHeaderRow | ELFHeaderRow | { format: 'unknown'; note: string };

// ── PE constants ──────────────────────────────────────────────────────────────

const PE_MACHINE: Record<number, string> = {
  0x014c: 'x86',
  0x0200: 'IA64',
  0x8664: 'x86_64',
  0x01c4: 'ARM',
  0xaa64: 'ARM64',
};

const PE_SUBSYSTEM: Record<number, string> = {
  0: 'Unknown',
  1: 'Native',
  2: 'Windows GUI',
  3: 'Windows CUI',
  5: 'OS/2 CUI',
  7: 'POSIX CUI',
  9: 'Windows CE GUI',
  10: 'EFI Application',
  14: 'Xbox',
  16: 'Windows Boot Application',
};

const ELF_TYPE: Record<number, string> = {
  0: 'ET_NONE',
  1: 'ET_REL (relocatable)',
  2: 'ET_EXEC (executable)',
  3: 'ET_DYN (shared object)',
  4: 'ET_CORE (core dump)',
};

const ELF_MACHINE: Record<number, string> = {
  0x02: 'SPARC',
  0x03: 'x86',
  0x08: 'MIPS',
  0x14: 'PowerPC',
  0x28: 'ARM',
  0x3e: 'x86_64',
  0x45: 'IA-64',
  0xb7: 'AArch64',
  0xf3: 'RISC-V',
};

const ELF_OSABI: Record<number, string> = {
  0: 'System V',
  1: 'HP-UX',
  2: 'NetBSD',
  3: 'Linux',
  6: 'Solaris',
  9: 'FreeBSD',
  12: 'OpenBSD',
};

// ── Parsers ───────────────────────────────────────────────────────────────────

/**
 * Parse PE header from buffer. Buffer must be at least 64 bytes.
 * Returns null if buffer does not contain a valid PE signature.
 */
export function parsePEHeader(buf: Buffer): PEHeaderRow | null {
  if (buf.length < 64) return null;
  // DOS stub: check MZ signature
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) return null;

  // PE offset is at 0x3C (little-endian DWORD)
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.length < peOffset + 24) return null;

  // PE signature: PE\0\0
  if (buf[peOffset] !== 0x50 || buf[peOffset + 1] !== 0x45 ||
      buf[peOffset + 2] !== 0x00 || buf[peOffset + 3] !== 0x00) {
    return null;
  }

  const coffOffset = peOffset + 4;
  if (buf.length < coffOffset + 20) return null;

  const machine = buf.readUInt16LE(coffOffset);
  const sectionCount = buf.readUInt16LE(coffOffset + 2);
  const characteristics = buf.readUInt16LE(coffOffset + 18);

  const isDll = (characteristics & 0x2000) !== 0;
  const isExe = (characteristics & 0x0002) !== 0;

  // Optional header offset = coffOffset + 20
  const optOffset = coffOffset + 20;
  if (buf.length < optOffset + 28) {
    return {
      format: 'PE',
      machine: PE_MACHINE[machine] ?? `0x${machine.toString(16)}`,
      is64Bit: machine === 0x8664 || machine === 0xaa64,
      isDll, isExe, subsystem: 'Unknown',
      entryPoint: '0x0', imageBase: '0x0',
      sectionCount, linkerVersionMajor: 0, linkerVersionMinor: 0, characteristics,
    };
  }

  const magic = buf.readUInt16LE(optOffset);
  const is64Bit = magic === 0x20b; // PE32+ = 0x20B, PE32 = 0x10B

  const linkerVersionMajor = buf[optOffset + 2] ?? 0;
  const linkerVersionMinor = buf[optOffset + 3] ?? 0;
  const entryPointRVA = buf.readUInt32LE(optOffset + 16);

  let subsystem = 'Unknown';
  let imageBase = '0x0';

  if (is64Bit && buf.length >= optOffset + 68) {
    subsystem = PE_SUBSYSTEM[buf.readUInt16LE(optOffset + 68)] ?? 'Unknown';
    imageBase = '0x' + buf.readBigUInt64LE(optOffset + 24).toString(16);
  } else if (!is64Bit && buf.length >= optOffset + 68) {
    subsystem = PE_SUBSYSTEM[buf.readUInt16LE(optOffset + 68)] ?? 'Unknown';
    imageBase = '0x' + buf.readUInt32LE(optOffset + 28).toString(16);
  }

  return {
    format: 'PE',
    machine: PE_MACHINE[machine] ?? `0x${machine.toString(16)}`,
    is64Bit,
    isDll, isExe, subsystem,
    entryPoint: `0x${entryPointRVA.toString(16)}`,
    imageBase,
    sectionCount,
    linkerVersionMajor,
    linkerVersionMinor,
    characteristics,
  };
}

/**
 * Parse ELF header from buffer. Buffer must be at least 64 bytes.
 * Returns null if buffer does not contain a valid ELF magic.
 */
export function parseELFHeader(buf: Buffer): ELFHeaderRow | null {
  if (buf.length < 16) return null;
  // ELF magic: 0x7F 'E' 'L' 'F'
  if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) return null;

  const elfClass = buf[4]; // 1 = 32-bit, 2 = 64-bit
  const dataEncoding = buf[5]; // 1 = LE, 2 = BE
  const osABI = buf[7] ?? 0;

  const is64 = elfClass === 2;
  const isLE = dataEncoding === 1;

  const readU16 = (offset: number) => isLE ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
  const readU32 = (offset: number) => isLE ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);

  if (buf.length < 24) return null;

  const elfType = readU16(16);
  const machine = readU16(18);

  let entryPoint = '0x0';
  if (is64 && buf.length >= 32) {
    try {
      const ep = isLE ? buf.readBigUInt64LE(24) : buf.readBigUInt64BE(24);
      entryPoint = '0x' + ep.toString(16);
    } catch {
      entryPoint = '0x0';
    }
  } else if (!is64 && buf.length >= 28) {
    entryPoint = '0x' + readU32(24).toString(16);
  }

  return {
    format: 'ELF',
    class: is64 ? '64-bit' : '32-bit',
    endianness: isLE ? 'little' : 'big',
    type: ELF_TYPE[elfType] ?? `0x${elfType.toString(16)}`,
    machine: ELF_MACHINE[machine] ?? `0x${machine.toString(16)}`,
    entryPoint,
    osABI: ELF_OSABI[osABI] ?? `0x${osABI.toString(16)}`,
  };
}

// ── Execution ─────────────────────────────────────────────────────────────────

async function runPEHeaders(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const filePath = parseArg(args, '--file');
  if (!filePath) {
    return buildError('pe-headers requires --file <path>', 'EXEC_FAILED', 'pe-headers');
  }

  try {
    // Read only the first 512 bytes — enough for both PE and ELF headers
    const buf = Buffer.alloc(512);
    const fd = require('node:fs').openSync(filePath, 'r');
    const bytesRead = require('node:fs').readSync(fd, buf, 0, 512, 0);
    require('node:fs').closeSync(fd);
    const headerBuf = buf.subarray(0, bytesRead);

    const pe = parsePEHeader(headerBuf);
    if (pe) {
      return buildSuccess([pe], 'pe-headers', platform);
    }

    const elf = parseELFHeader(headerBuf);
    if (elf) {
      return buildSuccess([elf], 'pe-headers', platform);
    }

    const row: HeaderRow = { format: 'unknown', note: 'No PE or ELF magic found in file header' };
    return buildSuccess([row], 'pe-headers', platform);
  } catch (err) {
    return buildError(`pe-headers failed: ${String(err)}`, 'EXEC_FAILED', 'pe-headers');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'pe-headers') return runPEHeaders(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
