import { z } from 'zod';
import { httpClient } from '../utils/httpClient.js';
import { createJsonResponse } from '../utils/common.js';

export const httpTools = [
  {
    name: 'http_request',
    description:
      'Sends an HTTP request (GET, POST, PUT, PATCH, DELETE, etc.) with optional authentication, headers, body, timeout, and retry support.',
    inputSchema: {
      type: 'object' as const,
      properties: {
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
      },
      required: ['url'],
    },
    handler: async (args: unknown) => {
      const { url, method, headers, body, timeout, retries, auth } = z
        .object({
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
        })
        .parse(args);

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
    },
  },

  {
    name: 'http_downloadFile',
    description: 'Downloads a file from URL and saves it to the specified path.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'File URL to download' },
        outputPath: { type: 'string', description: 'Path to save the file' },
        headers: { type: 'object', description: 'HTTP headers (optional)' },
      },
      required: ['url', 'outputPath'],
    },
    handler: async (args: unknown) => {
      const { url, outputPath, headers } = z
        .object({
          url: z.string().url(),
          outputPath: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
        })
        .parse(args);

      const result = await httpClient.downloadFile(url, outputPath, { headers });

      return {
        content: [
          {
            type: 'text' as const,
            text: `File downloaded: ${result.path} (${result.size} bytes)`,
          },
        ],
      };
    },
  },
];
