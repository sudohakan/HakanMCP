import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { PROJECT_ROOT } from '../utils/projectRoot.js';
import { monitoringTools } from '../tools/monitoring.js';
import { syncPeerRepo } from '../utils/peerSync.js';
import { getConnection } from '../utils/connections.js';
import { HttpClient } from '../utils/httpClient.js';

const HISTORY_PATH = process.env.FLOW_HISTORY_PATH || path.join(PROJECT_ROOT, 'logs', 'flows', 'history.jsonl');
const FLOW_HTTP_TIMEOUT = Number(process.env.FLOW_HTTP_TIMEOUT_MS || 15000);
const httpClient = new HttpClient(FLOW_HTTP_TIMEOUT);

const StepAction = z.enum(['monitor_healthCheck', 'syncPeerRepo', 'log', 'http_request']);

const FlowStep = z.object({
  id: z.string(),
  action: StepAction,
  args: z.record(z.string(), z.unknown()).default({}),
  retry: z
    .object({
      maxAttempts: z.number().int().positive().default(1),
      backoffMs: z.number().int().nonnegative().default(1000),
    })
    .optional(),
  onFail: z.enum(['continue', 'stop']).optional().default('stop'),
});

const FlowSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  trigger: z
    .object({
      type: z.string(),
      expression: z.string().optional(),
      window: z.string().optional(),
    })
    .optional(),
  steps: z.array(FlowStep).min(1),
});

type Flow = z.infer<typeof FlowSchema>;
type FlowRunLog = {
  name: string;
  path?: string;
  timestamp: string;
  success: boolean;
  logs: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(step: Flow['steps'][number]): Promise<string> {
  const action = step.action;
  const args = step.args || {};

  const connectionId = (args as Record<string, unknown>)?.connectionId as string | undefined;
  const connection = connectionId ? getConnection(connectionId) : undefined;
  if (connectionId && !connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }
  const resolvedArgs = { ...args, connection };

  if (action === 'log') {
    const r = resolvedArgs as Record<string, unknown>;
    const level = (r?.level as string) || 'info';
    const message = (r?.message as string) || step.id;
    const child = logger.child({ flowStep: step.id });
    const logFn =
      (
        (child as unknown as Record<string, unknown>)[level] as
          | ((...a: unknown[]) => void)
          | undefined
      )?.bind(child) || child.info.bind(child);
    logFn(message);
    return `log: ${message}`;
  }

  if (action === 'monitor_healthCheck') {
    const tool = monitoringTools.find((t) => t.name === 'monitor_healthCheck');
    if (!tool) throw new Error('monitor_healthCheck tool missing');
    const result = await tool.handler(resolvedArgs);
    return result.content?.[0]?.text || 'health check done';
  }

  if (action === 'syncPeerRepo') {
    const { peerPath } = resolvedArgs as Record<string, unknown>;
    const res = await syncPeerRepo(peerPath as string | undefined);
    return `${res.status}: ${res.detail}`;
  }

  if (action === 'http_request') {
    const merged = resolvedArgs as Record<string, unknown>;
    const conn = merged.connection as
      | {
          config?: {
            url?: string;
            headers?: Record<string, string>;
            token?: string;
            apiKey?: string;
            headerName?: string;
          };
        }
      | undefined;
    const method = merged.method || 'GET';
    const body =
      merged.body && typeof merged.body === 'object' ? JSON.stringify(merged.body) : merged.body;
    let url = merged.url;
    const headers: Record<string, string> = { ...(merged.headers || {}) };
    if (!url && conn?.config?.url) url = conn.config.url;
    if (conn?.config?.headers && typeof conn.config.headers === 'object') {
      Object.assign(headers, conn.config.headers as Record<string, string>);
    }
    if (conn?.config?.token) {
      headers.Authorization = `Bearer ${conn.config.token}`;
    }
    if (conn?.config?.apiKey) {
      const headerName = conn.config.headerName || 'X-API-Key';
      headers[headerName] = conn.config.apiKey;
    }
    if (!url) throw new Error('http_request requires url or connection.url');
    const result = await httpClient.request(url as string, {
      method: (method as string) || 'GET',
      body: body as string | undefined,
      headers,
      timeout: merged.timeout as number | undefined,
      retries: merged.retries as number | undefined,
    });
    return `http ${result.status} ${result.statusText}`;
  }

  throw new Error(`Unsupported action: ${action}`);
}

async function executeWithRetry(step: Flow['steps'][number]): Promise<string> {
  const maxAttempts = step.retry?.maxAttempts ?? 1;
  const backoffMs = step.retry?.backoffMs ?? 1000;
  let attempt = 0;
  let lastErr: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await runStep(step);
      logger.debug('Flow step completed', { step: step.id, action: step.action, attempt });
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        logger.warn('Flow step retry failed', {
          step: step.id,
          action: step.action,
          attempt,
          maxAttempts,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(backoffMs);
      }
    }
  }
  logger.error('Flow step failed', {
    step: step.id,
    action: step.action,
    maxAttempts,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  throw lastErr;
}

export function loadFlow(filePath: string): Flow {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = JSON.parse(raw);
  return FlowSchema.parse(parsed);
}

export async function runFlow(flow: Flow): Promise<{ success: boolean; logs: string[] }> {
  const logs: string[] = [];
  for (const step of flow.steps) {
    try {
      const res = await executeWithRetry(step);
      logs.push(`[${step.id}] ok: ${res}`);
    } catch (err: unknown) {
      logs.push(`[${step.id}] fail: ${err instanceof Error ? err.message : String(err)}`);
      if ((step.onFail || 'stop') === 'stop') {
        return { success: false, logs };
      }
    }
  }
  return { success: true, logs };
}

export async function runFlowFile(filePath: string): Promise<{ success: boolean; logs: string[] }> {
  const flow = loadFlow(filePath);
  return runFlow(flow);
}

export const flowSchema = FlowSchema;

async function loadHistoryLines(): Promise<FlowRunLog[]> {
  try {
    const raw = await fs.promises.readFile(HISTORY_PATH, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as FlowRunLog);
  } catch {
    return [];
  }
}

let historyWritePromise: Promise<void> = Promise.resolve();

export async function recordFlowHistory(
  entry: FlowRunLog,
  _maxEntries: number = 100,
): Promise<void> {
  const op = async () => {
    const dir = path.dirname(HISTORY_PATH);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(HISTORY_PATH, JSON.stringify(entry) + '\n', 'utf8');
  };

  const result = historyWritePromise.then(op);
  historyWritePromise = result.catch(() => {});
  return result;
}

export async function getFlowHistory(limit = 10): Promise<FlowRunLog[]> {
  const entries = await loadHistoryLines();
  return entries.slice(-limit).reverse();
}
