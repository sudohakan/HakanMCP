/**
 * AI Provider Route Logger — persists last N AI calls for status board (plan §13).
 * Each successful route appends one JSON line to .ai-provider-routes.jsonl.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../utils/projectRoot.js';

export interface RouteEntry {
  ts: number;
  provider: string;
  fallback: boolean;
}

const ROUTES_FILE = '.ai-provider-routes.jsonl';
const MAX_ENTRIES = 50; // Keep last 50; status board shows 10

function getRoutesPath(): string {
  const base = PROJECT_ROOT;
  return path.join(base, ROUTES_FILE);
}

/**
 * Append a route entry (call after successful AI response).
 */
export function appendRoute(provider: string, fallback: boolean): void {
  try {
    const line =
      JSON.stringify({
        ts: Date.now(),
        provider,
        fallback,
      }) + '\n';
    fs.appendFileSync(getRoutesPath(), line, 'utf8');
    pruneIfNeeded();
  } catch {
    /* ignore */
  }
}

function pruneIfNeeded(): void {
  try {
    const p = getRoutesPath();
    if (!fs.existsSync(p)) return;
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length <= MAX_ENTRIES) return;
    const keep = lines.slice(-MAX_ENTRIES);
    fs.writeFileSync(p, keep.join('\n') + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

/**
 * Read last N route entries for status board.
 */
export function readRecentRoutes(n = 10): RouteEntry[] {
  try {
    const p = getRoutesPath();
    if (!fs.existsSync(p)) return [];
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: RouteEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < n; i--) {
      try {
        const obj = JSON.parse(lines[i]!) as { ts?: number; provider?: string; fallback?: boolean };
        if (obj && typeof obj.provider === 'string') {
          entries.unshift({
            ts: obj.ts ?? 0,
            provider: obj.provider,
            fallback: obj.fallback === true,
          });
        }
      } catch {
        /* skip malformed line */
      }
    }
    return entries;
  } catch {
    return [];
  }
}
