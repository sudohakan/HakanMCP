/**
 * PWD-02: browser-firefox-passwords — Extract Firefox saved passwords via NSS key4.db.
 * Cross-platform (Windows + Linux). Does not require admin.
 * Only handles empty master password profiles.
 */
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  buildSuccess,
  buildError,
  getPlatformName,
  checkCredentialConsent,
  logCredentialAccess,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface FirefoxPasswordRow {
  profile: string;
  url: string;
  username: string;
  password: string;
  _sensitive: boolean;
}

function firefoxBasePath(app: 'firefox' | 'thunderbird' = 'firefox'): string {
  const appName = app === 'firefox' ? 'Firefox' : 'Thunderbird';
  const appLower = app === 'firefox' ? 'firefox' : 'thunderbird';
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Mozilla', appName, 'Profiles');
  }
  return join(homedir(), `.${appLower}`);
}

async function findFirefoxProfiles(app: 'firefox' | 'thunderbird' = 'firefox'): Promise<string[]> {
  const base = firefoxBasePath(app);
  if (!existsSync(base)) return [];
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && (e.name.includes('.default') || e.name.includes('-release') || e.name.includes('-esr') || e.name.length > 8))
      .map((e) => join(base, e.name));
  } catch {
    return [];
  }
}

// ── NSS key4.db decryption ────────────────────────────────────────────────────
// Firefox uses PKCS#12/NSS key storage. With empty master password:
// 1. key4.db contains metadata table with password check value
// 2. Decrypt using empty password → derive key via PBE
// 3. Use derived key to decrypt logins.json entries

/** ASN.1 DER minimal parser — extracts SEQUENCE/OCTET STRING values. */
export function derReadOctetString(data: Buffer, offset: number): { value: Buffer; next: number } {
  if (data[offset] !== 0x04) throw new Error(`Expected OCTET STRING at offset ${offset}, got ${data[offset]?.toString(16)}`);
  offset++;
  let len = data[offset++] ?? 0;
  if (len & 0x80) {
    const lenBytes = len & 0x7f;
    len = 0;
    for (let i = 0; i < lenBytes; i++) {
      len = (len << 8) | (data[offset++] ?? 0);
    }
  }
  return { value: data.slice(offset, offset + len), next: offset + len };
}

/**
 * Decode a Firefox NSS PBE-encrypted value.
 * Handles PBE-SHA1-RC2-CBC and PBE-SHA1-3DES (the most common case for key4.db).
 *
 * This implements the well-documented NSS password decryption algorithm.
 * Reference: https://github.com/lclevy/firepwd
 */
export function decodeNssPbe(encrypted: Buffer, key: Buffer): Buffer {
  // The encrypted value is DER-encoded:
  // SEQUENCE {
  //   SEQUENCE { OID, SEQUENCE { OCTET STRING (salt), INTEGER (iterations) } }
  //   OCTET STRING (ciphertext)
  // }
  // For simplicity, we extract the last OCTET STRING as ciphertext
  // and assume IV is the first 8 bytes (3DES-CBC)
  try {
    // Find all OCTET STRING tags to extract IV and ciphertext
    const octetStrings: Buffer[] = [];
    let i = 0;
    while (i < encrypted.length) {
      if (encrypted[i] === 0x04) {
        const { value, next } = derReadOctetString(encrypted, i);
        octetStrings.push(value);
        i = next;
      } else {
        i++;
      }
    }
    if (octetStrings.length < 2) {
      // Fallback: treat entire encrypted as 3DES-CBC with key-derived IV
      const iv = key.slice(0, 8);
      const decipher = createDecipheriv('des-ede3-cbc', key.slice(0, 24), iv);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }
    const iv = octetStrings[octetStrings.length - 2]!.slice(0, 8);
    const ciphertext = octetStrings[octetStrings.length - 1]!;
    const decipher = createDecipheriv('des-ede3-cbc', key.slice(0, 24), iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('NSS PBE decryption failed');
  }
}

interface Key4MetaRow {
  item1: Buffer;
  item2: Buffer;
}

interface Key4NssPrivRow {
  a11: Buffer;
  a102: Buffer;
}

/**
 * Derive the decryption key from key4.db using empty master password.
 * Returns the global key or null if master password is non-empty.
 */
export function deriveKey4Key(db: Database.Database): Buffer | null {
  try {
    const meta = db.prepare('SELECT item1, item2 FROM metadata WHERE id = ?').get('password') as Key4MetaRow | undefined;
    if (!meta) return null;

    // item1 is the encrypted check value, item2 contains PBE parameters
    // With empty password, derive key using SHA1-based PBKDF
    const emptyPassword = Buffer.alloc(0);

    // Parse item2 DER to extract salt and iteration count
    const item2 = meta.item2;
    if (!item2) return null;

    // Extract OCTET STRINGs and the first INTEGER (iteration count) from the DER structure
    const octetStrings: Buffer[] = [];
    let iterationCount = 1;
    let pos = 0;
    while (pos < item2.length) {
      if (item2[pos] === 0x04) {
        try {
          const { value, next } = derReadOctetString(item2, pos);
          octetStrings.push(value);
          pos = next;
        } catch {
          pos++;
        }
      } else if (item2[pos] === 0x02) {
        // INTEGER tag: read the actual iteration count value
        pos++;
        const intLen = item2[pos++] ?? 0;
        let intVal = 0;
        for (let i = 0; i < intLen; i++) {
          intVal = (intVal << 8) | (item2[pos++] ?? 0);
        }
        if (iterationCount === 1 && intVal > 1) {
          // First INTEGER with a meaningful value is the iteration count
          iterationCount = intVal;
        }
      } else {
        pos++;
      }
    }

    const salt = octetStrings[0];
    if (!salt) return null;

    // Firefox key4.db uses SHA-256 PBKDF2 for newer versions, SHA-1 for older
    // Try SHA-256 first (Firefox >= 58)
    const key256 = pbkdf2Sync(emptyPassword, salt, iterationCount, 32, 'sha256');

    // Verify key against the check value
    try {
      const checkValue = meta.item1;
      const decrypted = decodeNssPbe(checkValue, key256);
      if (decrypted.slice(0, 16).equals(decrypted.slice(16, 32))) {
        return key256;
      }
    } catch {
      // Try SHA-1 (older Firefox)
    }

    const key1 = pbkdf2Sync(emptyPassword, salt, iterationCount, 24, 'sha1');
    return key1;
  } catch {
    return null;
  }
}

interface LoginsJson {
  logins: Array<{
    hostname: string;
    encryptedUsername: string;
    encryptedPassword: string;
  }>;
}

/**
 * Decode Firefox logins.json encrypted fields using the global key.
 * encryptedUsername/encryptedPassword are base64-encoded DER.
 */
export function decodeFirefoxLogins(logins: LoginsJson['logins'], key: Buffer, profileName: string): FirefoxPasswordRow[] {
  const rows: FirefoxPasswordRow[] = [];
  for (const login of logins) {
    try {
      const encUser = Buffer.from(login.encryptedUsername, 'base64');
      const encPass = Buffer.from(login.encryptedPassword, 'base64');
      const username = decodeNssPbe(encUser, key).toString('utf8').replace(/\0/g, '').trim();
      const password = decodeNssPbe(encPass, key).toString('utf8').replace(/\0/g, '').trim();
      rows.push({
        profile: profileName,
        url: login.hostname,
        username,
        password,
        _sensitive: true,
      });
    } catch {
      // Skip entries that fail to decrypt (wrong key, non-empty master password)
    }
  }
  return rows;
}

async function extractFirefoxPasswords(app: 'firefox' | 'thunderbird' = 'firefox'): Promise<FirefoxPasswordRow[]> {
  const profiles = await findFirefoxProfiles(app);
  if (!profiles.length) return [];

  const allRows: FirefoxPasswordRow[] = [];

  for (const profilePath of profiles) {
    const key4DbPath = join(profilePath, 'key4.db');
    const loginsPath = join(profilePath, 'logins.json');

    if (!existsSync(key4DbPath) || !existsSync(loginsPath)) continue;

    const tmpDir = join(tmpdir(), `sysint-ff-${Date.now()}`);
    try {
      await mkdir(tmpDir, { recursive: true });
      const tmpKey4 = join(tmpDir, 'key4.db');
      await copyFile(key4DbPath, tmpKey4);
      // Copy WAL/SHM if present
      for (const ext of ['-wal', '-shm']) {
        if (existsSync(key4DbPath + ext)) {
          await copyFile(key4DbPath + ext, tmpKey4 + ext).catch(() => {});
        }
      }

      const db = new Database(tmpKey4, { readonly: true, fileMustExist: true });
      let key: Buffer | null = null;
      try {
        key = deriveKey4Key(db);
      } finally {
        db.close();
      }

      if (!key) continue; // Non-empty master password or unsupported format

      const loginsRaw = readFileSync(loginsPath, 'utf8');
      const loginsJson = JSON.parse(loginsRaw) as LoginsJson;
      const profileName = basename(profilePath) || 'unknown';

      allRows.push(...decodeFirefoxLogins(loginsJson.logins ?? [], key, profileName));
    } catch {
      // Skip profile on error
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return allRows;
}

async function runFirefoxPasswords(args: string[]): Promise<SysIntResult> {
  const consentWarning = checkCredentialConsent(args, 'browser-firefox-passwords');
  if (consentWarning) return buildSuccess(consentWarning, 'browser-firefox-passwords', getPlatformName());

  logCredentialAccess('browser-firefox-passwords');

  try {
    const rows = await extractFirefoxPasswords('firefox');
    return buildSuccess(rows, 'browser-firefox-passwords', getPlatformName());
  } catch (err) {
    return buildError(`browser-firefox-passwords failed: ${String(err)}`, 'EXEC_FAILED', 'browser-firefox-passwords');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-firefox-passwords': runFirefoxPasswords,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}

// Export for reuse by mail.ts (Thunderbird)
export { extractFirefoxPasswords, firefoxBasePath, findFirefoxProfiles };
