import { z } from 'zod';
import { GuidanceEngine } from '../services/guidanceEngine.js';

const engine = new GuidanceEngine();

export const guidanceTools = [
  {
    name: 'guidance_compile',
    description: 'Compile a policy document into active rules for the guidance engine.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Policy document content to compile into rules' },
      },
      required: ['content'],
    },
    handler: async (args: unknown) => {
      const { content } = z.object({ content: z.string() }).parse(args);
      const rules = engine.compilePolicy(content);
      return { content: [{ type: 'text', text: JSON.stringify(rules, null, 2) }] };
    },
  },
  {
    name: 'guidance_enforce',
    description: 'Enforce current policy rules against a proposed action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action to check against policy rules' },
        context: { type: 'object', description: 'Optional context (e.g., files, user, scope)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, context } = z
        .object({
          action: z.string(),
          context: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(args);

      const result = engine.enforce(action, (context as Record<string, unknown>) ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  },
  {
    name: 'guidance_audit',
    description: 'Retrieve the full audit trail of all policy enforcement decisions.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const trail = engine.getAuditTrail();
      return { content: [{ type: 'text', text: JSON.stringify(trail, null, 2) }] };
    },
  },
];
