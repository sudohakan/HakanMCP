import { z } from 'zod';
import { ConsensusEngine } from '../services/consensusEngine.js';

const engine = new ConsensusEngine();

export const consensusTools = [
  {
    name: 'consensus_reach',
    description: 'Run a consensus protocol among a set of agents on a proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        protocol: {
          type: 'string',
          enum: ['majority', 'byzantine', 'raft', 'gossip', 'crdt'],
          description: 'Consensus protocol to use',
        },
        agents: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of agent IDs participating in consensus',
        },
        proposal: {
          type: 'string',
          description: 'The proposal to reach consensus on',
        },
      },
      required: ['protocol', 'agents', 'proposal'],
    },
    handler: async (args: unknown) => {
      const { protocol, agents, proposal } = z
        .object({
          protocol: z.enum(['majority', 'byzantine', 'raft', 'gossip', 'crdt']),
          agents: z.array(z.string()),
          proposal: z.string(),
        })
        .parse(args);

      const result = await engine.reachConsensus(protocol, agents, proposal);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  },
  {
    name: 'consensus_history',
    description:
      "Query consensus information. action='protocols' lists available consensus protocols, action='history' retrieves past consensus rounds with optional limit.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['protocols', 'history'],
          description: 'protocols: list available consensus protocols. history: retrieve past consensus rounds.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of history entries to return (only applicable when action=history)',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, limit } = z
        .object({
          action: z.enum(['protocols', 'history']),
          limit: z.number().optional(),
        })
        .parse(args);

      if (action === 'protocols') {
        const protocols = ['majority', 'byzantine', 'raft', 'gossip', 'crdt'] as const;
        const info = Object.fromEntries(
          protocols.map((p) => [p, engine.getProtocolInfo(p)]),
        );
        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
      } else {
        const history = engine.getHistory();
        const result = limit !== undefined ? history.slice(0, limit) : history;
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    },
  },
];
