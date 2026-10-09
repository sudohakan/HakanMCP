/**
 * On-Demand MCP Server Catalog
 * Provides catalog-based connections to external MCP servers
 * that require no API keys or authentication.
 */
// Imported, not read from disk: a disk read made the catalog a two-step edit
// (src/catalog/servers.json, then dist/) where forgetting the second step looked
// like "the server is not in the catalog". It also keeps the server bundleable.
import catalogData from './servers.json' with { type: 'json' };

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

export function loadCatalog(): ServerCatalog {
  return catalogData as ServerCatalog;
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
