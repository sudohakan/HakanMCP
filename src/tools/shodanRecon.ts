import { z } from 'zod';
import { fetchWithRetry, jsonResultTruncated } from './_httpShared.js';

const SHODAN_BASE = 'https://api.shodan.io';

function requireKey(): string {
  const k = process.env.SHODAN_API_KEY;
  if (!k) throw new Error('SHODAN_API_KEY not set — configure via Bitwarden "API Key — Shodan"');
  return k;
}

async function shodanCall(path: string, extraParams: Record<string, string> = {}) {
  // Shodan requires key as URL param (no Authorization header support).
  // Do NOT log the full URL anywhere — key is embedded.
  const key = requireKey();
  const params = new URLSearchParams({ key, ...extraParams });
  const url = `${SHODAN_BASE}${path}?${params.toString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    const body = await res.text();
    // Strip key from any body echo just in case
    throw new Error(`Shodan ${path} ${res.status}: ${body.slice(0, 300).replace(key, '***')}`);
  }
  return res.json();
}

const IPV4_RE = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const hostSchema = z.object({
  ip: z.string().regex(IPV4_RE, 'Must be valid IPv4'),
  history: z.boolean().default(false),
  minify: z.boolean().default(false),
});

const searchSchema = z.object({
  query: z.string(),
  page: z.number().int().min(1).max(100).default(1),
  minify: z.boolean().default(true),
});

const dnsSchema = z.object({
  hostnames: z.array(z.string()).min(1).max(100),
});

export const shodanTools = [
  {
    name: 'shodanHostInfo',
    description: 'Shodan host information (ports, services, vulns, banners). Requires SHODAN_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ip: { type: 'string', description: 'IPv4 address' },
        history: { type: 'boolean', description: 'Include historical records (default false)' },
        minify: { type: 'boolean', description: 'Minify response (default false)' },
      },
      required: ['ip'],
    },
    handler: async (args: unknown) => {
      const parsed = hostSchema.parse(args);
      const extras: Record<string, string> = {};
      if (parsed.history) extras.history = 'true';
      if (parsed.minify) extras.minify = 'true';
      return jsonResultTruncated(await shodanCall(`/shodan/host/${encodeURIComponent(parsed.ip)}`, extras));
    },
  },
  {
    name: 'shodanSearch',
    description: 'Shodan search (internet-wide scan results). Requires SHODAN_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Shodan search query (e.g. "apache port:443 country:TR")' },
        page: { type: 'number', description: 'Page (1-100, default 1)' },
        minify: { type: 'boolean', description: 'Minify response (default true)' },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const parsed = searchSchema.parse(args);
      return jsonResultTruncated(await shodanCall('/shodan/host/search', {
        query: parsed.query,
        page: String(parsed.page),
        minify: String(parsed.minify),
      }));
    },
  },
  {
    name: 'shodanDnsResolve',
    description: 'Batch DNS resolve via Shodan. Requires SHODAN_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hostnames: { type: 'array', items: { type: 'string' }, description: 'Domains to resolve (1-100)' },
      },
      required: ['hostnames'],
    },
    handler: async (args: unknown) => {
      const parsed = dnsSchema.parse(args);
      return jsonResultTruncated(await shodanCall('/dns/resolve', { hostnames: parsed.hostnames.join(',') }));
    },
  },
];
