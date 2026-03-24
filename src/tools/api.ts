import { z } from 'zod';

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
    name: 'api',
    description: 'REST API wrapper operations. Actions: info, spec, rateLimitStatus, webhookHandle.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['info', 'spec', 'rateLimitStatus', 'webhookHandle'],
          description: 'Operation to perform',
        },
        event: { type: 'string', description: 'Webhook event name (webhookHandle)' },
        payload: { type: 'object', description: 'Webhook payload (webhookHandle)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, event, payload } = z
        .object({
          action: z.enum(['info', 'spec', 'rateLimitStatus', 'webhookHandle']),
          event: z.string().optional(),
          payload: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(args);

      switch (action) {
        case 'info': {
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
        }

        case 'spec': {
          return {
            content: [{ type: 'text', text: JSON.stringify(openapi, null, 2) }],
          };
        }

        case 'rateLimitStatus': {
          return {
            content: [{ type: 'text', text: JSON.stringify({ bucket }, null, 2) }],
          };
        }

        case 'webhookHandle': {
          if (!takeToken()) {
            return { content: [{ type: 'text', text: '429 Too Many Requests' }], isError: true };
          }
          if (!event) throw new Error('event is required for action=webhookHandle');
          if (!payload) throw new Error('payload is required for action=webhookHandle');
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
        }
      }
    },
  },
];
