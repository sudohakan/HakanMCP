export type SwarmTopology = 'hierarchical' | 'mesh' | 'ring' | 'star';

export interface SwarmAgent {
  id: string;
  role: 'queen' | 'lead' | 'worker' | 'peer';
  capabilities: string[];
  status: 'idle' | 'busy' | 'failed';
  load: number;
}

export interface MeshConnection {
  from: string;
  to: string;
  type: 'peer' | 'leader' | 'worker';
  weight?: number;
}

export interface SwarmState {
  topology: SwarmTopology;
  agents: SwarmAgent[];
  connections: MeshConnection[];
  leader?: string;
  createdAt: number;
}

interface TaskRequest {
  type: string;
  complexity: number;
}

export class SwarmCoordinator {
  private state: SwarmState;
  private roundRobinIndex = 0;

  constructor() {
    this.state = {
      topology: 'mesh',
      agents: [],
      connections: [],
      createdAt: Date.now(),
    };
  }

  createSwarm(topology: SwarmTopology, agents: SwarmAgent[]): SwarmState {
    this.state = {
      topology,
      agents: [...agents],
      connections: [],
      createdAt: Date.now(),
    };
    this.electLeader();
    this.buildConnections();
    return this.getStatus();
  }

  addAgent(agent: SwarmAgent): SwarmState {
    this.state.agents.push({ ...agent });
    this.electLeader();
    this.buildConnections();
    return this.getStatus();
  }

  removeAgent(agentId: string): SwarmState {
    this.state.agents = this.state.agents.filter((a) => a.id !== agentId);
    const wasLeader = this.state.leader === agentId;
    if (wasLeader) {
      this.state.leader = undefined;
    }
    this.electLeader();
    this.buildConnections();
    return this.getStatus();
  }

  routeTask(_task: TaskRequest): string | null {
    const available = this.state.agents.filter((a) => a.status !== 'failed');
    if (available.length === 0) return null;

    switch (this.state.topology) {
      case 'hierarchical':
        return this.routeHierarchical(available);
      case 'mesh':
        return this.routeMesh(available);
      case 'ring':
        return this.routeRing(available);
      case 'star':
        return this.routeStar(available);
      default:
        return null;
    }
  }

  reconfigure(newTopology: SwarmTopology): SwarmState {
    this.state.topology = newTopology;
    this.assignRoles();
    this.electLeader();
    this.buildConnections();
    this.roundRobinIndex = 0;
    return this.getStatus();
  }

  scaleAgents(count: number): SwarmState {
    const current = this.state.agents.length;
    if (count <= current) return this.getStatus();
    for (let i = current; i < count; i++) {
      this.state.agents.push({
        id: `worker-${Date.now()}-${i}`,
        role: 'worker',
        capabilities: ['general'],
        status: 'idle',
        load: 0,
      });
    }
    this.electLeader();
    this.buildConnections();
    return this.getStatus();
  }

  getStatus(): SwarmState {
    return {
      topology: this.state.topology,
      agents: [...this.state.agents],
      connections: [...this.state.connections],
      leader: this.state.leader,
      createdAt: this.state.createdAt,
    };
  }

  private electLeader(): void {
    if (this.state.agents.length === 0) {
      this.state.leader = undefined;
      return;
    }
    if (this.state.leader) {
      const existing = this.state.agents.find((a) => a.id === this.state.leader);
      if (existing && existing.status !== 'failed') return;
    }
    const queen = this.state.agents.find((a) => a.role === 'queen' && a.status !== 'failed');
    if (queen) {
      this.state.leader = queen.id;
      return;
    }
    const lead = this.state.agents.find((a) => a.role === 'lead' && a.status !== 'failed');
    if (lead) {
      this.state.leader = lead.id;
      return;
    }
    const any = this.state.agents.find((a) => a.status !== 'failed');
    if (any) {
      this.state.leader = any.id;
    } else {
      this.state.leader = undefined;
    }
  }

  private assignRoles(): void {
    const topology = this.state.topology;
    if (topology === 'mesh') {
      for (const agent of this.state.agents) {
        agent.role = 'peer';
      }
    } else if (topology === 'ring') {
      for (const agent of this.state.agents) {
        agent.role = 'peer';
      }
    } else if (topology === 'star') {
      const hub = this.state.agents.find((a) => a.role === 'queen') ?? this.state.agents[0];
      for (const agent of this.state.agents) {
        agent.role = agent.id === hub?.id ? 'queen' : 'worker';
      }
    } else if (topology === 'hierarchical') {
      const hasQueen = this.state.agents.some((a) => a.role === 'queen');
      if (!hasQueen && this.state.agents.length > 0) {
        this.state.agents[0].role = 'queen';
      }
    }
  }

  private buildConnections(): void {
    this.state.connections = [];
    const agents = this.state.agents;
    if (agents.length < 2) return;

    switch (this.state.topology) {
      case 'hierarchical':
        this.buildHierarchical();
        break;
      case 'mesh':
        this.buildMesh();
        break;
      case 'ring':
        this.buildRing();
        break;
      case 'star':
        this.buildStar();
        break;
    }
  }

  private buildHierarchical(): void {
    const agents = this.state.agents;
    const queens = agents.filter((a) => a.role === 'queen');
    const leads = agents.filter((a) => a.role === 'lead');
    const workers = agents.filter((a) => a.role === 'worker');

    if (leads.length > 0) {
      for (const q of queens) {
        for (const l of leads) {
          this.state.connections.push({ from: q.id, to: l.id, type: 'leader' });
        }
      }
      for (let i = 0; i < workers.length; i++) {
        const lead = leads[i % leads.length];
        this.state.connections.push({ from: lead.id, to: workers[i].id, type: 'worker' });
      }
    } else {
      for (const q of queens) {
        for (const w of workers) {
          this.state.connections.push({ from: q.id, to: w.id, type: 'worker' });
        }
      }
    }
  }

  private buildMesh(): void {
    const agents = this.state.agents;
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        this.state.connections.push({
          from: agents[i].id,
          to: agents[j].id,
          type: 'peer',
        });
      }
    }
  }

  private buildRing(): void {
    const agents = this.state.agents;
    for (let i = 0; i < agents.length; i++) {
      const next = (i + 1) % agents.length;
      this.state.connections.push({
        from: agents[i].id,
        to: agents[next].id,
        type: 'peer',
      });
    }
  }

  private buildStar(): void {
    const agents = this.state.agents;
    const hubId = this.state.leader ?? agents[0].id;
    for (const agent of agents) {
      if (agent.id !== hubId) {
        this.state.connections.push({
          from: hubId,
          to: agent.id,
          type: 'worker',
        });
      }
    }
  }

  private routeHierarchical(available: SwarmAgent[]): string | null {
    const queen = available.find((a) => a.role === 'queen');
    if (queen) return queen.id;
    const lead = available.find((a) => a.role === 'lead');
    if (lead) return lead.id;
    return available[0]?.id ?? null;
  }

  private routeMesh(available: SwarmAgent[]): string | null {
    let min = available[0];
    for (const a of available) {
      if (a.load < min.load) min = a;
    }
    return min.id;
  }

  private routeRing(_available: SwarmAgent[]): string | null {
    const allAgents = this.state.agents;
    if (allAgents.length === 0) return null;
    for (let attempt = 0; attempt < allAgents.length; attempt++) {
      const idx = (this.roundRobinIndex + attempt) % allAgents.length;
      const agent = allAgents[idx];
      if (agent.status !== 'failed') {
        this.roundRobinIndex = (idx + 1) % allAgents.length;
        return agent.id;
      }
    }
    return null;
  }

  private routeStar(available: SwarmAgent[]): string | null {
    if (this.state.leader) {
      const leader = available.find((a) => a.id === this.state.leader);
      if (leader) return leader.id;
    }
    return available[0]?.id ?? null;
  }
}
