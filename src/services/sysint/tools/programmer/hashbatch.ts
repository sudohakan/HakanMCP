/**
 * PRG-03: hash-batch — Compute cryptographic hashes for all files in a directory.
 * Cross-platform. Wraps disk/hash.ts computeFileHash in batch/directory mode.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildSuccess, buildError, getPlatformName, parseArg } from './shared.js';
import { computeFileHash } from '../disk/hash.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface HashBatchRow {
  file: string;
  size: number;
  hash: string;
  algo: string;
}

const VALID_ALGOS = ['md5', 'sha1', 'sha256', 'sha512'];

/**
 * Recursively list all files in a directory.
 * Respects a depth limit to avoid unbounded traversal.
 */
async function listFiles(dir: string, maxDepth: number, currentDepth = 0): Promise<string[]> {
  if (currentDepth > maxDepth) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await listFiles(fullPath, maxDepth, currentDepth + 1);
      files.push(...sub);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function runHashBatch(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const dir = parseArg(args, '--dir');
  if (!dir) {
    return buildError('hash-batch requires --dir <path>', 'EXEC_FAILED', 'hash-batch');
  }

  const algo = (parseArg(args, '--algo') ?? 'sha256').toLowerCase();
  if (!VALID_ALGOS.includes(algo)) {
    return buildError(`hash-batch: unsupported algo '${algo}'. Use: ${VALID_ALGOS.join(', ')}`, 'EXEC_FAILED', 'hash-batch');
  }

  const maxDepth = parseInt(parseArg(args, '--depth') ?? '5', 10);
  const maxFiles = parseInt(parseArg(args, '--limit') ?? '1000', 10);

  try {
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) {
      return buildError(`hash-batch: '${dir}' is not a directory`, 'EXEC_FAILED', 'hash-batch');
    }

    const files = await listFiles(dir, maxDepth);
    const limited = files.slice(0, maxFiles);

    const rows: HashBatchRow[] = [];
    for (const filePath of limited) {
      try {
        const fileStat = await stat(filePath);
        const hash = await computeFileHash(filePath, algo);
        rows.push({
          file: filePath,
          size: fileStat.size,
          hash,
          algo,
        });
      } catch {
        // Skip files that can't be read (permission denied, etc.)
        rows.push({ file: filePath, size: 0, hash: '', algo });
      }
    }

    return buildSuccess(rows, 'hash-batch', platform);
  } catch (err) {
    return buildError(`hash-batch failed: ${String(err)}`, 'EXEC_FAILED', 'hash-batch');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'hash-batch') return runHashBatch(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
