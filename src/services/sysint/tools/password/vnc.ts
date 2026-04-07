/**
 * PWD-07: vnc-passwords — Decrypt VNC password files using the well-known VNC DES key.
 * Cross-platform (Windows + Linux). VNC uses a fixed public DES key.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  checkCredentialConsent,
  logCredentialAccess,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface VncPasswordRow {
  app: string;
  configFile: string;
  password: string;
  _sensitive: boolean;
}

/**
 * The VNC "encryption" uses DES ECB with a well-known, publicly documented fixed key.
 * Each bit in the key bytes is reversed before use (VNC spec quirk).
 * Reference: https://github.com/jeroennijhof/vncpwd
 */
const VNC_KEY_BYTES = [0xE8, 0x4A, 0xD6, 0x60, 0xC4, 0x72, 0x1A, 0xE0];

/**
 * Reverse bits in a byte (VNC key transformation).
 */
export function reverseBits(byte: number): number {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    result = (result << 1) | (byte & 1);
    byte >>= 1;
  }
  return result;
}

// ── Pure-JS DES-ECB implementation (avoids OpenSSL 3 legacy algorithm restrictions) ─────

// DES S-boxes (standard)
const DES_SBOX: readonly number[][] = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];

const DES_PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const DES_PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const DES_IP  = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const DES_FP  = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const DES_E   = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const DES_P   = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const DES_SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];

function desPermute(src: number[], table: readonly number[]): number[] {
  return table.map((bit) => src[bit - 1] ?? 0);
}

function numToBits(n: number, len: number): number[] {
  const bits: number[] = new Array(len).fill(0);
  for (let i = len - 1; i >= 0; i--) {
    bits[i] = n & 1;
    n >>= 1;
  }
  return bits;
}

function bitsToNum(bits: number[]): number {
  return bits.reduce((acc, b) => (acc << 1) | b, 0);
}

function bufToBits(buf: Buffer): number[] {
  const bits: number[] = [];
  for (const byte of buf) {
    bits.push(...numToBits(byte, 8));
  }
  return bits;
}

function bitsToBuffer(bits: number[]): Buffer {
  const buf = Buffer.alloc(bits.length / 8);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = bitsToNum(bits.slice(i * 8, i * 8 + 8));
  }
  return buf;
}

function rotateLeft(arr: number[], n: number): number[] {
  return [...arr.slice(n), ...arr.slice(0, n)];
}

function desGenerateSubkeys(keyBits: number[]): number[][] {
  const kp = desPermute(keyBits, DES_PC1);
  let C = kp.slice(0, 28);
  let D = kp.slice(28, 56);
  const subkeys: number[][] = [];
  for (let i = 0; i < 16; i++) {
    C = rotateLeft(C, DES_SHIFTS[i] ?? 1);
    D = rotateLeft(D, DES_SHIFTS[i] ?? 1);
    subkeys.push(desPermute([...C, ...D], DES_PC2));
  }
  return subkeys;
}

function desFeistel(R: number[], subkey: number[]): number[] {
  const expanded = desPermute(R, DES_E);
  const xored = expanded.map((b, i) => b ^ (subkey[i] ?? 0));
  const sboxOut: number[] = [];
  for (let i = 0; i < 8; i++) {
    const chunk = xored.slice(i * 6, i * 6 + 6);
    const row = (chunk[0]! << 1) | chunk[5]!;
    const col = bitsToNum(chunk.slice(1, 5));
    const val = DES_SBOX[i]![row * 16 + col] ?? 0;
    sboxOut.push(...numToBits(val, 4));
  }
  return desPermute(sboxOut, DES_P);
}

function desDecryptBlock(block: Buffer, subkeys: number[][]): Buffer {
  const bits = desPermute(bufToBits(block), DES_IP);
  let L = bits.slice(0, 32);
  let R = bits.slice(32, 64);
  // Decrypt: apply subkeys in reverse order
  for (let i = 15; i >= 0; i--) {
    const newR = L.map((b, j) => b ^ desFeistel(R, subkeys[i]!)[j]!);
    L = R;
    R = newR;
  }
  const preOutput = [...R, ...L];
  return bitsToBuffer(desPermute(preOutput, DES_FP));
}

/**
 * Decrypt VNC password bytes using the well-known VNC DES key.
 * The password is stored as 8 encrypted bytes (DES ECB, zero-padded to 8 bytes).
 * Uses a pure-JS DES implementation to avoid OpenSSL 3 legacy algorithm restrictions.
 */
export function decryptVncPassword(encryptedBytes: Buffer): string {
  if (encryptedBytes.length === 0) return '';

  // Apply bit-reversal to each key byte (VNC spec)
  const keyBytes = Buffer.from(VNC_KEY_BYTES.map(reverseBits));

  // Pad or truncate to 8 bytes
  const block = Buffer.alloc(8);
  encryptedBytes.copy(block, 0, 0, Math.min(encryptedBytes.length, 8));

  const keyBits = bufToBits(keyBytes);
  const subkeys = desGenerateSubkeys(keyBits);
  const decrypted = desDecryptBlock(block, subkeys);

  // Result is null-terminated ASCII
  const nullIdx = decrypted.indexOf(0);
  return decrypted.slice(0, nullIdx === -1 ? 8 : nullIdx).toString('ascii').trim();
}

// ── VNC password file locations ───────────────────────────────────────────────

interface VncPasswordFile {
  app: string;
  path: string;
}

function getVncPasswordFiles(): VncPasswordFile[] {
  const files: VncPasswordFile[] = [];
  const home = homedir();

  if (process.platform === 'win32' || (process.platform === 'linux' && process.env['WSL_DISTRO_NAME'])) {
    const appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming');
    const localAppData = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');

    const winLocations: VncPasswordFile[] = [
      { app: 'RealVNC', path: join(appData, 'RealVNC', 'vncserver.ini') },
      { app: 'TightVNC', path: join(appData, 'TightVNC', 'tvnserver.ini') },
      { app: 'UltraVNC', path: 'C:\\Program Files\\uvnc bvba\\UltraVNC\\ultravnc.ini' },
      { app: 'UltraVNC', path: join(localAppData, 'uvnc bvba', 'UltraVNC', 'ultravnc.ini') },
    ];
    files.push(...winLocations);
  }

  // Linux paths
  const linuxLocations: VncPasswordFile[] = [
    { app: 'RealVNC', path: join(home, '.vnc', 'passwd') },
    { app: 'TigerVNC', path: join(home, '.vnc', 'passwd') },
    { app: 'LibVNCServer', path: '/etc/vnc/password' },
  ];
  files.push(...linuxLocations);

  return files;
}

/**
 * Extract Password= hex value from INI-style config files used by Windows VNC servers.
 */
export function extractPasswordFromIni(content: string): Buffer | null {
  for (const line of content.split('\n')) {
    const match = line.match(/^[Pp]assword\s*=\s*([0-9A-Fa-f]{16})$/);
    if (match?.[1]) {
      return Buffer.from(match[1], 'hex');
    }
  }
  return null;
}

async function runVncPasswords(args: string[]): Promise<SysIntResult> {
  const consentWarning = checkCredentialConsent(args, 'vnc-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'vnc-passwords', getPlatformName());

  logCredentialAccess('vnc-passwords');

  const rows: VncPasswordRow[] = [];
  const seen = new Set<string>();

  for (const location of getVncPasswordFiles()) {
    if (!existsSync(location.path)) continue;
    if (seen.has(location.path)) continue;
    seen.add(location.path);

    try {
      const content = readFileSync(location.path);
      let encryptedBytes: Buffer | null = null;

      // INI file: extract hex-encoded password
      if (location.path.endsWith('.ini')) {
        encryptedBytes = extractPasswordFromIni(content.toString('utf8'));
      } else {
        // Raw binary passwd file
        encryptedBytes = content.slice(0, 8);
      }

      if (encryptedBytes && encryptedBytes.length > 0) {
        const password = decryptVncPassword(encryptedBytes);
        rows.push({
          app: location.app,
          configFile: location.path,
          password,
          _sensitive: true,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return buildSuccess(rows, 'vnc-passwords', getPlatformName());
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'vnc-passwords': runVncPasswords,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
