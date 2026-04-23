import { z } from 'zod';
import fetch from 'node-fetch';

const SHODAN_BASE = 'https://api.shodan.io';

function requireKey(): string {
  const k = process.env.SHODAN_API_KEY;
  if (!k) throw new Error('SHODAN_API_KEY not set — configure via Bitwarden "API Key — Shodan"');
  return k;
}

const hostSchema = z.object({
  ip: z.string(),
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

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

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
      const params = new URLSearchParams({ key: requireKey() });
      if (parsed.history) params.set('history', 'true');
      if (parsed.minify) params.set('minify', 'true');
      const res = await fetch(`${SHODAN_BASE}/shodan/host/${encodeURIComponent(parsed.ip)}?${params.toString()}`);
      if (!res.ok) throw new Error(`Shodan host ${res.status}: ${await res.text()}`);
      return jsonResult(await res.json());
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
      const params = new URLSearchParams({
        key: requireKey(),
        query: parsed.query,
        page: String(parsed.page),
        minify: String(parsed.minify),
      });
      const res = await fetch(`${SHODAN_BASE}/shodan/host/search?${params.toString()}`);
      if (!res.ok) throw new Error(`Shodan search ${res.status}: ${await res.text()}`);
      return jsonResult(await res.json());
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
      const params = new URLSearchParams({ key: requireKey(), hostnames: parsed.hostnames.join(',') });
      const res = await fetch(`${SHODAN_BASE}/dns/resolve?${params.toString()}`);
      if (!res.ok) throw new Error(`Shodan dns ${res.status}`);
      return jsonResult(await res.json());
    },
  },
];
