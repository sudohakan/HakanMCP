import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';

import { config } from '../config.js';

// Helper to resolve Postman directory dynamically
// This allows overriding via process.env for testing
function getPostmanDir(): string {
  const dir = process.env.POSTMAN_DIR || config.postmanDir;
  return dir.startsWith('/') || dir.match(/^[a-zA-Z]:/) ? dir : path.join(process.cwd(), dir);
}

// Helpers
function readJson(p: string) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p: string, data: unknown) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function findAllItems(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (item.item && Array.isArray(item.item)) {
      result.push(...findAllItems(item.item as Array<Record<string, unknown>>));
    } else if (item.request) {
      result.push(item);
    }
  }
  return result;
}

function findItemByName(
  items: Array<Record<string, unknown>>,
  targetName: string,
): { item: Record<string, unknown>; parent: Array<Record<string, unknown>> } | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if ((item.name as string)?.toLowerCase() === targetName.toLowerCase()) {
      return { item, parent: items };
    }
    if (item.item && Array.isArray(item.item)) {
      const found = findItemByName(item.item as Array<Record<string, unknown>>, targetName);
      if (found) return found;
    }
  }
  return null;
}

export const postmanTools = [
  {
    name: 'pm_collection',
    description:
      "Manage Postman collections. action='list' lists collection files, 'listRequests' lists all requests in a collection, 'search' searches requests by name/URL/method, 'add' adds a new request.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'listRequests', 'search', 'add'],
          description: 'Operation to perform',
        },
        file: {
          type: 'string',
          description: 'Collection filename (not required for list)',
        },
        q: { type: 'string', description: 'Search query string (for search, regex supported)' },
        request: {
          type: 'object',
          description: 'Request details to add (for add)',
          properties: {
            name: { type: 'string' },
            method: { type: 'string' },
            url: { type: 'string' },
            headers: { type: 'array' },
            body: { type: 'object' },
          },
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, file, q, request } = z
        .object({
          action: z.enum(['list', 'listRequests', 'search', 'add']),
          file: z.string().optional(),
          q: z.string().optional(),
          request: z
            .object({
              name: z.string(),
              method: z.string().default('GET'),
              url: z.string(),
              headers: z.array(z.any()).optional(),
              body: z.any().optional(),
            })
            .optional(),
        })
        .parse(args);

      const postmanDir = getPostmanDir();

      switch (action) {
        case 'list': {
          if (!fs.existsSync(postmanDir)) {
            throw new Error(`Postman directory not found:${postmanDir}`);
          }
          const files = fs
            .readdirSync(postmanDir)
            .filter((f) => f.endsWith('.postman_collection.json'));
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ dir: postmanDir, count: files.length, files }, null, 2),
              },
            ],
          };
        }

        case 'listRequests': {
          if (!file) throw new Error('file is required for listRequests');
          const full = path.join(postmanDir, file);
          const col = readJson(full);
          const items = findAllItems(col.item || []);
          const reqs = items.map((it: Record<string, unknown>) => {
            const req = it.request as Record<string, unknown> | undefined;
            return {
              name: it.name,
              method: (req?.method as string) || 'GET',
              url:
                typeof req?.url === 'string' ? req.url : (req?.url as { raw?: string })?.raw || '',
            };
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ file, count: reqs.length, requests: reqs }, null, 2),
              },
            ],
          };
        }

        case 'search': {
          if (!file) throw new Error('file is required for search');
          if (!q) throw new Error('q is required for search');
          const re = new RegExp(q, 'i');
          const full = path.join(postmanDir, file);
          const col = readJson(full);
          const items = findAllItems(col.item || []);
          const results = items
            .map((it: Record<string, unknown>) => {
              const req = it.request as Record<string, unknown> | undefined;
              return {
                name: it.name as string,
                method: req?.method as string | undefined,
                url:
                  typeof req?.url === 'string'
                    ? req.url
                    : (req?.url as { raw?: string })?.raw || '',
              };
            })
            .filter(
              (r: { name: string; url: string; method?: string }) =>
                re.test(r.name) || re.test(r.url) || re.test(r.method || ''),
            );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ file, count: results.length, results }, null, 2),
              },
            ],
          };
        }

        case 'add': {
          if (!file) throw new Error('file is required for add');
          if (!request) throw new Error('request is required for add');
          const full = path.join(postmanDir, file);
          const col = readJson(full);

          const newItem = {
            name: request.name,
            request: {
              method: request.method,
              header: request.headers || [],
              body: request.body || {},
              url: request.url,
            },
            response: [],
          };

          if (!col.item) col.item = [];
          col.item.push(newItem);
          writeJson(full, col);

          return {
            content: [{ type: 'text', text: `✓ New request added: ${request.name}` }],
          };
        }
      }
    },
  },
  {
    name: 'pm_request',
    description:
      "Operate on a single Postman request. action='get' returns request details, 'update' modifies fields, 'delete' removes it, 'execute' runs it via HTTP, 'toMarkdown' renders it as Markdown, 'clone' duplicates it.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'update', 'delete', 'execute', 'toMarkdown', 'clone'],
          description: 'Operation to perform',
        },
        file: { type: 'string', description: 'Collection filename' },
        name: { type: 'string', description: 'Name of the target request' },
        updates: {
          type: 'object',
          description: 'Fields to update (for update)',
          properties: {
            newName: { type: 'string' },
            method: { type: 'string' },
            url: { type: 'string' },
            headers: { type: 'array', items: { type: 'object' } },
            body: { type: 'object' },
          },
        },
        cloneName: {
          type: 'string',
          description: 'Name for the cloned request (for clone)',
        },
      },
      required: ['action', 'file', 'name'],
    },
    handler: async (args: unknown) => {
      const { action, file, name, updates, cloneName } = z
        .object({
          action: z.enum(['get', 'update', 'delete', 'execute', 'toMarkdown', 'clone']),
          file: z.string(),
          name: z.string(),
          updates: z
            .object({
              newName: z.string().optional(),
              method: z.string().optional(),
              url: z.string().optional(),
              headers: z.array(z.any()).optional(),
              body: z.any().optional(),
            })
            .optional(),
          cloneName: z.string().optional(),
        })
        .parse(args);

      const postmanDir = getPostmanDir();
      const full = path.join(postmanDir, file);
      const col = readJson(full);

      switch (action) {
        case 'get': {
          const items = findAllItems(col.item || []);
          const hit = items.find(
            (it: Record<string, unknown>) =>
              (it.name as string)?.toLowerCase() === name.toLowerCase(),
          );
          if (!hit || !hit.request) throw new Error(`Request not found:${name}`);
          const req = hit.request as Record<string, unknown>;
          const examples = ((hit.response as Array<Record<string, unknown>>) || []).map((r) => ({
            name: r.name,
            code: r.code,
            body: r.body,
          }));
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    name: hit.name,
                    method: req.method,
                    url:
                      typeof req.url === 'string'
                        ? req.url
                        : (req.url as { raw?: string })?.raw || '',
                    headers: ((req.header as Array<{ key?: string; value?: string }>) || []).map(
                      (h) => ({ key: h.key, value: h.value }),
                    ),
                    body:
                      (req.body as Record<string, unknown>)?.raw ??
                      (req.body as Record<string, unknown>)?.graphql ??
                      (req.body as Record<string, unknown>)?.urlencoded ??
                      null,
                    examples,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case 'update': {
          if (!updates) throw new Error('updates is required for update');
          const found = findItemByName(col.item || [], name);
          if (!found || !found.item.request) throw new Error(`Request not found:${name}`);

          const item = found.item as Record<string, unknown>;
          const itemReq = item.request as Record<string, unknown>;

          if (updates.newName) item.name = updates.newName;
          if (updates.method) itemReq.method = updates.method;
          if (updates.url) {
            if (typeof itemReq.url === 'string') {
              itemReq.url = updates.url;
            } else {
              (itemReq.url as { raw?: string }).raw = updates.url;
            }
          }
          if (updates.headers) itemReq.header = updates.headers;
          if (updates.body) itemReq.body = updates.body;

          writeJson(full, col);

          return {
            content: [
              {
                type: 'text',
                text: `✓ Request updated:${name}${updates.newName ? ` → ${updates.newName}` : ''}`,
              },
            ],
          };
        }

        case 'delete': {
          const found = findItemByName(col.item || [], name);
          if (!found) throw new Error(`Request not found:${name}`);

          const index = found.parent.indexOf(found.item);
          if (index > -1) found.parent.splice(index, 1);

          writeJson(full, col);

          return {
            content: [{ type: 'text', text: `✓ Request deleted:${name}` }],
          };
        }

        case 'execute': {
          const items = findAllItems(col.item || []);
          const hit = items.find(
            (it: Record<string, unknown>) =>
              (it.name as string)?.toLowerCase() === name.toLowerCase(),
          );
          if (!hit || !hit.request) throw new Error(`Request not found:${name}`);

          const req = hit.request as Record<string, unknown>;
          const method = (req.method as string) || 'GET';
          const url =
            typeof req.url === 'string' ? req.url : (req.url as { raw?: string })?.raw || '';
          const headers: Record<string, string> = {};

          ((req.header as Array<{ key?: string; value?: string }>) || []).forEach((h) => {
            if (h.key && h.value) headers[h.key] = h.value;
          });

          let body: string | undefined;
          const reqBody = req.body as Record<string, unknown> | undefined;
          if (reqBody?.raw) body = reqBody.raw as string;
          else if (reqBody?.urlencoded) {
            body = new URLSearchParams(
              (reqBody.urlencoded as Array<{ key?: string; value?: string }>).map((e) => [
                e.key ?? '',
                e.value ?? '',
              ]),
            ).toString();
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
          }

          // Validate URL protocol before making request
          try {
            const parsedUrl = new URL(url);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
              throw new Error(`Unsafe URL protocol: ${parsedUrl.protocol} — only http: and https: are allowed`);
            }
          } catch (urlErr) {
            if (urlErr instanceof Error && urlErr.message.includes('Unsafe URL protocol')) throw urlErr;
            throw new Error(`Invalid URL: ${url}`);
          }

          const response = await fetch(url, { method, headers, body });
          const responseText = await response.text();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    request: { method, url, headers, body },
                    response: {
                      status: response.status,
                      statusText: response.statusText,
                      headers: Object.fromEntries(response.headers.entries()),
                      body: responseText,
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case 'toMarkdown': {
          const items = findAllItems(col.item || []);
          const hit = items.find(
            (it: Record<string, unknown>) =>
              (it.name as string)?.toLowerCase() === name.toLowerCase(),
          );
          if (!hit || !hit.request) throw new Error(`Request not found:${name}`);

          const req = hit.request as Record<string, unknown>;
          const urlRaw =
            typeof req.url === 'string' ? req.url : (req.url as { raw?: string })?.raw || '';
          const method = ((req.method as string) || 'GET').toUpperCase();
          const headers =
            ((req.header as Array<{ key?: string; value?: string }>) || [])
              .map((h) => `- ${h.key}: ${h.value}`)
              .join('\n') || '- (yok)';
          const urlObj = req.url as
            | {
                query?: Array<{ key?: string; value?: string }>;
                variable?: Array<{ key?: string; value?: string }>;
              }
            | undefined;
          const queryParams =
            (urlObj?.query || [])
              .map((q) => `- ${q.key}${q.value !== undefined ? ` = ${q.value}` : ''}`)
              .join('\n') || '- (yok)';
          const pathVars =
            (urlObj?.variable || [])
              .map((v) => `- ${v.key}${v.value !== undefined ? ` = ${v.value}` : ''}`)
              .join('\n') || '- (yok)';

          const reqBody = req.body as Record<string, unknown> | undefined;
          let bodyText = '';
          if (reqBody?.raw) bodyText = reqBody.raw as string;
          else if (reqBody?.urlencoded) bodyText = JSON.stringify(reqBody.urlencoded, null, 2);
          else if (reqBody?.graphql) bodyText = JSON.stringify(reqBody.graphql, null, 2);

          const resp = (hit.response as Array<Record<string, unknown>>)?.[0];
          const respBody = resp?.body || '';
          const respCode = resp?.code || 200;

          const md = [
            `### ${hit.name}`,
            '',
            `**Endpoint**`,
            '',
            `\`${method} ${urlRaw}\``,
            '',
            `**Path Parameters**`,
            '',
            pathVars,
            '',
            `**Query Parameters**`,
            '',
            queryParams,
            '',
            `**Request Headers**`,
            '',
            headers,
            '',
            `**Request Body**`,
            '',
            bodyText ? '```json\n' + bodyText + '\n```' : '- (none)',
            '',
            `**Sample Request**`,
            '',
            '```bash',
            `curl -X ${method} \\`,
            `  '${urlRaw}' \\`,
            ...((req.header as Array<{ key?: string; value?: string }>) || []).map(
              (h) => `  -H '${h.key}: ${h.value}' \\`,
            ),
            bodyText ? `  -d '${bodyText.replace(/\n/g, ' ')}'` : '',
            '```',
            '',
            `**Sample Response** \`HTTP ${respCode}\``,
            '',
            respBody ? '```json\n' + respBody + '\n```' : '- (no sample response)',
          ].join('\n');

          return { content: [{ type: 'text', text: md }] };
        }

        case 'clone': {
          if (!cloneName) throw new Error('cloneName is required for clone');
          const items = findAllItems(col.item || []);
          const source = items.find(
            (it: Record<string, unknown>) =>
              (it.name as string)?.toLowerCase() === name.toLowerCase(),
          );
          if (!source) throw new Error(`Request not found:${name}`);

          const cloned = JSON.parse(JSON.stringify(source));
          cloned.name = cloneName;

          if (!col.item) col.item = [];
          col.item.push(cloned);
          writeJson(full, col);

          return {
            content: [{ type: 'text', text: `✓ Request cloned:${name} → ${cloneName}` }],
          };
        }
      }
    },
  },
];
