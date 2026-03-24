import { z } from 'zod';
import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const cache = new NodeCache({ stdTTL: config.cacheTtl });
const BASE = config.gitbookUrl;

logger.info('GitBook initialized', { base: BASE, cacheTtl: config.cacheTtl });

async function fetchHtml(pth: string) {
  const base = BASE.replace(/\/$/, '');
  const rel = (pth || '').replace(/^\//, '');
  const url = pth?.startsWith('http') ? pth : `${base}/${rel}`;

  const cached = cache.get<string>(url);
  if (cached) {
    logger.debug('Cache hit', { url });
    return { html: cached, url };
  }

  logger.debug('Cache miss', { url });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} - ${url}`);
  const html = await res.text();

  cache.set(url, html);

  return { html, url };
}

function dedupeLinks<T extends { href: string; text: string }>(arr: T[]) {
  return arr.filter((v, i, a) => a.findIndex((x) => x.href === v.href && x.text === v.text) === i);
}

export const gitbookTools = [
  {
    name: 'gitbook',
    description:
      'GitBook operations. Actions: getPage, listLinks, find, headings, outline, getMetadata, searchContent.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['getPage', 'listLinks', 'find', 'headings', 'outline', 'getMetadata', 'searchContent'],
          description: 'Operation to perform',
        },
        path: { type: 'string', description: 'GitBook page path or full URL' },
        pattern: { type: 'string', description: 'Keyword/regex to search (find action)' },
        searchTerm: { type: 'string', description: 'Search term (searchContent action)' },
        contextLines: { type: 'number', description: 'Number of rows around the match (searchContent, default: 2)' },
      },
      required: ['action', 'path'],
    },
    handler: async (args: unknown) => {
      const { action, path, pattern, searchTerm, contextLines } = z
        .object({
          action: z.enum(['getPage', 'listLinks', 'find', 'headings', 'outline', 'getMetadata', 'searchContent']),
          path: z.string(),
          pattern: z.string().optional(),
          searchTerm: z.string().optional(),
          contextLines: z.number().default(2),
        })
        .parse(args);

      switch (action) {
        case 'getPage': {
          const { html, url } = await fetchHtml(path);
          const dom = new JSDOM(html);
          const text = dom.window.document.body.textContent || '';
          return { content: [{ type: 'text', text }], meta: { url } };
        }

        case 'listLinks': {
          const { html, url } = await fetchHtml(path);
          const dom = new JSDOM(html);
          const host = new URL(BASE).host;
          const links = dedupeLinks(
            Array.from(dom.window.document.querySelectorAll('a'))
              .map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent || '').trim() }))
              .filter((l) => l.href.includes(host)),
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ base: url, links }, null, 2),
              },
            ],
          };
        }

        case 'find': {
          if (!pattern) throw new Error('pattern is required for action=find');
          const { html, url } = await fetchHtml(path);
          const dom = new JSDOM(html);
          const text = dom.window.document.body.textContent || '';
          const re = new RegExp(pattern, 'i');
          const matches = text
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s && re.test(s))
            .slice(0, 50);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ url, matches }, null, 2),
              },
            ],
          };
        }

        case 'headings': {
          const { html, url } = await fetchHtml(path);
          const dom = new JSDOM(html);
          const nodes = Array.from(dom.window.document.querySelectorAll('h1,h2,h3')) as HTMLElement[];
          const headings = nodes.map((h) => ({
            level: Number(h.tagName.substring(1)),
            text: (h.textContent || '').trim(),
          }));
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(headings, null, 2),
              },
            ],
            meta: { url },
          };
        }

        case 'outline': {
          const { html, url } = await fetchHtml(path);
          const dom = new JSDOM(html);
          const nodes = Array.from(dom.window.document.querySelectorAll('h1,h2,h3')) as HTMLElement[];
          const headings = nodes.map((h) => ({
            level: Number(h.tagName.substring(1)),
            text: (h.textContent || '').trim(),
            id: h.getAttribute('id') || '',
          }));
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(headings, null, 2),
              },
            ],
            meta: { url },
          };
        }

        case 'getMetadata': {
          const { html, url } = await fetchHtml(path);
          const dom = new JSDOM(html);
          const doc = dom.window.document;

          const metadata = {
            title: doc.querySelector('title')?.textContent || '',
            description: doc.querySelector('meta[name="description"]')?.getAttribute('content') || '',
            keywords: doc.querySelector('meta[name="keywords"]')?.getAttribute('content') || '',
            author: doc.querySelector('meta[name="author"]')?.getAttribute('content') || '',
            ogTitle: doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
            ogDescription:
              doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '',
            ogImage: doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '',
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ url, metadata }, null, 2),
              },
            ],
            meta: { url },
          };
        }

        case 'searchContent': {
          if (!searchTerm) throw new Error('searchTerm is required for action=searchContent');
          const { html, url } = await fetchHtml(path);
          const dom = new JSDOM(html);
          const text = dom.window.document.body.textContent || '';
          const lines = text
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s);

          const results: Array<{
            lineNumber: number;
            matchedLine: string;
            context: string[];
            contextRange: string;
          }> = [];
          const searchLower = searchTerm.toLowerCase();

          lines.forEach((line, index) => {
            if (line.toLowerCase().includes(searchLower)) {
              const start = Math.max(0, index - contextLines);
              const end = Math.min(lines.length, index + contextLines + 1);
              const context = lines.slice(start, end);

              results.push({
                lineNumber: index + 1,
                matchedLine: line,
                context: context,
                contextRange: `${start + 1}-${end}`,
              });
            }
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    url,
                    searchTerm,
                    matchCount: results.length,
                    matches: results.slice(0, 20),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }
    },
  },
];
