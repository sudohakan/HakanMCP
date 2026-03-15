import { z } from 'zod';
import { SwarmCoordinator } from '../services/swarmCoordinator.js';

const swarm = new SwarmCoordinator();

export const swarmTools = [
  {
    name: 'swarm_create',
    description: 'Create a new swarm with a given topology and initial agents.',
    inputSchema: {
      type: 'object',
      properties: {
        topology: {
          type: 'string',
          enum: ['hierarchical', 'mesh', 'ring', 'star'],
          description: 'Swarm topology',
        },
        agents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              role: { type: 'string' },
              capabilities: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'role'],
          },
          description: 'Initial agents to add to the swarm',
        },
      },
      required: ['topology', 'agents'],
    },
    handler: async (args: unknown) => {
      const { topology, agents } = z
        .object({
          topology: z.enum(['hierarchical', 'mesh', 'ring', 'star']),
          agents: z.array(
            z.object({
              id: z.string(),
              role: z.string(),
              capabilities: z.array(z.string()).optional(),
            }),
          ),
        })
        .parse(args);

      const swarmAgents = agents.map((a) => ({
        id: a.id,
        role: a.role as 'queen' | 'lead' | 'worker' | 'peer',
        capabilities: a.capabilities ?? [],
        status: 'idle' as const,
        load: 0,
      }));

      const state = swarm.createSwarm(topology, swarmAgents);
      return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
    },
  },
  {
    name: 'swarm_addAgent',
    description: 'Add an agent to the existing swarm.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        role: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'role'],
    },
    handler: async (args: unknown) => {
      const { id, role, capabilities } = z
        .object({
          id: z.string(),
          role: z.string(),
          capabilities: z.array(z.string()).optional(),
        })
        .parse(args);

      swarm.addAgent({
        id,
        role: role as 'queen' | 'lead' | 'worker' | 'peer',
        capabilities: capabilities ?? [],
        status: 'idle',
        load: 0,
      });
      return { content: [{ type: 'text', text: `Agent ${id} added to swarm.` }] };
    },
  },
  {
    name: 'swarm_routeTask',
    description: 'Route a task to the most appropriate agent in the swarm.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Task type' },
        complexity: { type: 'number', description: 'Task complexity (optional)' },
      },
      required: ['type'],
    },
    handler: async (args: unknown) => {
      const { type, complexity } = z
        .object({ type: z.string(), complexity: z.number().optional() })
        .parse(args);

      const agentId = swarm.routeTask({ type, complexity: complexity ?? 5 });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ routedAgent: agentId, taskType: type }, null, 2) },
        ],
      };
    },
  },
  {
    name: 'swarm_reconfigure',
    description: 'Reconfigure the swarm to a new topology.',
    inputSchema: {
      type: 'object',
      properties: {
        topology: {
          type: 'string',
          enum: ['hierarchical', 'mesh', 'ring', 'star'],
        },
      },
      required: ['topology'],
    },
    handler: async (args: unknown) => {
      const { topology } = z
        .object({ topology: z.enum(['hierarchical', 'mesh', 'ring', 'star']) })
        .parse(args);

      const state = swarm.reconfigure(topology);
      return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
    },
  },
  {
    name: 'swarm_status',
    description: 'Get the current status of the swarm.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const state = swarm.getStatus();
        return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            },
          ],
        };
      }
    },
  },
];
