import { z } from 'zod';

interface Expert {
  id: number;
  name: string;
  specializations: string[];
  weight: number;
  tasksRouted: number;
  avgConfidence: number;
}

const experts: Expert[] = [
  { id: 1, name: 'transform', specializations: ['transform', 'wasm', 'convert', 'parse'], weight: 1, tasksRouted: 0, avgConfidence: 0 },
  { id: 2, name: 'bugfix', specializations: ['bug', 'fix', 'error', 'issue', 'crash', 'fail'], weight: 1, tasksRouted: 0, avgConfidence: 0 },
  { id: 3, name: 'refactor', specializations: ['refactor', 'clean', 'restructure', 'reorganize'], weight: 1, tasksRouted: 0, avgConfidence: 0 },
  { id: 4, name: 'architecture', specializations: ['architecture', 'design', 'system', 'schema', 'model'], weight: 1, tasksRouted: 0, avgConfidence: 0 },
  { id: 5, name: 'testing', specializations: ['test', 'spec', 'coverage', 'assertion', 'mock'], weight: 1, tasksRouted: 0, avgConfidence: 0 },
  { id: 6, name: 'docs', specializations: ['doc', 'document', 'readme', 'comment', 'jsdoc'], weight: 1, tasksRouted: 0, avgConfidence: 0 },
  { id: 7, name: 'security', specializations: ['security', 'auth', 'vulnerability', 'encrypt', 'injection'], weight: 1, tasksRouted: 0, avgConfidence: 0 },
  { id: 8, name: 'performance', specializations: ['performance', 'optimize', 'speed', 'latency', 'throughput'], weight: 1, tasksRouted: 0, avgConfidence: 0 },
];

const BASE_TIERS: Record<string, 'wasm' | 'haiku' | 'sonnet' | 'opus'> = {
  transform: 'wasm',
  bugfix: 'sonnet',
  refactor: 'sonnet',
  architecture: 'opus',
  testing: 'haiku',
  docs: 'haiku',
  security: 'opus',
  performance: 'sonnet',
};

function selectExpert(description: string): { expert: Expert; confidence: number } {
  const lower = description.toLowerCase();
  let bestExpert = experts[0];
  let bestScore = 0;

  for (const expert of experts) {
    let score = 0;
    for (const spec of expert.specializations) {
      if (lower.includes(spec)) {
        score += expert.weight;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestExpert = expert;
    }
  }

  const confidence = bestScore > 0 ? Math.min(0.5 + bestScore * 0.15, 0.99) : 0.4;
  return { expert: bestExpert, confidence };
}

function adjustTier(
  expertName: string,
  complexity: number,
): 'wasm' | 'haiku' | 'sonnet' | 'opus' {
  if (complexity > 7) return 'opus';
  if (complexity < 3) return 'haiku';
  return BASE_TIERS[expertName] ?? 'sonnet';
}

export const moeRouterTools = [
  {
    name: 'moe_route',
    description:
      "MoE (Mixture of Experts) router. action='route' routes a task to the best expert and determines AI tier. action='experts' lists all available experts with routing stats.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['route', 'experts'],
          description: "Action to perform: 'route' to route a task, 'experts' to list all experts.",
        },
        taskDescription: {
          type: 'string',
          description: "Task description (required when action='route')",
        },
        preferredTier: {
          type: 'string',
          enum: ['wasm', 'haiku', 'sonnet', 'opus'],
          description: "Preferred AI tier override (optional, used when action='route')",
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, taskDescription, preferredTier } = z
        .object({
          action: z.enum(['route', 'experts']),
          taskDescription: z.string().optional(),
          preferredTier: z.enum(['wasm', 'haiku', 'sonnet', 'opus']).optional(),
        })
        .parse(args);

      switch (action) {
        case 'route': {
          if (!taskDescription) {
            throw new Error("taskDescription is required when action='route'");
          }

          const complexity = 5;
          const { expert, confidence } = selectExpert(taskDescription);
          const tier = preferredTier ?? adjustTier(expert.name, complexity);

          const prev = expert.tasksRouted;
          expert.tasksRouted += 1;
          expert.avgConfidence = (expert.avgConfidence * prev + confidence) / expert.tasksRouted;

          const result: {
            expert: string;
            expertId: number;
            confidence: number;
            tier: string;
            complexity: number;
            wasmBoosterAvailable?: boolean;
          } = {
            expert: expert.name,
            expertId: expert.id,
            confidence: Math.round(confidence * 100) / 100,
            tier,
            complexity,
          };

          if (expert.name === 'transform' && complexity < 3) {
            result.wasmBoosterAvailable = true;
          }

          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'experts': {
          const info = experts.map((e) => ({
            ...e,
            baseTier: BASE_TIERS[e.name] ?? 'sonnet',
            avgConfidence: Math.round(e.avgConfidence * 100) / 100,
          }));
          return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
        }
      }
    },
  },
];
