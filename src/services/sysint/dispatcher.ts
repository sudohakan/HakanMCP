/**
 * SysInt unified dispatcher.
 * Orchestrates the guard sequence (NOT_FOUND → PLATFORM_UNSUPPORTED → PRIVILEGE_REQUIRED)
 * and native tool execution.
 */
import { getCatalog, findTool as _findTool } from './catalog/loader.js';
import { getPlatformName } from './platforms/index.js';
import { requirePrivilege, requirePlatform } from './privilegeHelper.js';
import { buildError } from './outputFormatter.js';
import type { SysIntResult } from './outputFormatter.js';

export type { SysIntResult };

/** Category module interface — Phase 1+ modules implement this. */
interface CategoryModule {
  run: (toolId: string, args?: string[]) => Promise<unknown>;
}

/**
 * Static category loaders. A template literal import would be shorter, but it is
 * unresolvable at build time and keeps the server out of a single-file bundle —
 * which is what the cold start is paid in. Adding a category means adding a line.
 */
const CATEGORY_LOADERS: Record<string, () => Promise<CategoryModule>> = {
  audio: () => import('./tools/audio.js'),
  browser: () => import('./tools/browser.js'),
  disk: () => import('./tools/disk.js'),
  network: () => import('./tools/network.js'),
  outlook: () => import('./tools/outlook.js'),
  process: () => import('./tools/process.js'),
  programmer: () => import('./tools/programmer.js'),
  registry: () => import('./tools/registry.js'),
  system: () => import('./tools/system.js'),
};

/** Successfully-loaded category modules (only cached on success — failures are retried). */
const _categoryModules = new Map<string, Promise<CategoryModule>>();

async function getCategoryModule(category: string): Promise<CategoryModule | null> {
  if (_categoryModules.has(category)) {
    return _categoryModules.get(category)!;
  }
  const loader = CATEGORY_LOADERS[category];
  if (!loader) return null;
  try {
    const mod = await loader();
    _categoryModules.set(category, Promise.resolve(mod));
    return mod;
  } catch {
    return null;
  }
}

/**
 * Run a sysint tool by ID.
 * Guard sequence: NOT_FOUND → PLATFORM_UNSUPPORTED → PRIVILEGE_REQUIRED → execute
 */
export async function runTool(
  toolId: string,
  args?: string[],
  _options?: Record<string, unknown>,
): Promise<SysIntResult> {
  // Guard 1: Tool must exist in catalog
  let tool;
  try {
    tool = _findTool(toolId);
  } catch {
    return buildError(`Tool not found: ${toolId}`, 'NOT_FOUND', toolId);
  }

  // Guard 2: Platform must be supported
  const currentPlatform = getPlatformName();
  const platformError = requirePlatform(tool, toolId, currentPlatform);
  if (platformError) return platformError;

  // Guard 3: Privilege check
  const privilegeError = await requirePrivilege(tool, toolId);
  if (privilegeError) return privilegeError;

  // Execute native module
  try {
    const categoryMod = await getCategoryModule(tool.category);
    if (categoryMod) {
      const result = await categoryMod.run(toolId, args);
      return result as SysIntResult;
    }
    return buildError(`No native module found for tool '${toolId}' (category: ${tool.category})`, 'EXEC_FAILED', toolId);
  } catch (err) {
    return buildError(`Tool '${toolId}' execution failed: ${String(err)}`, 'EXEC_FAILED', toolId);
  }
}

/** Reset category module cache for test isolation. */
export function resetDispatcher(): void {
  _categoryModules.clear();
}
