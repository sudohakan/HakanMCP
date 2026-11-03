/**
 * On-Demand MCP Server Catalog
 * Provides catalog-based connections to external MCP servers
 * that require no API keys or authentication.
 */
// Imported, not read from disk: a disk read made the catalog a two-step edit
// (src/catalog/servers.json, then dist/) where forgetting the second step looked
// like "the server is not in the catalog". It also keeps the server bundleable.
import os from 'node:os';
import catalogData from './servers.json' with { type: 'json' };

// Machine-specific paths stay out of servers.json: a value may start with `~/` (home
// directory) or contain `${NAME}` (environment variable, e.g. from the project .env).
const ENV_REFERENCE = /\$\{([A-Z0-9_]+)\}/g;

export function expandCatalogValue(value: string, serverKey: string): string {
  const withHome = value === '~' || value.startsWith('~/') ? os.homedir() + value.slice(1) : value;
  return withHome.replace(ENV_REFERENCE, (_match, name: string) => {
    const resolved = process.env[name];
    if (!resolved) {
      throw new Error(`Catalog server "${serverKey}" needs environment variable ${name} (set it in the HakanMCP .env)`);
    }
    return resolved;
  });
}

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
  const server = catalog.servers[serverKey];
  if (!server) return null;
  return {
    ...server,
    command: expandCatalogValue(server.command, serverKey),
    args: server.args.map((arg) => expandCatalogValue(arg, serverKey)),
  };
}

export function listCatalogServers(): Array<{ key: string } & CatalogServer> {
  const catalog = loadCatalog();
  return Object.entries(catalog.servers).map(([key, server]) => ({
    key,
    ...server,
  }));
}
