/**
 * Process-wide tool-call counters.
 *
 * A module-level singleton rather than registry state: the health tool is an
 * ordinary tool module and cannot reach the ToolRegistry instance created in
 * index.ts, but it can import this. wrapHandler records every call here, so the
 * health surface can report a recent error rate without threading the registry
 * through the tool layer.
 *
 * In-memory only — resets when the server restarts. That is the right scope: a
 * health check answers "is this process healthy right now", not historical SLO.
 */

interface ToolCounter {
  calls: number;
  errors: number;
  lastErrorAt?: number;
  lastErrorMessage?: string;
}

const counters = new Map<string, ToolCounter>();
let totalCalls = 0;
let totalErrors = 0;

function counterFor(tool: string): ToolCounter {
  let c = counters.get(tool);
  if (!c) {
    c = { calls: 0, errors: 0 };
    counters.set(tool, c);
  }
  return c;
}

export function recordCall(tool: string): void {
  counterFor(tool).calls += 1;
  totalCalls += 1;
}

export function recordError(tool: string, message: string): void {
  const c = counterFor(tool);
  c.errors += 1;
  c.lastErrorAt = Date.now();
  c.lastErrorMessage = message.slice(0, 200);
  totalErrors += 1;
}

export interface ToolMetricsSnapshot {
  totalCalls: number;
  totalErrors: number;
  errorRate: number;
  perTool: Array<{
    tool: string;
    calls: number;
    errors: number;
    lastErrorMessage?: string;
  }>;
}

export function getMetricsSnapshot(): ToolMetricsSnapshot {
  const perTool = [...counters.entries()]
    .map(([tool, c]) => ({
      tool,
      calls: c.calls,
      errors: c.errors,
      lastErrorMessage: c.lastErrorMessage,
    }))
    .filter((t) => t.errors > 0 || t.calls > 0)
    .sort((a, b) => b.errors - a.errors || b.calls - a.calls);

  return {
    totalCalls,
    totalErrors,
    errorRate: totalCalls === 0 ? 0 : Number((totalErrors / totalCalls).toFixed(3)),
    perTool,
  };
}
