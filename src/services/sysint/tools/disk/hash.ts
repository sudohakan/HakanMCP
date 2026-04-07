/**
 * DSK-13: file-hash — File hash calculator (MD5, SHA1, SHA256, SHA512).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';
const VALID_ALGORITHMS: HashAlgorithm[] = ['md5', 'sha1', 'sha256', 'sha512'];

export interface HashRow {
  path: string;
  algorithm: string;
  hash: string;
  sizeBytes: number;
}

export async function computeFileHash(filePath: string, algorithm: string = 'sha256'): Promise<string> {
  const algo = algorithm.toLowerCase().replace('-', '') as HashAlgorithm;
  if (!VALID_ALGORITHMS.includes(algo)) {
    throw new Error(`Unsupported algorithm: ${algorithm}. Supported: ${VALID_ALGORITHMS.join(', ')}`);
  }
  return new Promise((resolve, reject) => {
    const hash = createHash(algo);
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function run(_toolId: string, args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [filePath, algorithm = 'sha256'] = args;

  if (!filePath) {
    return buildError('file-hash: filePath argument required', 'EXEC_FAILED', 'file-hash');
  }

  try {
    const st = await stat(filePath);
    const hash = await computeFileHash(filePath, algorithm);
    const row: HashRow = {
      path: filePath,
      algorithm: algorithm.toLowerCase(),
      hash,
      sizeBytes: st.size,
    };
    return buildSuccess([row], 'file-hash', platform);
  } catch (err) {
    return buildError(`file-hash failed: ${String(err)}`, 'EXEC_FAILED', 'file-hash');
  }
}
