import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from './logger.js';
import { PROJECT_ROOT } from './projectRoot.js';

function getConnectionsPath(): string {
  return process.env.FLOW_CONNECTIONS_PATH || path.join(PROJECT_ROOT, 'logs', 'flows', 'connections.json');
}

const ConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  tags: z.array(z.string()).optional(),
  config: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Connection = z.infer<typeof ConnectionSchema>;

function ensureDir(): void {
  const dir = path.dirname(getConnectionsPath());
  fs.mkdirSync(dir, { recursive: true });
}

function loadConnections(): Connection[] {
  const filePath = getConnectionsPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const array = Array.isArray(parsed) ? parsed : [];
    return array.map((item) => ConnectionSchema.parse(item));
  } catch (err) {
    logger.warn('connections load failed, resetting file', { error: (err as Error).message });
    return [];
  }
}

function saveConnections(connections: Connection[]): void {
  ensureDir();
  fs.writeFileSync(getConnectionsPath(), JSON.stringify(connections, null, 2), 'utf8');
}

export function upsertConnection(input: Omit<Connection, 'createdAt' | 'updatedAt'>): Connection {
  const connections = loadConnections();
  const existing = connections.find((c) => c.id === input.id);
  const now = new Date().toISOString();
  const merged: Connection = {
    ...input,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existing) {
    Object.assign(existing, merged);
  } else {
    connections.push(merged);
  }

  saveConnections(connections);
  return merged;
}

export function listConnections(): Connection[] {
  return loadConnections();
}

export function deleteConnection(id: string): boolean {
  const connections = loadConnections();
  const filtered = connections.filter((c) => c.id !== id);
  saveConnections(filtered);
  return filtered.length !== connections.length;
}

export function getConnection(id: string): Connection | undefined {
  const connections = loadConnections();
  return connections.find((c) => c.id === id);
}

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 0 ? '***' : value;
  if (Array.isArray(value)) return value.map(maskValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskValue(v);
    }
    return out;
  }
  return value;
}

export function maskConnection(conn: Connection): Connection {
  return {
    ...conn,
    config: maskValue(conn.config) as Record<string, unknown>,
  };
}
