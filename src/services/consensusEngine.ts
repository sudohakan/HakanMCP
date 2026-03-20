
export type ConsensusProtocol = 'majority' | 'byzantine' | 'raft' | 'gossip' | 'crdt';

export interface ConsensusVote {
  agentId: string;
  vote: unknown;
  round?: number;
  timestamp: number;
}

export interface ConsensusResult {
  protocol: ConsensusProtocol;
  decision: unknown;
  votes: ConsensusVote[];
  consensusReached: boolean;
  rounds: number;
  latencyMs: number;
}

interface ProtocolInfo {
  description: string;
  tolerance: string;
  latency: string;
}


export class GCounter {
  private counts: Map<string, number> = new Map();

  increment(nodeId: string, amount: number = 1): void {
    if (amount < 0) {
      throw new Error('GCounter does not support negative increments');
    }
    const current = this.counts.get(nodeId) ?? 0;
    this.counts.set(nodeId, current + amount);
  }

  value(): number {
    let sum = 0;
    for (const v of this.counts.values()) sum += v;
    return sum;
  }

  merge(other: GCounter): void {
    for (const [nodeId, otherVal] of other.counts.entries()) {
      const localVal = this.counts.get(nodeId) ?? 0;
      this.counts.set(nodeId, Math.max(localVal, otherVal));
    }
  }

  getState(): Map<string, number> {
    return new Map(this.counts);
  }
}


export class PNCounter {
  private p: GCounter = new GCounter();
  private n: GCounter = new GCounter();

  increment(nodeId: string, amount: number = 1): void {
    this.p.increment(nodeId, amount);
  }

  decrement(nodeId: string, amount: number = 1): void {
    this.n.increment(nodeId, amount);
  }

  value(): number {
    return this.p.value() - this.n.value();
  }

  merge(other: PNCounter): void {
    this.p.merge(other.p);
    this.n.merge(other.n);
  }

  /** Expose internals for testing */
  getP(): GCounter {
    return this.p;
  }

  getN(): GCounter {
    return this.n;
  }
}

export class ORSet<T> {
  /** element (serialised) → set of unique tags */
  private elements: Map<string, Set<string>> = new Map();
  private tagCounter = 0;

  private serialise(element: T): string {
    return JSON.stringify(element);
  }

  private makeTag(nodeId: string): string {
    return `${nodeId}:${++this.tagCounter}:${Date.now()}`;
  }

  add(nodeId: string, element: T): void {
    const key = this.serialise(element);
    if (!this.elements.has(key)) {
      this.elements.set(key, new Set());
    }
    this.elements.get(key)!.add(this.makeTag(nodeId));
  }

  remove(element: T): void {
    const key = this.serialise(element);
    this.elements.delete(key);
  }

  has(element: T): boolean {
    const key = this.serialise(element);
    const tags = this.elements.get(key);
    return tags !== undefined && tags.size > 0;
  }

  values(): T[] {
    const result: T[] = [];
    for (const [key, tags] of this.elements.entries()) {
      if (tags.size > 0) {
        result.push(JSON.parse(key) as T);
      }
    }
    return result;
  }

  merge(other: ORSet<T>): void {
    for (const [key, otherTags] of other.elements.entries()) {
      if (!this.elements.has(key)) {
        this.elements.set(key, new Set());
      }
      for (const tag of otherTags) {
        this.elements.get(key)!.add(tag);
      }
    }
  }

  /** Expose internal state for testing */
  getState(): Map<string, Set<string>> {
    return new Map(
      [...this.elements.entries()].map(([k, v]) => [k, new Set(v)]),
    );
  }
}

export class ConsensusEngine {
  private history: ConsensusResult[] = [];

  async reachConsensus(
    protocol: ConsensusProtocol,
    agents: string[],
    proposal: unknown,
  ): Promise<ConsensusResult> {
    const start = Date.now();

    let result: ConsensusResult;
    switch (protocol) {
      case 'majority':
        result = this.runMajority(agents, proposal, start);
        break;
      case 'byzantine':
        result = this.runByzantine(agents, proposal, start);
        break;
      case 'raft':
        result = this.runRaft(agents, proposal, start);
        break;
      case 'gossip':
        result = this.runGossip(agents, proposal, start);
        break;
      case 'crdt':
        result = this.runCrdt(agents, proposal, start);
        break;
      default:
        throw new Error(`Unknown protocol: ${protocol as string}`);
    }

    this.history.push(result);
    return result;
  }

  getProtocolInfo(protocol: ConsensusProtocol): ProtocolInfo {
    const info: Record<ConsensusProtocol, ProtocolInfo> = {
      majority: {
        description: 'Simple majority voting — each agent casts a binary vote',
        tolerance: 'Tolerates up to 49% faulty nodes',
        latency: 'Single round, O(n) messages',
      },
      byzantine: {
        description: 'PBFT-style three-phase protocol (pre-prepare, prepare, commit)',
        tolerance: 'Tolerates up to f < n/3 Byzantine faults',
        latency: 'Three rounds, O(n^2) messages',
      },
      raft: {
        description: 'Leader-based log replication with term-based elections',
        tolerance: 'Tolerates up to (n-1)/2 crash faults',
        latency: 'Two rounds (election + append), O(n) messages',
      },
      gossip: {
        description: 'Epidemic push/pull protocol for eventual consistency',
        tolerance: 'Highly tolerant — probabilistic convergence',
        latency: 'O(log n) rounds to converge',
      },
      crdt: {
        description: 'Conflict-free Replicated Data Types — mathematical convergence',
        tolerance: 'Tolerates any number of partitions — always converges',
        latency: 'Zero coordination, local apply + background merge',
      },
    };
    return info[protocol];
  }

  getHistory(): ConsensusResult[] {
    return [...this.history];
  }

  private runMajority(
    agents: string[],
    proposal: unknown,
    start: number,
  ): ConsensusResult {
    const votes: ConsensusVote[] = agents.map((agentId) => ({
      agentId,
      vote: Math.random() > 0.2 ? 'approve' : 'reject',
      round: 1,
      timestamp: Date.now(),
    }));

    const approvals = votes.filter((v) => v.vote === 'approve').length;
    const consensusReached = approvals > agents.length / 2;

    return {
      protocol: 'majority',
      decision: consensusReached ? proposal : null,
      votes,
      consensusReached,
      rounds: 1,
      latencyMs: Date.now() - start,
    };
  }

  private runByzantine(
    agents: string[],
    proposal: unknown,
    start: number,
  ): ConsensusResult {
    const phases = ['pre-prepare', 'prepare', 'commit'] as const;
    const allVotes: ConsensusVote[] = [];
    const threshold = Math.ceil((agents.length * 2) / 3);
    let consensusReached = true;

    for (let round = 0; round < phases.length; round++) {
      const roundVotes: ConsensusVote[] = agents.map((agentId) => ({
        agentId,
        vote: Math.random() > 0.2 ? phases[round] : 'fault',
        round: round + 1,
        timestamp: Date.now(),
      }));
      allVotes.push(...roundVotes);

      const agreements = roundVotes.filter(
        (v) => v.vote === phases[round],
      ).length;
      if (agreements < threshold) {
        consensusReached = false;
      }
    }

    return {
      protocol: 'byzantine',
      decision: consensusReached ? proposal : null,
      votes: allVotes,
      consensusReached,
      rounds: 3,
      latencyMs: Date.now() - start,
    };
  }

  private runRaft(
    agents: string[],
    proposal: unknown,
    start: number,
  ): ConsensusResult {
    const allVotes: ConsensusVote[] = [];

    const terms = agents.map((agentId) => {
      const term = Math.floor(Math.random() * 1000);
      const vote: ConsensusVote = {
        agentId,
        vote: { type: 'election', term },
        round: 1,
        timestamp: Date.now(),
      };
      allVotes.push(vote);
      return { agentId, term };
    });

    const leader = terms.reduce((a, b) => (a.term >= b.term ? a : b));

    const majority = Math.ceil(agents.length / 2);
    let acks = 0;
    for (const agentId of agents) {
      const isAck = agentId === leader.agentId || Math.random() > 0.1;
      const vote: ConsensusVote = {
        agentId,
        vote: { type: 'append', ack: isAck, leader: leader.agentId },
        round: 2,
        timestamp: Date.now(),
      };
      allVotes.push(vote);
      if (isAck) acks++;
    }

    const consensusReached = acks >= majority;

    return {
      protocol: 'raft',
      decision: consensusReached ? proposal : null,
      votes: allVotes,
      consensusReached,
      rounds: 2,
      latencyMs: Date.now() - start,
    };
  }

  private runGossip(
    agents: string[],
    proposal: unknown,
    start: number,
  ): ConsensusResult {
    const allVotes: ConsensusVote[] = [];
    const rounds = Math.max(1, Math.ceil(Math.log2(agents.length)));

    for (let round = 1; round <= rounds; round++) {
      for (const agentId of agents) {
        allVotes.push({
          agentId,
          vote: { type: 'gossip-push', data: proposal, round },
          round,
          timestamp: Date.now(),
        });
      }
    }

    return {
      protocol: 'gossip',
      decision: proposal,
      votes: allVotes,
      consensusReached: true,
      rounds,
      latencyMs: Date.now() - start,
    };
  }

  private runCrdt(
    agents: string[],
    proposal: unknown,
    start: number,
  ): ConsensusResult {
    const votes: ConsensusVote[] = agents.map((agentId) => ({
      agentId,
      vote: { type: 'crdt-merge', value: proposal },
      round: 1,
      timestamp: Date.now(),
    }));

    return {
      protocol: 'crdt',
      decision: proposal,
      votes,
      consensusReached: true,
      rounds: 1,
      latencyMs: Date.now() - start,
    };
  }
}
