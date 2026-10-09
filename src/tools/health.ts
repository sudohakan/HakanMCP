import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createJsonResponse } from '../utils/common.js';
import { getMetricsSnapshot } from '../utils/toolMetrics.js';

const require_ = createRequire(import.meta.url);

/** Native drivers that back feature tools. Resolvable ≠ loaded — this only
 *  checks that a first call to db/mongo could succeed, without paying the load. */
const NATIVE_DRIVERS = ['pg', 'mysql2', 'mssql', 'sqlite3', 'better-sqlite3', 'mongodb'];

function driverStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of NATIVE_DRIVERS) {
    try {
      require_.resolve(name);
      out[name] = true;
    } catch {
      out[name] = false;
    }
  }
  return out;
}

/** The chrome_* and browser tools proxy a Chrome DevTools backend; cfbypass a
 *  FlareSolverr container. Gateway calls can report "timed out after 1s" while
 *  the backend is fine, so probe the backend directly before blaming the tool. */
async function probe(url: string, timeoutMs = 1500): Promise<'up' | 'down'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok || res.status < 500 ? 'up' : 'down';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** Is the running entry a single-file bundle or the per-module tsc output?
 *  The bundle is the fast-startup path; falling back to per-module loading on
 *  NTFS is a silent regression worth surfacing. */
function buildMode(): 'bundle' | 'modules' | 'unknown' {
  try {
    const entry = fileURLToPath(import.meta.url).replace(/health\.js$/, '').replace(/[/\\]tools[/\\]$/, '/index.js');
    const size = statSync(entry).size;
    // The bundle inlines every module → megabytes; a tsc-emitted index.js is a few KB.
    if (size > 500_000) return 'bundle';
    const head = readFileSync(entry, 'utf8').slice(0, 400);
    return head.includes('TOOL_MODULES') && size < 100_000 ? 'modules' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export const healthTools = [
  {
    name: 'health',
    description:
      'HakanMCP self-check: native driver availability, backend liveness (Chrome DevTools, FlareSolverr), build mode, uptime, and this process\'s tool-call error rate. Read-only. Use to diagnose gateway timeouts before restarting anything.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cdpUrl: {
          type: 'string',
          description: 'Chrome DevTools version endpoint to probe (default http://127.0.0.1:9223/json/version)',
        },
        flaresolverrUrl: {
          type: 'string',
          description: 'FlareSolverr endpoint to probe (default http://localhost:8191/)',
        },
      },
      required: [],
    },
    handler: async (args: unknown) => {
      const { cdpUrl, flaresolverrUrl } = z
        .object({ cdpUrl: z.string().optional(), flaresolverrUrl: z.string().optional() })
        .parse(args ?? {});

      const [cdp, flaresolverr] = await Promise.all([
        probe(cdpUrl ?? 'http://127.0.0.1:9223/json/version'),
        probe(flaresolverrUrl ?? 'http://localhost:8191/'),
      ]);

      const mem = process.memoryUsage();
      return createJsonResponse({
        status: 'ok',
        uptimeSec: Math.round(process.uptime()),
        buildMode: buildMode(),
        node: process.version,
        memoryMB: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        },
        nativeDrivers: driverStatus(),
        backends: { chromeDevtools: cdp, flaresolverr },
        toolMetrics: getMetricsSnapshot(),
      });
    },
  },
];
