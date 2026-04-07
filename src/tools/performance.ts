import { z } from 'zod';

function runBenchmark(iterations: number): {
  iterations: number;
  elapsedMs: number;
  opsPerSec: number;
} {
  const start = performance.now();
  let acc = 0;
  for (let i = 0; i < iterations; i++) {
    acc += i % 7;
  }
  void acc; // Prevent loop optimization in benchmark
  const elapsedMs = performance.now() - start;
  const opsPerSec = elapsedMs > 0 ? (iterations / elapsedMs) * 1000 : iterations;
  return { iterations, elapsedMs, opsPerSec: Number(opsPerSec.toFixed(2)) };
}

export const performanceTools = [
  {
    name: 'perf_benchmark',
    description: 'Runs simple CPU benchmark (loop).',
    inputSchema: {
      type: 'object',
      properties: {
        iterations: { type: 'number', description: 'Default 10000' },
        repeat: { type: 'number', description: 'Default 1' },
      },
    },
    handler: async (args: unknown) => {
      const { iterations = 10000, repeat = 1 } = z
        .object({ iterations: z.number().optional(), repeat: z.number().optional() })
        .parse(args || {});
      const runs = Array.from({ length: repeat }, () => runBenchmark(iterations));
      const avgOps = runs.reduce((s, r) => s + r.opsPerSec, 0) / runs.length;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ runs, averageOpsPerSec: Number(avgOps.toFixed(2)) }, null, 2),
          },
        ],
      };
    },
  },
];
