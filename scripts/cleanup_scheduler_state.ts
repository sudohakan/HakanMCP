import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATE_PATH = path.join(process.cwd(), 'scheduler-state.json');
const DEFAULT_MAX_EXECUTIONS = Number(process.env.SCHEDULER_MAX_EXECUTIONS || 200);
const DEFAULT_KEEP_SUCCESS_DAYS = Number(process.env.SCHEDULER_KEEP_SUCCESS_DAYS || 7);

interface Execution {
  status?: string;
  timestamp?: string;
}

interface SchedulerState {
  executions?: Execution[];
  lastSaved?: string;
  [key: string]: unknown;
}

interface CleanupOptions {
  statePath?: string;
  maxExecutions?: number;
  keepSuccessDays?: number;
}

interface CleanupResult {
  statePath: string;
  before: number;
  after: number;
  removed: number;
}

export function cleanupSchedulerState(options: CleanupOptions = {}): CleanupResult {
  const statePath = options.statePath || process.env.SCHEDULER_STATE_PATH || DEFAULT_STATE_PATH;
  const maxExecutions = options.maxExecutions ?? DEFAULT_MAX_EXECUTIONS;
  const keepSuccessDays = options.keepSuccessDays ?? DEFAULT_KEEP_SUCCESS_DAYS;

  if (!fs.existsSync(statePath)) {
    return { statePath, before: 0, after: 0, removed: 0 };
  }

  const raw = fs.readFileSync(statePath, 'utf8');
  const parsed: SchedulerState = JSON.parse(raw);
  const executions = Array.isArray(parsed.executions) ? parsed.executions : [];
  const now = Date.now();
  const successCutoff = now - keepSuccessDays * 24 * 60 * 60 * 1000;

  const failures = executions.filter((e) => e.status && e.status !== 'success');
  const successes = executions.filter((e) => (e.status || '').toLowerCase() === 'success');

  const recentSuccesses = successes
    .filter((e) => {
      const ts = e.timestamp ? Date.parse(e.timestamp) : Number.NaN;
      return Number.isFinite(ts) ? ts >= successCutoff : false;
    })
    .sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));

  const merged = [...failures, ...recentSuccesses].sort(
    (a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''),
  );
  const capped = merged.slice(-maxExecutions);

  const nextState: SchedulerState = {
    ...parsed,
    executions: capped,
    lastSaved: new Date().toISOString(),
  };

  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2), 'utf8');

  return {
    statePath,
    before: executions.length,
    after: capped.length,
    removed: executions.length - capped.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = cleanupSchedulerState();
  console.log(
    `Scheduler state cleaned: ${result.before} -> ${result.after} (removed ${result.removed}) at ${result.statePath}`,
  );
}
