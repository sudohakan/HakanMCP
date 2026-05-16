import { z } from 'zod';
import fetch from 'node-fetch';

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: AccessTokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const gd = config.googleDocs;
  if (!gd?.clientId || !gd.clientSecret || !gd.refreshToken) {
    throw new Error(
      'Google Docs OAuth not configured. Set googleDocs.{clientId,clientSecret,refreshToken} in config or env (GOOGLE_DOCS_CLIENT_ID, GOOGLE_DOCS_CLIENT_SECRET, GOOGLE_DOCS_REFRESH_TOKEN). Run: npm run google-oauth-bootstrap',
    );
  }

  const body = new URLSearchParams({
    client_id: gd.clientId,
    client_secret: gd.clientSecret,
    refresh_token: gd.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  logger.debug('Google Docs access token refreshed', { expiresIn: data.expires_in });
  return data.access_token;
}

async function authFetch(url: string, init: Parameters<typeof fetch>[1] = {}): Promise<unknown> {
  const token = await getAccessToken();
  const headers = {
    ...((init.headers as Record<string, string> | undefined) || {}),
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Docs API ${res.status}: ${text}`);
  }
  if (res.status === 204) return {};
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) return await res.text();
  return await res.json();
}

function extractDocumentId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  throw new Error(`Could not extract document ID from: ${input}`);
}

interface DocStructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements?: Array<{
      startIndex?: number;
      endIndex?: number;
      textRun?: { content?: string; textStyle?: Record<string, unknown> };
    }>;
    paragraphStyle?: Record<string, unknown>;
  };
  sectionBreak?: Record<string, unknown>;
  tableOfContents?: Record<string, unknown>;
  table?: Record<string, unknown>;
}

interface DocResponse {
  documentId: string;
  title?: string;
  body?: { content?: DocStructuralElement[] };
  documentStyle?: Record<string, unknown>;
  namedStyles?: Record<string, unknown>;
  revisionId?: string;
}

function summarizeDocument(doc: DocResponse): {
  documentId: string;
  title?: string;
  paragraphCount: number;
  totalChars: number;
  paragraphs: Array<{
    startIndex?: number;
    endIndex?: number;
    text: string;
    namedStyleType?: string;
  }>;
} {
  const paragraphs: Array<{
    startIndex?: number;
    endIndex?: number;
    text: string;
    namedStyleType?: string;
  }> = [];
  let totalChars = 0;

  for (const el of doc.body?.content || []) {
    if (!el.paragraph) continue;
    let text = '';
    for (const run of el.paragraph.elements || []) {
      if (run.textRun?.content) text += run.textRun.content;
    }
    totalChars += text.length;
    paragraphs.push({
      startIndex: el.startIndex,
      endIndex: el.endIndex,
      text,
      namedStyleType: (el.paragraph.paragraphStyle as Record<string, unknown> | undefined)?.[
        'namedStyleType'
      ] as string | undefined,
    });
  }

  return {
    documentId: doc.documentId,
    title: doc.title,
    paragraphCount: paragraphs.length,
    totalChars,
    paragraphs,
  };
}

export const googleDocsTools = [
  {
    name: 'gdocs',
    description:
      'Google Docs API. Actions: getDocument (full JSON), getStructure (paragraph summary with indices), batchUpdate (apply requests array — updateTextStyle, updateParagraphStyle, updateDocumentStyle, replaceAllText, etc), replaceText (simple text replacement). Auth via OAuth refresh token.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['getDocument', 'getStructure', 'batchUpdate', 'replaceText'],
          description: 'Operation to perform',
        },
        document: {
          type: 'string',
          description: 'Google Docs URL or document ID',
        },
        requests: {
          type: 'array',
          description:
            'batchUpdate: array of Request objects per Google Docs API spec (updateTextStyle, updateParagraphStyle, updateDocumentStyle, insertText, deleteContentRange, replaceAllText, createParagraphBullets, etc).',
          items: { type: 'object' },
        },
        find: { type: 'string', description: 'replaceText: text to find' },
        replace: { type: 'string', description: 'replaceText: replacement text' },
        matchCase: {
          type: 'boolean',
          description: 'replaceText: case-sensitive matching (default true)',
        },
      },
      required: ['action', 'document'],
    },
    handler: async (args: unknown) => {
      const { action, document, requests, find, replace, matchCase } = z
        .object({
          action: z.enum(['getDocument', 'getStructure', 'batchUpdate', 'replaceText']),
          document: z.string(),
          requests: z.array(z.record(z.string(), z.unknown())).optional(),
          find: z.string().optional(),
          replace: z.string().optional(),
          matchCase: z.boolean().optional(),
        })
        .parse(args);

      const docId = extractDocumentId(document);

      switch (action) {
        case 'getDocument': {
          const doc = (await authFetch(`${DOCS_API_BASE}/${docId}`)) as DocResponse;
          return {
            content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }],
          };
        }

        case 'getStructure': {
          const doc = (await authFetch(`${DOCS_API_BASE}/${docId}`)) as DocResponse;
          const summary = summarizeDocument(doc);
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          };
        }

        case 'batchUpdate': {
          if (!requests || requests.length === 0) {
            throw new Error('requests array required for batchUpdate');
          }
          const result = await authFetch(`${DOCS_API_BASE}/${docId}:batchUpdate`, {
            method: 'POST',
            body: JSON.stringify({ requests }),
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'replaceText': {
          if (!find || replace === undefined) {
            throw new Error('find and replace required for replaceText');
          }
          const reqs = [
            {
              replaceAllText: {
                containsText: { text: find, matchCase: matchCase ?? true },
                replaceText: replace,
              },
            },
          ];
          const result = await authFetch(`${DOCS_API_BASE}/${docId}:batchUpdate`, {
            method: 'POST',
            body: JSON.stringify({ requests: reqs }),
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
      }
    },
  },
];
