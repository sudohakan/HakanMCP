import {
  HnswBridge,
  SonaEngine,
  cosineSimilarity,
  type HnswConfig,
  type Trajectory,
} from '../services/ruvectorBridge.js';

// ── cosineSimilarity ─────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns 0 when a vector has zero magnitude', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('computes correctly for non-trivial vectors', () => {
    // [3,4] · [4,3] = 24, |[3,4]|=5, |[4,3]|=5 → 24/25 = 0.96
    expect(cosineSimilarity([3, 4], [4, 3])).toBeCloseTo(0.96, 2);
  });
});

// ── HnswBridge ───────────────────────────────────────────────────

describe('HnswBridge', () => {
  const config: HnswConfig = { dimensions: 3 };

  it('starts empty', () => {
    const bridge = new HnswBridge(config);
    expect(bridge.size()).toBe(0);
  });

  it('add increases size', () => {
    const bridge = new HnswBridge(config);
    bridge.add('a', [1, 0, 0]);
    bridge.add('b', [0, 1, 0]);
    expect(bridge.size()).toBe(2);
  });

  it('add stores metadata', () => {
    const bridge = new HnswBridge(config);
    bridge.add('a', [1, 0, 0], { label: 'first' });
    const results = bridge.search([1, 0, 0], 1);
    expect(results[0].metadata).toEqual({ label: 'first' });
  });

  it('throws on dimension mismatch in add', () => {
    const bridge = new HnswBridge(config);
    expect(() => bridge.add('x', [1, 2])).toThrow('Dimension mismatch');
  });

  it('throws on dimension mismatch in search', () => {
    const bridge = new HnswBridge(config);
    expect(() => bridge.search([1, 2], 1)).toThrow('Dimension mismatch');
  });

  it('search returns top-k sorted by score descending', () => {
    const bridge = new HnswBridge(config);
    bridge.add('exact', [1, 0, 0]);
    bridge.add('close', [0.9, 0.1, 0]);
    bridge.add('far', [0, 0, 1]);

    const results = bridge.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('exact');
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[1].id).toBe('close');
    expect(results[1].score).toBeGreaterThan(0.9);
  });

  it('search returns fewer than k when store is smaller', () => {
    const bridge = new HnswBridge(config);
    bridge.add('only', [1, 1, 1]);
    const results = bridge.search([1, 1, 1], 10);
    expect(results).toHaveLength(1);
  });

  it('remove returns true for existing id', () => {
    const bridge = new HnswBridge(config);
    bridge.add('a', [1, 0, 0]);
    expect(bridge.remove('a')).toBe(true);
    expect(bridge.size()).toBe(0);
  });

  it('remove returns false for non-existing id', () => {
    const bridge = new HnswBridge(config);
    expect(bridge.remove('nonexistent')).toBe(false);
  });

  it('removed vectors are excluded from search', () => {
    const bridge = new HnswBridge(config);
    bridge.add('a', [1, 0, 0]);
    bridge.add('b', [0, 1, 0]);
    bridge.remove('a');
    const results = bridge.search([1, 0, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('b');
  });
});

// ── SonaEngine ───────────────────────────────────────────────────

describe('SonaEngine', () => {
  const dims = 4;

  function makeTraj(overrides?: Partial<Trajectory>): Trajectory {
    return {
      states: [[1, 0, 0, 0], [0, 1, 0, 0]],
      actions: ['up', 'down'],
      rewards: [1.0, 0.5],
      quality: 0.8,
      ...overrides,
    };
  }

  it('learn returns correct patternsLearned count', () => {
    const engine = new SonaEngine({ dimensions: dims });
    const result = engine.learn([makeTraj()]);
    // 2 states → 2 patterns
    expect(result.patternsLearned).toBe(2);
    expect(result.ewcUpdated).toBe(true);
  });

  it('learn with empty trajectories returns 0 patterns', () => {
    const engine = new SonaEngine({ dimensions: dims });
    const result = engine.learn([]);
    expect(result.patternsLearned).toBe(0);
    expect(result.ewcUpdated).toBe(false);
  });

  it('findPatterns returns top-k nearest patterns', () => {
    const engine = new SonaEngine({ dimensions: dims });
    engine.learn([makeTraj()]);

    const results = engine.findPatterns([1, 0, 0, 0], 1);
    expect(results).toHaveLength(1);
    // The closest pattern to [1,0,0,0] should be the one from state [1,0,0,0]
    expect(results[0].embedding).toEqual([1, 0, 0, 0]);
  });

  it('findPatterns respects k limit', () => {
    const engine = new SonaEngine({ dimensions: dims });
    engine.learn([makeTraj()]);
    const results = engine.findPatterns([1, 0, 0, 0], 100);
    expect(results).toHaveLength(2); // only 2 patterns stored
  });

  it('getEWCState tracks Fisher diagonal correctly', () => {
    const engine = new SonaEngine({ dimensions: dims });
    // state=[1,0,0,0] reward=1.0 → fisher[0] += (1*1)^2 = 1
    // state=[0,1,0,0] reward=0.5 → fisher[1] += (1*0.5)^2 = 0.25
    engine.learn([makeTraj()]);

    const ewc = engine.getEWCState();
    expect(ewc.fisherMatrix[0]).toBeCloseTo(1, 5);
    expect(ewc.fisherMatrix[1]).toBeCloseTo(0.25, 5);
    expect(ewc.fisherMatrix[2]).toBe(0);
    expect(ewc.fisherMatrix[3]).toBe(0);
  });

  it('getEWCState increments taskCount per learn call', () => {
    const engine = new SonaEngine({ dimensions: dims });
    engine.learn([makeTraj()]);
    engine.learn([makeTraj()]);
    expect(engine.getEWCState().taskCount).toBe(2);
  });

  it('getEWCState accumulates Fisher across multiple learns', () => {
    const engine = new SonaEngine({ dimensions: dims });
    engine.learn([makeTraj()]);
    engine.learn([makeTraj()]);
    const ewc = engine.getEWCState();
    // fisher[0] should be 1 + 1 = 2
    expect(ewc.fisherMatrix[0]).toBeCloseTo(2, 5);
  });

  it('getEWCState parameterMeans are averaged over all patterns', () => {
    const engine = new SonaEngine({ dimensions: dims });
    // Two states: [1,0,0,0] and [0,1,0,0] → mean = [0.5, 0.5, 0, 0]
    engine.learn([makeTraj()]);
    const ewc = engine.getEWCState();
    expect(ewc.parameterMeans[0]).toBeCloseTo(0.5, 5);
    expect(ewc.parameterMeans[1]).toBeCloseTo(0.5, 5);
  });

  it('learn handles states with fewer dimensions than configured', () => {
    const engine = new SonaEngine({ dimensions: dims });
    const traj = makeTraj({ states: [[1, 2]] }); // only 2 dims, should pad to 4
    const result = engine.learn([traj]);
    expect(result.patternsLearned).toBe(1);
    const patterns = engine.findPatterns([1, 2, 0, 0], 1);
    expect(patterns[0].embedding).toEqual([1, 2, 0, 0]);
  });
});
