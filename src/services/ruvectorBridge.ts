/**
 * RuVector Bridge — HNSW mock + SONA/EWC++ mock
 * In-memory vector store with cosine similarity search and
 * continual-learning engine with Elastic Weight Consolidation.
 */

export interface HnswConfig {
  dimensions: number;
  maxElements?: number;
  efConstruction?: number;
  M?: number;
  efSearch?: number;
}

export interface SearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface Trajectory {
  states: number[][];
  actions: string[];
  rewards: number[];
  quality: number;
}

export interface Pattern {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  quality: number;
}

export interface EWCState {
  fisherMatrix: number[];
  parameterMeans: number[];
  taskCount: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

interface StoredVector {
  vector: number[];
  metadata?: Record<string, unknown>;
}

export class HnswBridge {
  private readonly dimensions: number;
  private readonly store = new Map<string, StoredVector>();

  constructor(config: HnswConfig) {
    this.dimensions = config.dimensions;
  }

  add(id: string, vector: number[], metadata?: Record<string, unknown>): void {
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimensions}, got ${vector.length}`,
      );
    }
    this.store.set(id, { vector, metadata });
  }

  search(query: number[], k: number): SearchResult[] {
    if (query.length !== this.dimensions) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimensions}, got ${query.length}`,
      );
    }
    const results: SearchResult[] = [];
    for (const [id, entry] of this.store) {
      results.push({
        id,
        score: cosineSimilarity(query, entry.vector),
        metadata: entry.metadata,
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  remove(id: string): boolean {
    return this.store.delete(id);
  }

  size(): number {
    return this.store.size;
  }
}

export class SonaEngine {
  private readonly dimensions: number;
  private patterns: Pattern[] = [];
  private fisher: number[];
  private parameterMeans: number[];
  private taskCount = 0;
  private nextId = 1;

  constructor(config: { dimensions: number }) {
    this.dimensions = config.dimensions;
    this.fisher = new Array<number>(this.dimensions).fill(0);
    this.parameterMeans = new Array<number>(this.dimensions).fill(0);
  }

  learn(trajectories: Trajectory[]): { patternsLearned: number; ewcUpdated: boolean } {
    let patternsLearned = 0;

    for (const traj of trajectories) {
      for (let si = 0; si < traj.states.length; si++) {
        const state = traj.states[si];
        const reward = si < traj.rewards.length ? traj.rewards[si] : 0;

        const embedding = new Array<number>(this.dimensions).fill(0);
        for (let i = 0; i < Math.min(state.length, this.dimensions); i++) {
          embedding[i] = state[i];
        }

        const pattern: Pattern = {
          id: `pat-${this.nextId++}`,
          embedding,
          metadata: {
            action: si < traj.actions.length ? traj.actions[si] : undefined,
            reward,
            trajectoryQuality: traj.quality,
          },
          quality: traj.quality,
        };
        this.patterns.push(pattern);
        patternsLearned++;

        for (let i = 0; i < this.dimensions; i++) {
          const val = i < state.length ? state[i] : 0;
          this.fisher[i] += (val * reward) ** 2;
        }
      }
    }

    const means = new Array<number>(this.dimensions).fill(0);
    for (const p of this.patterns) {
      for (let i = 0; i < this.dimensions; i++) {
        means[i] += p.embedding[i];
      }
    }
    if (this.patterns.length > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        means[i] /= this.patterns.length;
      }
    }
    this.parameterMeans = means;
    this.taskCount++;

    return { patternsLearned, ewcUpdated: patternsLearned > 0 };
  }

  findPatterns(query: number[], k: number): Pattern[] {
    const padded = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < Math.min(query.length, this.dimensions); i++) {
      padded[i] = query[i];
    }

    const scored = this.patterns.map((p) => ({
      pattern: p,
      score: cosineSimilarity(padded, p.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => s.pattern);
  }

  getEWCState(): EWCState {
    return {
      fisherMatrix: [...this.fisher],
      parameterMeans: [...this.parameterMeans],
      taskCount: this.taskCount,
    };
  }
}
