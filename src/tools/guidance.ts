import { z } from 'zod';
import { GuidanceEngine } from '../services/guidanceEngine.js';

const engine = new GuidanceEngine();

export const guidanceTools = [
  {
    name: 'guidance',
    description: 'Policy guidance operations. Actions: compile, enforce, audit.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['compile', 'enforce', 'audit'],
          description: 'Operation to perform',
        },
        content: { type: 'string', description: 'Policy document content to compile into rules (compile action)' },
        policyAction: { type: 'string', description: 'The action to check against policy rules (enforce action)' },
        context: { type: 'object', description: 'Optional context (e.g., files, user, scope) (enforce action)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, content, policyAction, context } = z
        .object({
          action: z.enum(['compile', 'enforce', 'audit']),
          content: z.string().optional(),
          policyAction: z.string().optional(),
          context: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(args);

      switch (action) {
        case 'compile': {
          if (!content) throw new Error('content is required for action=compile');
          const rules = engine.compilePolicy(content);
          return { content: [{ type: 'text', text: JSON.stringify(rules, null, 2) }] };
        }

        case 'enforce': {
          if (!policyAction) throw new Error('policyAction is required for action=enforce');
          const result = engine.enforce(policyAction, (context as Record<string, unknown>) ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'audit': {
          const trail = engine.getAuditTrail();
          return { content: [{ type: 'text', text: JSON.stringify(trail, null, 2) }] };
        }
      }
    },
  },
];
