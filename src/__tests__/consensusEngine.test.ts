import {
  ConsensusEngine,
  GCounter,
  PNCounter,
  ORSet,
} from '../services/consensusEngine.js';
import type { ConsensusProtocol } from '../services/consensusEngine.js';

describe('ConsensusEngine', () => {
  let engine: ConsensusEngine;
  const agents = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];

  beforeEach(() => {
    engine = new ConsensusEngine();
  });

  describe('majority protocol', () => {
    it('should return a ConsensusResult with correct protocol', async () => {
      const result = await engine.reachConsensus('majority', agents, 'proposal-A');
      expect(result.protocol).toBe('majority');
      expect(result.rounds).toBe(1);
      expect(result.votes).toHaveLength(agents.length);
      expect(typeof result.consensusReached).toBe('boolean');
      expect(typeof result.latencyMs).toBe('number');
    });

    it('should have each agent vote approve or reject', async () => {
      const result = await engine.reachConsensus('majority', agents, 'x');
      for (const vote of result.votes) {
        expect(['approve', 'reject']).toContain(vote.vote);
        expect(agents).toContain(vote.agentId);
        expect(vote.round).toBe(1);
      }
    });

    it('should set decision to proposal when consensus reached', async () => {
      let reached = false;
      for (let i = 0; i < 50; i++) {
        const r = await engine.reachConsensus('majority', agents, 'yes');
        if (r.consensusReached) {
          expect(r.decision).toBe('yes');
          reached = true;
          break;
        }
      }
      expect(reached).toBe(true);
    });

    it('should set decision to null when consensus not reached', async () => {
      let failed = false;
      for (let i = 0; i < 200; i++) {
        const r = await engine.reachConsensus('majority', ['a'], 'val');
        if (!r.consensusReached) {
          expect(r.decision).toBeNull();
          failed = true;
          break;
        }
      }
      expect(failed).toBe(true);
    });
  });

  describe('byzantine protocol', () => {
    it('should run 3 rounds with correct phase names', async () => {
      const result = await engine.reachConsensus('byzantine', agents, 'byz-prop');
      expect(result.protocol).toBe('byzantine');
      expect(result.rounds).toBe(3);
      expect(result.votes).toHaveLength(agents.length * 3);
    });

    it('should have votes labelled by round', async () => {
      const result = await engine.reachConsensus('byzantine', agents, 'p');
      const roundNumbers = [...new Set(result.votes.map((v) => v.round))];
      expect(roundNumbers.sort()).toEqual([1, 2, 3]);
    });

    it('votes should contain phase names or fault', async () => {
      const result = await engine.reachConsensus('byzantine', agents, 'p');
      const validVotes = ['pre-prepare', 'prepare', 'commit', 'fault'];
      for (const vote of result.votes) {
        expect(validVotes).toContain(vote.vote);
      }
    });
  });

  describe('raft protocol', () => {
    it('should run 2 rounds (election + append)', async () => {
      const result = await engine.reachConsensus('raft', agents, 'raft-prop');
      expect(result.protocol).toBe('raft');
      expect(result.rounds).toBe(2);
      expect(result.votes.length).toBe(agents.length * 2);
    });

    it('round 1 votes should be election type with term', async () => {
      const result = await engine.reachConsensus('raft', agents, 'p');
      const round1 = result.votes.filter((v) => v.round === 1);
      expect(round1).toHaveLength(agents.length);
      for (const v of round1) {
        const vote = v.vote as { type: string; term: number };
        expect(vote.type).toBe('election');
        expect(typeof vote.term).toBe('number');
      }
    });

    it('round 2 votes should be append type with ack', async () => {
      const result = await engine.reachConsensus('raft', agents, 'p');
      const round2 = result.votes.filter((v) => v.round === 2);
      expect(round2).toHaveLength(agents.length);
      for (const v of round2) {
        const vote = v.vote as { type: string; ack: boolean; leader: string };
        expect(vote.type).toBe('append');
        expect(typeof vote.ack).toBe('boolean');
        expect(agents).toContain(vote.leader);
      }
    });
  });

  describe('gossip protocol', () => {
    it('should always converge (consensusReached = true)', async () => {
      const result = await engine.reachConsensus('gossip', agents, 'gossip-data');
      expect(result.protocol).toBe('gossip');
      expect(result.consensusReached).toBe(true);
      expect(result.decision).toBe('gossip-data');
    });

    it('should have O(log n) rounds', async () => {
      const result = await engine.reachConsensus('gossip', agents, 'd');
      const expected = Math.max(1, Math.ceil(Math.log2(agents.length)));
      expect(result.rounds).toBe(expected);
    });
  });

  describe('crdt protocol', () => {
    it('should always succeed', async () => {
      const result = await engine.reachConsensus('crdt', agents, { key: 'value' });
      expect(result.protocol).toBe('crdt');
      expect(result.consensusReached).toBe(true);
      expect(result.decision).toEqual({ key: 'value' });
      expect(result.rounds).toBe(1);
    });
  });

  describe('getProtocolInfo', () => {
    const protocols: ConsensusProtocol[] = ['majority', 'byzantine', 'raft', 'gossip', 'crdt'];

    it.each(protocols)('should return info for %s', (protocol) => {
      const info = engine.getProtocolInfo(protocol);
      expect(typeof info.description).toBe('string');
      expect(typeof info.tolerance).toBe('string');
      expect(typeof info.latency).toBe('string');
      expect(info.description.length).toBeGreaterThan(0);
    });
  });

  describe('getHistory', () => {
    it('should start empty', () => {
      expect(engine.getHistory()).toEqual([]);
    });

    it('should accumulate results', async () => {
      await engine.reachConsensus('majority', agents, 'a');
      await engine.reachConsensus('gossip', agents, 'b');
      await engine.reachConsensus('crdt', agents, 'c');
      const history = engine.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].protocol).toBe('majority');
      expect(history[1].protocol).toBe('gossip');
      expect(history[2].protocol).toBe('crdt');
    });

    it('should return a copy (not a reference)', async () => {
      await engine.reachConsensus('crdt', agents, 'x');
      const h1 = engine.getHistory();
      const h2 = engine.getHistory();
      expect(h1).toEqual(h2);
      expect(h1).not.toBe(h2);
    });
  });
});

describe('GCounter', () => {
  it('should start at 0', () => {
    const c = new GCounter();
    expect(c.value()).toBe(0);
  });

  it('should increment by 1 by default', () => {
    const c = new GCounter();
    c.increment('A');
    expect(c.value()).toBe(1);
  });

  it('should increment by arbitrary amount', () => {
    const c = new GCounter();
    c.increment('A', 5);
    c.increment('A', 3);
    expect(c.value()).toBe(8);
  });

  it('should track multiple nodes independently', () => {
    const c = new GCounter();
    c.increment('A', 3);
    c.increment('B', 7);
    c.increment('C', 2);
    expect(c.value()).toBe(12);
  });

  it('should reject negative increments', () => {
    const c = new GCounter();
    expect(() => c.increment('A', -1)).toThrow();
  });

  describe('merge', () => {
    it('should take max per node', () => {
      const a = new GCounter();
      const b = new GCounter();
      a.increment('X', 5);
      a.increment('Y', 3);
      b.increment('X', 3);
      b.increment('Y', 7);

      a.merge(b);
      expect(a.value()).toBe(12);
    });

    it('should add new nodes from other', () => {
      const a = new GCounter();
      const b = new GCounter();
      a.increment('X', 5);
      b.increment('Y', 10);

      a.merge(b);
      expect(a.value()).toBe(15);
    });

    it('should be idempotent', () => {
      const a = new GCounter();
      const b = new GCounter();
      a.increment('X', 5);
      b.increment('X', 3);

      a.merge(b);
      const v1 = a.value();
      a.merge(b);
      expect(a.value()).toBe(v1);
    });

    it('should be commutative', () => {
      const a1 = new GCounter();
      const a2 = new GCounter();
      const b = new GCounter();

      a1.increment('X', 5);
      a2.increment('X', 5);
      b.increment('Y', 3);

      a1.merge(b);
      b.merge(a2);

      expect(a1.value()).toBe(b.value());
    });
  });
});

describe('PNCounter', () => {
  it('should start at 0', () => {
    const c = new PNCounter();
    expect(c.value()).toBe(0);
  });

  it('should increment', () => {
    const c = new PNCounter();
    c.increment('A', 5);
    expect(c.value()).toBe(5);
  });

  it('should decrement', () => {
    const c = new PNCounter();
    c.increment('A', 10);
    c.decrement('A', 3);
    expect(c.value()).toBe(7);
  });

  it('should support negative values', () => {
    const c = new PNCounter();
    c.decrement('A', 5);
    expect(c.value()).toBe(-5);
  });

  it('should track inc/dec from multiple nodes', () => {
    const c = new PNCounter();
    c.increment('A', 10);
    c.increment('B', 5);
    c.decrement('A', 3);
    c.decrement('B', 2);
    expect(c.value()).toBe(10);
  });

  describe('merge', () => {
    it('should merge both P and N counters', () => {
      const a = new PNCounter();
      const b = new PNCounter();

      a.increment('X', 10);
      a.decrement('X', 2);

      b.increment('X', 6);
      b.decrement('X', 4);

      a.merge(b);
      expect(a.value()).toBe(6);
    });

    it('should handle disjoint nodes', () => {
      const a = new PNCounter();
      const b = new PNCounter();

      a.increment('X', 10);
      b.increment('Y', 5);
      b.decrement('Y', 1);

      a.merge(b);
      expect(a.value()).toBe(14);
    });
  });
});

describe('ORSet', () => {
  it('should start empty', () => {
    const s = new ORSet<string>();
    expect(s.values()).toEqual([]);
  });

  it('should add elements', () => {
    const s = new ORSet<string>();
    s.add('A', 'hello');
    expect(s.has('hello')).toBe(true);
    expect(s.values()).toEqual(['hello']);
  });

  it('should remove elements', () => {
    const s = new ORSet<string>();
    s.add('A', 'hello');
    s.remove('hello');
    expect(s.has('hello')).toBe(false);
    expect(s.values()).toEqual([]);
  });

  it('should handle add-remove-add', () => {
    const s = new ORSet<string>();
    s.add('A', 'x');
    s.remove('x');
    s.add('A', 'x');
    expect(s.has('x')).toBe(true);
  });

  it('should remove only clears existing tags', () => {
    const s = new ORSet<string>();
    s.add('A', 'x');
    s.remove('x');
    expect(s.has('x')).toBe(false);
  });

  it('should handle multiple elements', () => {
    const s = new ORSet<number>();
    s.add('A', 1);
    s.add('A', 2);
    s.add('B', 3);
    expect(s.has(1)).toBe(true);
    expect(s.has(2)).toBe(true);
    expect(s.has(3)).toBe(true);
    expect(s.values().sort()).toEqual([1, 2, 3]);
  });

  it('should handle removing non-existent element gracefully', () => {
    const s = new ORSet<string>();
    s.remove('nonexistent');
    expect(s.has('nonexistent')).toBe(false);
  });

  describe('merge', () => {
    it('should union elements from two sets', () => {
      const a = new ORSet<string>();
      const b = new ORSet<string>();

      a.add('A', 'x');
      b.add('B', 'y');

      a.merge(b);
      expect(a.has('x')).toBe(true);
      expect(a.has('y')).toBe(true);
    });

    it('should preserve elements added concurrently after remove', () => {
      const a = new ORSet<string>();
      const b = new ORSet<string>();

      a.add('A', 'x');
      b.merge(a);

      a.remove('x');
      b.add('B', 'x');

      a.merge(b);
      expect(a.has('x')).toBe(true);
    });

    it('should handle objects as elements', () => {
      const s = new ORSet<{ id: number }>();
      s.add('A', { id: 1 });
      s.add('B', { id: 2 });
      expect(s.has({ id: 1 })).toBe(true);
      expect(s.has({ id: 2 })).toBe(true);
      expect(s.has({ id: 3 })).toBe(false);
    });

    it('should be idempotent', () => {
      const a = new ORSet<string>();
      const b = new ORSet<string>();
      b.add('B', 'hello');

      a.merge(b);
      const v1 = a.values();
      a.merge(b);
      const v2 = a.values();
      expect(v1).toEqual(v2);
    });
  });
});
