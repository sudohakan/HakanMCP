import { z } from 'zod';
import { ConsensusEngine } from '../services/consensusEngine.js';

let _engine: ConsensusEngine | null = null;
function getEngine(): ConsensusEngine {
  if (!_engine) _engine = new ConsensusEngine();
  return _engine;
}

export const consensusTools = [
  {
    name: 'consensus',
    description: 'Consensus operations. Actions: reach, protocols, history.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['reach', 'protocols', 'history'],
          description: 'reach: run consensus protocol. protocols: list available protocols. history: retrieve past consensus rounds.',
        },
        protocol: {
          type: 'string',
          enum: ['majority', 'byzantine', 'raft', 'gossip', 'crdt'],
          description: 'Consensus protocol to use (required for reach)',
        },
        agents: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of agent IDs participating in consensus (required for reach)',
        },
        proposal: {
          type: 'string',
          description: 'The proposal to reach consensus on (required for reach)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of history entries to return (history action)',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, protocol, agents, proposal, limit } = z
        .object({
          action: z.enum(['reach', 'protocols', 'history']),
          protocol: z.enum(['majority', 'byzantine', 'raft', 'gossip', 'crdt']).optional(),
          agents: z.array(z.string()).optional(),
          proposal: z.string().optional(),
          limit: z.number().optional(),
        })
        .parse(args);

      switch (action) {
        case 'reach': {
          if (!protocol) throw new Error('protocol is required for action=reach');
          if (!agents) throw new Error('agents is required for action=reach');
          if (!proposal) throw new Error('proposal is required for action=reach');
          const result = await getEngine().reachConsensus(protocol, agents, proposal);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'protocols': {
          const protocols = ['majority', 'byzantine', 'raft', 'gossip', 'crdt'] as const;
          const info = Object.fromEntries(
            protocols.map((p) => [p, getEngine().getProtocolInfo(p)]),
          );
          return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
        }

        case 'history': {
          const history = getEngine().getHistory();
          const result = limit !== undefined ? history.slice(0, limit) : history;
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
      }
    },
  },
];
