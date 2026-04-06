import { readFileSync } from 'node:fs';

export interface NirsoftTool {
  id: string;
  exe: string;
  name: string;
  description: string;
  category: string;
  cli: boolean;
  adminRequired: boolean;
  specialDeps: string | null;
  timeout: number;
  outputColumns: string[] | null;
}

export interface NirsoftCatalog {
  version: number;
  categories: string[];
  tools: NirsoftTool[];
}

const SUPPORTED_CATALOG_VERSION = 1;

export function loadCatalog(catalogPath: string): NirsoftCatalog {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse catalog at ${catalogPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (raw.version !== SUPPORTED_CATALOG_VERSION) {
    throw new Error(`Unsupported catalog version: ${raw.version}`);
  }

  for (const tool of raw.tools) {
    if (!tool.id || !tool.exe || !tool.category) {
      throw new Error(`Invalid catalog entry: ${tool.id}`);
    }
    if (tool.exe.includes('/') || tool.exe.includes('\\')) {
      throw new Error(`Invalid exe path: ${tool.exe}`);
    }
    if (typeof tool.timeout !== 'number' || tool.timeout <= 0) {
      throw new Error(`Invalid timeout for ${tool.id}: ${tool.timeout}`);
    }
    if (Array.isArray(tool.outputColumns) && tool.outputColumns.length === 0) {
      throw new Error(`outputColumns cannot be empty array for ${tool.id} — use null for unknown`);
    }
  }

  return raw as NirsoftCatalog;
}
