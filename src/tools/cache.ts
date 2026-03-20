import { z } from 'zod';
import { MultiLevelCache } from '../services/cacheService.js';

const cache = new MultiLevelCache<unknown>();

export const cacheTools = [
  {
    name: 'cache_entry',
    description: 'Read, write, or delete a single cache entry.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'delete'],
          description: 'Operation to perform on the cache entry',
        },
        key: { type: 'string', description: 'Cache key' },
        value: { type: 'string', description: 'JSON string or plain text value (required for set)' },
        ttlMs: { type: 'number', description: 'Optional TTL in milliseconds (set only)' },
      },
      required: ['action', 'key'],
    },
    handler: async (args: unknown) => {
      const { action, key, value, ttlMs } = z
        .object({
          action: z.enum(['get', 'set', 'delete']),
          key: z.string(),
          value: z.string().optional(),
          ttlMs: z.number().optional(),
        })
        .parse(args);

      if (action === 'get') {
        const result = await cache.get(key);
        return { content: [{ type: 'text', text: JSON.stringify({ key, value: result }, null, 2) }] };
      }

      if (action === 'set') {
        if (value === undefined) {
          throw new Error('value is required for action=set');
        }
        const parsed = (() => {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        })();
        await cache.set(key, parsed, ttlMs);
        return { content: [{ type: 'text', text: `✓ cache_set ${key}` }] };
      }

      await cache.delete(key);
      return { content: [{ type: 'text', text: `✓ cache_delete ${key}` }] };
    },
  },
  {
    name: 'cache_clear',
    description: 'Clear all entries from the cache.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await cache.clear();
      return { content: [{ type: 'text', text: '✓ cache cleared' }] };
    },
  },
  {
    name: 'cache_stats',
    description: 'Returns cache statistics.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      return { content: [{ type: 'text', text: JSON.stringify(cache.stats(), null, 2) }] };
    },
  },
];
