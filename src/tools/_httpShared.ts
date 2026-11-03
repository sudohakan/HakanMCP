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

// Extra write roots (e.g. a Windows profile mounted under WSL) come from
// HAKANMCP_WRITE_ROOTS, separated by the platform path delimiter. Read per call so the
// project .env (loaded by config.ts) applies whatever the module import order is.
export function allowedWriteRoots(): string[] {
  return [
    os.homedir(),
    os.tmpdir(),
    ...(process.env.HAKANMCP_WRITE_ROOTS ?? '')
      .split(path.delimiter)
      .map((root) => root.trim())
      .filter((root) => root.length > 0)
      .map((root) => path.resolve(root)),
  ];
}

export function safePath(inputPath: string, mode: 'read' | 'write' = 'read'): string {
  const resolved = path.resolve(inputPath);
  if (resolved.includes('\0')) throw new Error('Invalid path (null byte)');
  if (mode === 'write') {
    const roots = allowedWriteRoots();
    const allowed = roots.some((root) => resolved.startsWith(root + path.sep) || resolved === root);
    if (!allowed) throw new Error(`Path not allowed for write (must be under: ${roots.join(', ')}): ${resolved}`);
  }
  return resolved;
}

export function escapeArxivQuery(q: string): string {
  return q.replace(/[:"()]/g, ' ').replace(/\s+/g, ' ').trim();
}
