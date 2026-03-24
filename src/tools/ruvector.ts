import { z } from 'zod';
import { HnswBridge, SonaEngine } from '../services/ruvectorBridge.js';

const hnsw = new HnswBridge({ dimensions: 384 });
const sona = new SonaEngine({ dimensions: 384 });

export const ruvectorTools = [
  {
    name: 'ruvector',
    description: 'Vector operations. Actions: add, search, remove, learn, patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'search', 'remove', 'learn', 'patterns'],
          description: 'Operation to perform',
        },
        id: { type: 'string', description: 'Vector ID (required for add, remove)' },
        vector: {
          type: 'array',
          items: { type: 'number' },
          description: 'Embedding vector (required for add)',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata object (add action)',
        },
        query: {
          type: 'array',
          items: { type: 'number' },
          description: 'Query vector (required for search, patterns)',
        },
        k: { type: 'number', description: 'Number of results (default 5, for search/patterns)' },
        trajectories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              states: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
              actions: { type: 'array', items: { type: 'string' } },
              rewards: { type: 'array', items: { type: 'number' } },
              quality: { type: 'number' },
            },
            required: ['states', 'actions', 'rewards', 'quality'],
          },
          description: 'Trajectories for SONA learning (learn action)',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, id, vector, metadata, query, k, trajectories } = z
        .object({
          action: z.enum(['add', 'search', 'remove', 'learn', 'patterns']),
          id: z.string().optional(),
          vector: z.array(z.number()).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
          query: z.array(z.number()).optional(),
          k: z.number().int().positive().optional(),
          trajectories: z
            .array(
              z.object({
                states: z.array(z.array(z.number())),
                actions: z.array(z.string()),
                rewards: z.array(z.number()),
                quality: z.number(),
              }),
            )
            .optional(),
        })
        .parse(args);

      switch (action) {
        case 'add': {
          if (!id) throw new Error('id is required for action=add');
          if (!vector) throw new Error('vector is required for action=add');
          hnsw.add(id, vector, metadata as Record<string, unknown> | undefined);
          return { content: [{ type: 'text', text: `Vector ${id} added (size=${hnsw.size()}).` }] };
        }

        case 'search': {
          if (!query) throw new Error('query is required for action=search');
          const results = hnsw.search(query, k ?? 5);
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }

        case 'remove': {
          if (!id) throw new Error('id is required for action=remove');
          const success = hnsw.remove(id);
          return {
            content: [{ type: 'text', text: JSON.stringify({ id, success }, null, 2) }],
          };
        }

        case 'learn': {
          if (!trajectories) throw new Error('trajectories is required for action=learn');
          const result = sona.learn(trajectories);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'patterns': {
          if (!query) throw new Error('query is required for action=patterns');
          const patterns = sona.findPatterns(query, k ?? 5);
          return { content: [{ type: 'text', text: JSON.stringify(patterns, null, 2) }] };
        }
      }
    },
  },
];
