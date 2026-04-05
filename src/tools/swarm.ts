import { z } from 'zod';
import { SwarmCoordinator } from '../services/swarmCoordinator.js';

let _swarm: SwarmCoordinator | null = null;
function getSwarm(): SwarmCoordinator {
  if (!_swarm) _swarm = new SwarmCoordinator();
  return _swarm;
}

export const swarmTools = [
  {
    name: 'swarm',
    description: 'Swarm coordination operations. Actions: create, addAgent, routeTask, reconfigure, status.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'addAgent', 'routeTask', 'reconfigure', 'status'],
          description: 'Operation to perform',
        },
        topology: {
          type: 'string',
          enum: ['hierarchical', 'mesh', 'ring', 'star'],
          description: 'Swarm topology (required for create, reconfigure)',
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
          description: 'Initial agents to add to the swarm (required for create)',
        },
        id: { type: 'string', description: 'Agent ID (required for addAgent)' },
        role: { type: 'string', description: 'Agent role (required for addAgent)' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Agent capabilities (addAgent)' },
        type: { type: 'string', description: 'Task type (required for routeTask)' },
        complexity: { type: 'number', description: 'Task complexity (routeTask, optional)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, topology, agents, id, role, capabilities, type, complexity } = z
        .object({
          action: z.enum(['create', 'addAgent', 'routeTask', 'reconfigure', 'status']),
          topology: z.enum(['hierarchical', 'mesh', 'ring', 'star']).optional(),
          agents: z
            .array(
              z.object({
                id: z.string(),
                role: z.string(),
                capabilities: z.array(z.string()).optional(),
              }),
            )
            .optional(),
          id: z.string().optional(),
          role: z.string().optional(),
          capabilities: z.array(z.string()).optional(),
          type: z.string().optional(),
          complexity: z.number().optional(),
        })
        .parse(args);

      switch (action) {
        case 'create': {
          if (!topology) throw new Error('topology is required for action=create');
          if (!agents) throw new Error('agents is required for action=create');
          const swarmAgents = agents.map((a) => ({
            id: a.id,
            role: a.role as 'queen' | 'lead' | 'worker' | 'peer',
            capabilities: a.capabilities ?? [],
            status: 'idle' as const,
            load: 0,
          }));
          const state = getSwarm().createSwarm(topology, swarmAgents);
          return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
        }

        case 'addAgent': {
          if (!id) throw new Error('id is required for action=addAgent');
          if (!role) throw new Error('role is required for action=addAgent');
          getSwarm().addAgent({
            id,
            role: role as 'queen' | 'lead' | 'worker' | 'peer',
            capabilities: capabilities ?? [],
            status: 'idle',
            load: 0,
          });
          return { content: [{ type: 'text', text: `Agent ${id} added to swarm.` }] };
        }

        case 'routeTask': {
          if (!type) throw new Error('type is required for action=routeTask');
          const agentId = getSwarm().routeTask({ type, complexity: complexity ?? 5 });
          return {
            content: [
              { type: 'text', text: JSON.stringify({ routedAgent: agentId, taskType: type }, null, 2) },
            ],
          };
        }

        case 'reconfigure': {
          if (!topology) throw new Error('topology is required for action=reconfigure');
          const state = getSwarm().reconfigure(topology);
          return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
        }

        case 'status': {
          try {
            const state = getSwarm().getStatus();
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
        }
      }
    },
  },
];
