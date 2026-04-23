import { z } from 'zod';
import fetch from 'node-fetch';

const EXA_BASE = 'https://api.exa.ai';

function requireKey(): string {
  const k = process.env.EXA_API_KEY;
  if (!k) throw new Error('EXA_API_KEY not set — configure via Bitwarden item "API Key — Exa"');
  return k;
}

async function exaCall(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${EXA_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': requireKey() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Exa API ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

const searchSchema = z.object({
  query: z.string(),
  numResults: z.number().int().min(1).max(50).default(10),
  useAutoprompt: z.boolean().default(true),
  type: z.enum(['neural', 'keyword', 'auto']).default('auto'),
});

const findSimilarSchema = z.object({
  url: z.string().url(),
  numResults: z.number().int().min(1).max(50).default(10),
});

const getContentsSchema = z.object({
  ids: z.array(z.string()).min(1).max(10),
  text: z.boolean().default(true),
  highlights: z.boolean().default(false),
});

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const exaTools = [
  {
    name: 'exaSearch',
    description: 'Semantic web search via Exa API. Best for current events, research queries, niche content. Requires EXA_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        numResults: { type: 'number', description: 'Number of results (1-50, default 10)' },
        useAutoprompt: { type: 'boolean', description: 'Let Exa rewrite the query (default true)' },
        type: { type: 'string', enum: ['neural', 'keyword', 'auto'], description: 'Search type (default auto)' },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const parsed = searchSchema.parse(args);
      return jsonResult(await exaCall('/search', parsed));
    },
  },
  {
    name: 'exaFindSimilar',
    description: 'Find semantically similar pages to a given URL. Requires EXA_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Source URL to find similar pages for' },
        numResults: { type: 'number', description: 'Number of results (1-50, default 10)' },
      },
      required: ['url'],
    },
    handler: async (args: unknown) => {
      const parsed = findSimilarSchema.parse(args);
      return jsonResult(await exaCall('/findSimilar', parsed));
    },
  },
  {
    name: 'exaGetContents',
    description: 'Fetch full text content of Exa search results by ID. Requires EXA_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Exa result IDs (1-10)' },
        text: { type: 'boolean', description: 'Include full text (default true)' },
        highlights: { type: 'boolean', description: 'Include highlights (default false)' },
      },
      required: ['ids'],
    },
    handler: async (args: unknown) => {
      const parsed = getContentsSchema.parse(args);
      return jsonResult(await exaCall('/contents', parsed));
    },
  },
];

