import { z } from 'zod';
import { AIDefence } from '../services/aiDefence.js';

const defence = new AIDefence();

export const aiDefenceTools = [
  {
    name: 'aidefence',
    description:
      'AI Defence toolkit. Actions: scan (threat detection), hasPii (PII check), redactPii (PII redaction).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['scan', 'hasPii', 'redactPii'],
          description: 'Action to perform',
        },
        text: {
          type: 'string',
          description: 'Text to process (used by all actions)',
        },
      },
      required: ['action', 'text'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          action: z.enum(['scan', 'hasPii', 'redactPii']),
          text: z.string(),
        })
        .parse(args);

      switch (parsed.action) {
        case 'scan': {
          const result = defence.scan(parsed.text);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'hasPii': {
          const hasPii = defence.hasPii(parsed.text);
          return { content: [{ type: 'text', text: JSON.stringify({ hasPii }, null, 2) }] };
        }
        case 'redactPii': {
          const redacted = defence.redactPii(parsed.text);
          return { content: [{ type: 'text', text: JSON.stringify({ redacted }, null, 2) }] };
        }
      }
    },
  },
];
