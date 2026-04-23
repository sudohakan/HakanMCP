import { z } from 'zod';
import { fetchWithRetry, jsonResultTruncated, escapeArxivQuery } from './_httpShared.js';

const ARXIV_BASE = 'https://export.arxiv.org/api/query';
const SS_BASE = 'https://api.semanticscholar.org/graph/v1';

const arxivSchema = z.object({
  query: z.string(),
  maxResults: z.number().int().min(1).max(100).default(10),
  sortBy: z.enum(['relevance', 'lastUpdatedDate', 'submittedDate']).default('relevance'),
});

const ssSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(100).default(10),
  fields: z.string().default('title,authors,year,abstract,citationCount,url'),
});

const paperDetailsSchema = z.object({
  paperId: z.string(),
  fields: z.string().default('title,authors,year,abstract,references,citations,url'),
});

interface ArxivEntry {
  title: string;
  summary: string;
  published: string;
  id: string;
}

function parseArxivXml(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];
    const pick = (tag: string): string => {
      const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      return r ? r[1].trim().replace(/\s+/g, ' ') : '';
    };
    entries.push({
      title: pick('title'),
      summary: pick('summary').slice(0, 500),
      published: pick('published'),
      id: pick('id'),
    });
  }
  return entries;
}

export const academicTools = [
  {
    name: 'arxivSearch',
    description: 'Search arXiv preprints (physics, math, CS, biology). Auth-free.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (matches title/abstract/author)' },
        maxResults: { type: 'number', description: 'Max results (1-100, default 10)' },
        sortBy: { type: 'string', enum: ['relevance', 'lastUpdatedDate', 'submittedDate'], description: 'Sort order (default relevance)' },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const parsed = arxivSchema.parse(args);
      const params = new URLSearchParams({
        search_query: `all:${escapeArxivQuery(parsed.query)}`,
        start: '0',
        max_results: String(parsed.maxResults),
        sortBy: parsed.sortBy,
        sortOrder: 'descending',
      });
      const res = await fetchWithRetry(`${ARXIV_BASE}?${params.toString()}`);
      if (!res.ok) throw new Error(`arXiv API ${res.status}`);
      const xml = await res.text();
      return jsonResultTruncated({ results: parseArxivXml(xml) });
    },
  },
  {
    name: 'semanticScholarSearch',
    description: 'Search Semantic Scholar (broad academic, citations). Auth-free with rate limits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Paper search query' },
        limit: { type: 'number', description: 'Result limit (1-100, default 10)' },
        fields: { type: 'string', description: 'Comma-separated fields (default title,authors,year,abstract,citationCount,url)' },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const parsed = ssSchema.parse(args);
      const params = new URLSearchParams({
        query: parsed.query,
        limit: String(parsed.limit),
        fields: parsed.fields,
      });
      const res = await fetchWithRetry(`${SS_BASE}/paper/search?${params.toString()}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Semantic Scholar API ${res.status}: ${txt.slice(0, 300)}`);
      }
      return jsonResultTruncated(await res.json());
    },
  },
  {
    name: 'paperDetails',
    description: 'Get Semantic Scholar paper details (references, citations) by paper ID or DOI.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        paperId: { type: 'string', description: 'Semantic Scholar paper ID or DOI' },
        fields: { type: 'string', description: 'Comma-separated fields (default title,authors,year,abstract,references,citations,url)' },
      },
      required: ['paperId'],
    },
    handler: async (args: unknown) => {
      const parsed = paperDetailsSchema.parse(args);
      const params = new URLSearchParams({ fields: parsed.fields });
      const res = await fetchWithRetry(`${SS_BASE}/paper/${encodeURIComponent(parsed.paperId)}?${params.toString()}`);
      if (!res.ok) throw new Error(`Semantic Scholar detail API ${res.status}`);
      return jsonResultTruncated(await res.json());
    },
  },
];
