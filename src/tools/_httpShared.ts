import fetch, { Response, RequestInit } from 'node-fetch';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_JSON_CHARS = 120_000;

export interface RetryOpts extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
}

export async function fetchWithRetry(url: string, opts: RetryOpts = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = DEFAULT_MAX_RETRIES, ...init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal as AbortSignal });
      clearTimeout(timer);
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseFloat(res.headers.get('retry-after') || '0');
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * Math.pow(2, attempt), 30_000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt === maxRetries) break;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function jsonResultTruncated(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  let truncated = false;
  if (text.length > MAX_JSON_CHARS) {
    text = text.slice(0, MAX_JSON_CHARS) + '\n\n[TRUNCATED — response exceeded ' + MAX_JSON_CHARS + ' chars]';
    truncated = true;
  }
  return { content: [{ type: 'text' as const, text }], _meta: { truncated } };
}

const ALLOWED_WRITE_ROOTS = [
  os.homedir(),
  os.tmpdir(),
  '/mnt/c/Users/Hakan',
  '/mnt/c/dev',
];

export function safePath(inputPath: string, mode: 'read' | 'write' = 'read'): string {
  const resolved = path.resolve(inputPath);
  if (resolved.includes('\0')) throw new Error('Invalid path (null byte)');
  if (mode === 'write') {
    const allowed = ALLOWED_WRITE_ROOTS.some((root) => resolved.startsWith(root + path.sep) || resolved === root);
    if (!allowed) throw new Error(`Path not allowed for write (must be under: ${ALLOWED_WRITE_ROOTS.join(', ')}): ${resolved}`);
  }
  return resolved;
}

export function escapeArxivQuery(q: string): string {
  return q.replace(/[:"()]/g, ' ').replace(/\s+/g, ' ').trim();
}
