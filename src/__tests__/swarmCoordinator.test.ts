import {
  SwarmCoordinator,
  type SwarmAgent,
} from '../services/swarmCoordinator.js';

function makeAgent(id: string, role: SwarmAgent['role'], load = 0): SwarmAgent {
  return { id, role, capabilities: ['general'], status: 'idle', load };
}

describe('SwarmCoordinator', () => {
  let coord: SwarmCoordinator;

  beforeEach(() => {
    coord = new SwarmCoordinator();
  });

  describe('createSwarm — hierarchical', () => {
    it('should build queen→lead→worker connections', () => {
      const agents: SwarmAgent[] = [
        makeAgent('q1', 'queen'),
        makeAgent('l1', 'lead'),
        makeAgent('w1', 'worker'),
        makeAgent('w2', 'worker'),
      ];
      const state = coord.createSwarm('hierarchical', agents);

      expect(state.topology).toBe('hierarchical');
      expect(state.agents).toHaveLength(4);
      expect(state.leader).toBe('q1');
      expect(state.connections).toHaveLength(3);
      expect(state.connections.some((c) => c.from === 'q1' && c.to === 'l1' && c.type === 'leader')).toBe(true);
      expect(state.connections.some((c) => c.from === 'l1' && c.to === 'w1' && c.type === 'worker')).toBe(true);
      expect(state.connections.some((c) => c.from === 'l1' && c.to === 'w2' && c.type === 'worker')).toBe(true);
    });

    it('should connect queen directly to workers when no leads', () => {
      const agents: SwarmAgent[] = [
        makeAgent('q1', 'queen'),
        makeAgent('w1', 'worker'),
        makeAgent('w2', 'worker'),
      ];
      const state = coord.createSwarm('hierarchical', agents);

      expect(state.connections).toHaveLength(2);
      expect(state.connections.every((c) => c.from === 'q1')).toBe(true);
    });
  });

  describe('createSwarm — mesh', () => {
    it('should create n*(n-1)/2 peer connections', () => {
      const agents = [makeAgent('a', 'peer'), makeAgent('b', 'peer'), makeAgent('c', 'peer'), makeAgent('d', 'peer')];
      const state = coord.createSwarm('mesh', agents);

      expect(state.topology).toBe('mesh');
      expect(state.connections).toHaveLength(6);
      expect(state.connections.every((c) => c.type === 'peer')).toBe(true);
    });
  });

  describe('createSwarm — ring', () => {
    it('should create circular n connections', () => {
      const agents = [makeAgent('a', 'peer'), makeAgent('b', 'peer'), makeAgent('c', 'peer')];
      const state = coord.createSwarm('ring', agents);

      expect(state.topology).toBe('ring');
      expect(state.connections).toHaveLength(3);
      expect(state.connections[0]).toEqual({ from: 'a', to: 'b', type: 'peer' });
      expect(state.connections[1]).toEqual({ from: 'b', to: 'c', type: 'peer' });
      expect(state.connections[2]).toEqual({ from: 'c', to: 'a', type: 'peer' });
    });
  });

  describe('createSwarm — star', () => {
    it('should connect hub to all others', () => {
      const agents: SwarmAgent[] = [
        makeAgent('hub', 'queen'),
        makeAgent('s1', 'worker'),
        makeAgent('s2', 'worker'),
        makeAgent('s3', 'worker'),
      ];
      const state = coord.createSwarm('star', agents);

      expect(state.topology).toBe('star');
      expect(state.leader).toBe('hub');
      expect(state.connections).toHaveLength(3);
      expect(state.connections.every((c) => c.from === 'hub')).toBe(true);
    });
  });

  describe('routeTask', () => {
    it('hierarchical → routes to queen', () => {
      const agents: SwarmAgent[] = [
        makeAgent('q1', 'queen'),
        makeAgent('w1', 'worker'),
      ];
      coord.createSwarm('hierarchical', agents);
      expect(coord.routeTask({ type: 'compute', complexity: 5 })).toBe('q1');
    });

    it('mesh → routes to least loaded agent', () => {
      const agents: SwarmAgent[] = [
        makeAgent('a', 'peer', 80),
        makeAgent('b', 'peer', 20),
        makeAgent('c', 'peer', 50),
      ];
      coord.createSwarm('mesh', agents);
      expect(coord.routeTask({ type: 'compute', complexity: 3 })).toBe('b');
    });

    it('ring → routes round-robin', () => {
      const agents: SwarmAgent[] = [
        makeAgent('a', 'peer'),
        makeAgent('b', 'peer'),
        makeAgent('c', 'peer'),
      ];
      coord.createSwarm('ring', agents);

      expect(coord.routeTask({ type: 'x', complexity: 1 })).toBe('a');
      expect(coord.routeTask({ type: 'x', complexity: 1 })).toBe('b');
      expect(coord.routeTask({ type: 'x', complexity: 1 })).toBe('c');
      expect(coord.routeTask({ type: 'x', complexity: 1 })).toBe('a');
    });

    it('star → routes to hub', () => {
      const agents: SwarmAgent[] = [
        makeAgent('hub', 'queen'),
        makeAgent('s1', 'worker'),
      ];
      coord.createSwarm('star', agents);
      expect(coord.routeTask({ type: 'compute', complexity: 1 })).toBe('hub');
    });

    it('returns null when all agents failed', () => {
      const agents: SwarmAgent[] = [
        { id: 'a', role: 'peer', capabilities: [], status: 'failed', load: 0 },
      ];
      coord.createSwarm('mesh', agents);
      expect(coord.routeTask({ type: 'x', complexity: 1 })).toBeNull();
    });
  });

  describe('addAgent', () => {
    it('should add agent and rebuild connections', () => {
      coord.createSwarm('mesh', [makeAgent('a', 'peer'), makeAgent('b', 'peer')]);
      const state = coord.addAgent(makeAgent('c', 'peer'));

      expect(state.agents).toHaveLength(3);
      expect(state.connections).toHaveLength(3);
    });
  });

  describe('removeAgent', () => {
    it('should remove agent and rebuild connections', () => {
      coord.createSwarm('mesh', [
        makeAgent('a', 'peer'),
        makeAgent('b', 'peer'),
        makeAgent('c', 'peer'),
      ]);
      const state = coord.removeAgent('c');

      expect(state.agents).toHaveLength(2);
      expect(state.connections).toHaveLength(1);
    });

    it('should re-elect leader when leader is removed', () => {
      coord.createSwarm('star', [
        makeAgent('hub', 'queen'),
        makeAgent('w1', 'worker'),
        makeAgent('w2', 'worker'),
      ]);
      expect(coord.getStatus().leader).toBe('hub');

      const state = coord.removeAgent('hub');
      expect(state.leader).toBeDefined();
      expect(state.leader).not.toBe('hub');
      expect(state.agents).toHaveLength(2);
    });
  });

  describe('reconfigure', () => {
    it('should switch topology and rebuild connections', () => {
      coord.createSwarm('mesh', [
        makeAgent('a', 'peer'),
        makeAgent('b', 'peer'),
        makeAgent('c', 'peer'),
      ]);
      expect(coord.getStatus().connections).toHaveLength(3);

      const state = coord.reconfigure('ring');
      expect(state.topology).toBe('ring');
      expect(state.connections).toHaveLength(3);
      expect(state.connections[0].from).toBe('a');
      expect(state.connections[0].to).toBe('b');
    });

    it('mesh → star reassigns roles', () => {
      coord.createSwarm('mesh', [
        makeAgent('a', 'peer'),
        makeAgent('b', 'peer'),
        makeAgent('c', 'peer'),
      ]);
      const state = coord.reconfigure('star');

      expect(state.topology).toBe('star');
      const hub = state.agents.find((a) => a.role === 'queen');
      expect(hub).toBeDefined();
      expect(state.connections).toHaveLength(2);
    });
  });

  describe('scaleAgents', () => {
    it('should add workers to reach target count', () => {
      coord.createSwarm('mesh', [makeAgent('a', 'peer')]);
      const state = coord.scaleAgents(4);

      expect(state.agents).toHaveLength(4);
      const newAgents = state.agents.filter((a) => a.id !== 'a');
      expect(newAgents).toHaveLength(3);
      expect(newAgents.every((a) => a.role === 'worker')).toBe(true);
    });

    it('should not remove agents when count is less than current', () => {
      coord.createSwarm('mesh', [makeAgent('a', 'peer'), makeAgent('b', 'peer'), makeAgent('c', 'peer')]);
      const state = coord.scaleAgents(1);
      expect(state.agents).toHaveLength(3);
    });
  });

  describe('getStatus', () => {
    it('should return a snapshot (not a reference)', () => {
      coord.createSwarm('mesh', [makeAgent('a', 'peer'), makeAgent('b', 'peer')]);
      const s1 = coord.getStatus();
      const s2 = coord.getStatus();

      expect(s1).toEqual(s2);
      expect(s1.agents).not.toBe(s2.agents);
    });
  });
});
