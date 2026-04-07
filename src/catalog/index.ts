/**
 * On-Demand MCP Server Catalog
 * Provides catalog-based connections to external MCP servers
 * that require no API keys or authentication.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface CatalogServer {
  name: string;
  description: string;
  command: string;
  args: string[];
  dynamicArgs?: string[];
  envKeys?: string[];
  conditions: string[];
}

export interface ServerCatalog {
  version: string;
  description: string;
  servers: Record<string, CatalogServer>;
}

let cachedCatalog: ServerCatalog | null = null;

export function loadCatalog(): ServerCatalog {
  if (cachedCatalog) return cachedCatalog;

  const catalogPath = join(__dirname, 'servers.json');
  const raw = readFileSync(catalogPath, 'utf-8');
  cachedCatalog = JSON.parse(raw) as ServerCatalog;
  return cachedCatalog;
}

export function getCatalogServer(serverKey: string): CatalogServer | null {
  const catalog = loadCatalog();
  return catalog.servers[serverKey] ?? null;
}

export function listCatalogServers(): Array<{ key: string } & CatalogServer> {
  const catalog = loadCatalog();
  return Object.entries(catalog.servers).map(([key, server]) => ({
    key,
    ...server,
  }));
}
