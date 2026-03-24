import { z } from 'zod';
import { MultiLevelCache } from '../services/cacheService.js';

const cache = new MultiLevelCache<unknown>();

export const cacheTools = [
  {
    name: 'cache',
    description: 'Cache operations. Actions: get, set, delete, clear, stats.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'delete', 'clear', 'stats'],
          description: 'Operation to perform on the cache',
        },
        key: { type: 'string', description: 'Cache key (required for get, set, delete)' },
        value: { type: 'string', description: 'JSON string or plain text value (required for set)' },
        ttlMs: { type: 'number', description: 'Optional TTL in milliseconds (set only)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, key, value, ttlMs } = z
        .object({
          action: z.enum(['get', 'set', 'delete', 'clear', 'stats']),
          key: z.string().optional(),
          value: z.string().optional(),
          ttlMs: z.number().optional(),
        })
        .parse(args);

      switch (action) {
        case 'get': {
          if (!key) throw new Error('key is required for action=get');
          const result = await cache.get(key);
          return { content: [{ type: 'text', text: JSON.stringify({ key, value: result }, null, 2) }] };
        }

        case 'set': {
          if (!key) throw new Error('key is required for action=set');
          if (value === undefined) throw new Error('value is required for action=set');
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

        case 'delete': {
          if (!key) throw new Error('key is required for action=delete');
          await cache.delete(key);
          return { content: [{ type: 'text', text: `✓ cache_delete ${key}` }] };
        }

        case 'clear': {
          await cache.clear();
          return { content: [{ type: 'text', text: '✓ cache cleared' }] };
        }

        case 'stats': {
          return { content: [{ type: 'text', text: JSON.stringify(cache.stats(), null, 2) }] };
        }
      }
    },
  },
];
