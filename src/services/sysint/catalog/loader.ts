import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../../utils/projectRoot.js';
import type { SysIntCatalog, SysIntTool } from './types.js';

export type { SysIntCatalog, SysIntTool };

const SUPPORTED_CATALOG_VERSION = 1;
const CATALOG_PATH = path.join(PROJECT_ROOT, 'data', 'sysint', 'catalog.json');

let _catalog: SysIntCatalog | null = null;

export function loadSysIntCatalog(catalogPath: string): SysIntCatalog {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to parse catalog at ${catalogPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = raw as Record<string, unknown>;

  if (data.version !== SUPPORTED_CATALOG_VERSION) {
    throw new Error(`Unsupported catalog version: ${data.version}`);
  }

  const tools = data.tools as Record<string, unknown>[];
  for (const tool of tools) {
    if (!tool.id || !tool.name || !tool.category) {
      throw new Error(`Invalid catalog entry: ${tool.id ?? '(no id)'}`);
    }
  }

  return {
    version: data.version as number,
    categories: data.categories as string[],
    tools: tools as unknown as SysIntTool[],
  };
}

export function getCatalog(): SysIntCatalog {
  if (_catalog) return _catalog;
  _catalog = loadSysIntCatalog(CATALOG_PATH);
  return _catalog;
}

export function resetCatalog(): void {
  _catalog = null;
}

export function findTool(id: string): SysIntTool {
  const catalog = getCatalog();
  const tool = catalog.tools.find((t) => t.id === id);
  if (!tool) {
    throw new Error(`Tool not found: ${id}`);
  }
  return tool;
}
