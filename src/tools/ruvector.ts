import { z } from 'zod';
import { HnswBridge, SonaEngine } from '../services/ruvectorBridge.js';

const hnsw = new HnswBridge({ dimensions: 384 });
const sona = new SonaEngine({ dimensions: 384 });

export const ruvectorTools = [
  {
    name: 'ruvector_add',
    description: 'Add a vector with an ID and optional metadata to the HNSW index.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        vector: {
          type: 'array',
          items: { type: 'number' },
          description: 'Embedding vector (must match index dimensions)',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata object',
        },
      },
      required: ['id', 'vector'],
    },
    handler: async (args: unknown) => {
      const { id, vector, metadata } = z
        .object({
          id: z.string(),
          vector: z.array(z.number()),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(args);

      hnsw.add(id, vector, metadata as Record<string, unknown> | undefined);
      return { content: [{ type: 'text', text: `Vector ${id} added (size=${hnsw.size()}).` }] };
    },
  },
  {
    name: 'ruvector_search',
    description: 'Search the HNSW index for the k nearest vectors to a query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'array',
          items: { type: 'number' },
          description: 'Query vector',
        },
        k: { type: 'number', description: 'Number of results (default 5)' },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const { query, k } = z
        .object({ query: z.array(z.number()), k: z.number().int().positive().optional() })
        .parse(args);

      const results = hnsw.search(query, k ?? 5);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  },
  {
    name: 'ruvector_remove',
    description: 'Remove a vector by ID from the HNSW index.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (args: unknown) => {
      const { id } = z.object({ id: z.string() }).parse(args);
      const success = hnsw.remove(id);
      return {
        content: [{ type: 'text', text: JSON.stringify({ id, success }, null, 2) }],
      };
    },
  },
  {
    name: 'ruvector_learn',
    description: 'Feed trajectories into the SONA continual-learning engine.',
    inputSchema: {
      type: 'object',
      properties: {
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
        },
      },
      required: ['trajectories'],
    },
    handler: async (args: unknown) => {
      const { trajectories } = z
        .object({
          trajectories: z.array(
            z.object({
              states: z.array(z.array(z.number())),
              actions: z.array(z.string()),
              rewards: z.array(z.number()),
              quality: z.number(),
            }),
          ),
        })
        .parse(args);

      const result = sona.learn(trajectories);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  },
  {
    name: 'ruvector_patterns',
    description: 'Find learned patterns similar to a query vector using SONA.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'array',
          items: { type: 'number' },
          description: 'Query vector',
        },
        k: { type: 'number', description: 'Number of patterns (default 5)' },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const { query, k } = z
        .object({ query: z.array(z.number()), k: z.number().int().positive().optional() })
        .parse(args);

      const patterns = sona.findPatterns(query, k ?? 5);
      return { content: [{ type: 'text', text: JSON.stringify(patterns, null, 2) }] };
    },
  },
];
