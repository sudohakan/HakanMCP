import { z } from 'zod';
import { httpClient } from '../utils/httpClient.js';
import { createJsonResponse } from '../utils/common.js';

export const httpTools = [
  {
    name: 'http',
    description: 'HTTP operations. Actions: request, downloadFile.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['request', 'downloadFile'],
          description: 'Operation to perform',
        },
        url: { type: 'string', description: 'Request URL' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'HTTP headers (optional)' },
        body: { type: 'string', description: 'Request body (optional)' },
        timeout: { type: 'number', description: 'Timeout in ms (optional)' },
        retries: { type: 'number', description: 'Number of retries (optional)' },
        auth: {
          type: 'object',
          description: 'Authentication options (optional)',
          properties: {
            type: {
              type: 'string',
              enum: ['bearer', 'basic', 'apiKey'],
              description: 'Authentication type',
            },
            token: { type: 'string', description: 'Bearer token (for bearer auth)' },
            username: { type: 'string', description: 'Username (for basic auth)' },
            password: { type: 'string', description: 'Password (for basic auth)' },
            apiKey: { type: 'string', description: 'API key (for apiKey auth)' },
            headerName: {
              type: 'string',
              description: 'API key header name (for apiKey auth, default: X-API-Key)',
            },
          },
          required: ['type'],
        },
        outputPath: { type: 'string', description: 'Path to save the file (downloadFile only)' },
      },
      required: ['action', 'url'],
    },
    handler: async (args: unknown) => {
      const { action, url, method, headers, body, timeout, retries, auth, outputPath } = z
        .object({
          action: z.enum(['request', 'downloadFile']),
          url: z.string().url(),
          method: z.string().default('GET'),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.string().optional(),
          timeout: z.number().optional(),
          retries: z.number().optional(),
          auth: z
            .object({
              type: z.enum(['bearer', 'basic', 'apiKey']),
              token: z.string().optional(),
              username: z.string().optional(),
              password: z.string().optional(),
              apiKey: z.string().optional(),
              headerName: z.string().optional(),
            })
            .optional(),
          outputPath: z.string().optional(),
        })
        .parse(args);

      switch (action) {
        case 'request': {
          let response: Awaited<ReturnType<typeof httpClient.request>>;

          if (auth?.type === 'bearer') {
            response = await httpClient.withBearer(url, auth.token ?? '', { method, body });
          } else if (auth?.type === 'basic') {
            response = await httpClient.withBasicAuth(url, auth.username ?? '', auth.password ?? '', {
              method,
              body,
            });
          } else if (auth?.type === 'apiKey') {
            response = await httpClient.withApiKey(url, auth.apiKey ?? '', {
              method,
              body,
              headerName: auth.headerName,
            });
          } else {
            response = await httpClient.request(url, { method, headers, body, timeout, retries });
          }

          return createJsonResponse(response);
        }

        case 'downloadFile': {
          if (!outputPath) throw new Error('outputPath is required for action=downloadFile');
          const result = await httpClient.downloadFile(url, outputPath, { headers });
          return {
            content: [
              {
                type: 'text' as const,
                text: `File downloaded: ${result.path} (${result.size} bytes)`,
              },
            ],
          };
        }
      }
    },
  },
];
