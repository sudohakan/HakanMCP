import { z } from 'zod';

interface QueryRecord {
  name: string;
  durationMs: number;
  timestamp: string;
}

const records: QueryRecord[] = [];

export const dbMonitoringTools = [
  {
    name: 'db_monitor',
    description:
      'Database query monitoring. Actions: record (log query duration), slow (list slow queries), stats (p95/p99 stats), clear (reset all stats).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['record', 'slow', 'stats', 'clear'],
          description: 'Action to perform',
        },
        name: { type: 'string', description: 'Query name (required for record)' },
        durationMs: { type: 'number', description: 'Query duration in ms (required for record)' },
        thresholdMs: { type: 'number', description: 'Slow query threshold in ms (for slow, default 500)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          action: z.enum(['record', 'slow', 'stats', 'clear']),
          name: z.string().optional(),
          durationMs: z.number().nonnegative().optional(),
          thresholdMs: z.number().optional(),
        })
        .parse(args);

      switch (parsed.action) {
        case 'record': {
          if (!parsed.name || parsed.durationMs === undefined) {
            return {
              content: [{ type: 'text', text: 'record action requires "name" and "durationMs".' }],
              isError: true,
            };
          }
          const entry: QueryRecord = {
            name: parsed.name,
            durationMs: parsed.durationMs,
            timestamp: new Date().toISOString(),
          };
          records.push(entry);
          return {
            content: [
              { type: 'text', text: `recorded ${parsed.name} (${parsed.durationMs} ms)` },
            ],
          };
        }
        case 'slow': {
          const thresholdMs = parsed.thresholdMs ?? 500;
          const slow = records.filter((r) => r.durationMs >= thresholdMs);
          return {
            content: [
              { type: 'text', text: JSON.stringify({ count: slow.length, slow }, null, 2) },
            ],
          };
        }
        case 'stats': {
          if (records.length === 0) {
            return { content: [{ type: 'text', text: JSON.stringify({ count: 0 }) }] };
          }
          const durations = [...records.map((r) => r.durationMs)].sort((a, b) => a - b);
          const p = (q: number) =>
            durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * q))];
          const stats = {
            count: durations.length,
            min: durations[0],
            max: durations[durations.length - 1],
            p95: p(0.95),
            p99: p(0.99),
          };
          return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
        }
        case 'clear': {
          records.splice(0, records.length);
          return { content: [{ type: 'text', text: 'db stats cleared' }] };
        }
      }
    },
  },
];
