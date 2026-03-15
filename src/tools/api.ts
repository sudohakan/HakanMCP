import { z } from 'zod';

// Lightweight rate limiter (token bucket per process)
let bucket = 20;
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    bucket = Math.min(20, bucket + 5);
  }, 1000);
}

function takeToken(): boolean {
  if (bucket <= 0) return false;
  bucket -= 1;
  return true;
}

const openapi = {
  openapi: '3.0.1',
  info: { title: 'Hakan MCP REST Wrapper', version: '1.0.0' },
  paths: {
    '/tools/call': {
      post: {
        summary: 'Invoke a tool',
        requestBody: { required: true },
        responses: { '200': { description: 'Tool response' } },
      },
    },
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/webhook': {
      post: {
        summary: 'Receive webhook event',
        requestBody: { required: true },
        responses: { '200': { description: 'Accepted' } },
      },
    },
  },
};

export const apiTools = [
  {
    name: 'api_restWrapperInfo',
    description:
      "REST API wrapper information. action='info' returns setup guide, action='spec' returns OpenAPI specification skeleton.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['info', 'spec'] },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action } = z.object({ action: z.enum(['info', 'spec']) }).parse(args);
      if (action === 'spec') {
        return {
          content: [{ type: 'text', text: JSON.stringify(openapi, null, 2) }],
        };
      }
      // action === 'info'
      return {
        content: [
          {
            type: 'text',
            text:
              'REST wrapper iskeleti: \n' +
              '- /tools/call: tool invoke\n' +
              '- /health: vitality\\n' +
              '- /webhook: event kabul\n' +
              'Rate limit: token bucket (20 capacity, +5 per second).\\n' +
              'This tool does not start the HTTP server yet; Provides documentation for API clients.',
          },
        ],
      };
    },
  },
  {
    name: 'api_rateLimitStatus',
    description: 'Returns the simple rate limit status (token bucket).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ bucket }, null, 2) }],
    }),
  },
  {
    name: 'api_webhookHandle',
    description: 'The webhook verifies the payload and returns an acceptance message.',
    inputSchema: {
      type: 'object',
      properties: {
        event: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['event', 'payload'],
    },
    handler: async (args: unknown) => {
      if (!takeToken()) {
        return { content: [{ type: 'text', text: '429 Too Many Requests' }], isError: true };
      }
      const { event, payload } = z
        .object({ event: z.string(), payload: z.record(z.string(), z.unknown()) })
        .parse(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { accepted: true, event, receivedAt: new Date().toISOString(), payload },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
];
