/**
 * SysInt unified dispatcher.
 * Orchestrates the guard sequence (NOT_FOUND → PLATFORM_UNSUPPORTED → PRIVILEGE_REQUIRED)
 * and native-first execution with NirSoft binary fallback.
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

/** Successfully-loaded category modules (only cached on success — failures are retried). */
const _categoryModules = new Map<string, Promise<CategoryModule>>();

async function getCategoryModule(category: string): Promise<CategoryModule | null> {
  if (_categoryModules.has(category)) {
    return _categoryModules.get(category)!;
  }
  try {
    const mod = await import(`./tools/${category}.js`) as CategoryModule;
    const resolved = Promise.resolve(mod);
    _categoryModules.set(category, resolved);
    return mod;
  } catch {
    return null;
  }
}

async function nirsoftFallback(toolId: string, _args?: string[]): Promise<SysIntResult> {
  try {
    // Dynamic import of nirsoft handler — avoids circular dependency
    const nirsoft = await import('../nirsoft/index.js').catch(() => null);
    if (!nirsoft) {
      return buildError(`Tool '${toolId}' has no native implementation and nirsoft is unavailable`, 'EXEC_FAILED', toolId);
    }
    // nirsoft module doesn't export a direct runTool — return EXEC_FAILED for now
    // Phase 1+ will connect actual nirsoft execution
    return buildError(`Tool '${toolId}' native implementation not yet available (Phase 1+)`, 'EXEC_FAILED', toolId);
  } catch {
    return buildError(`Tool '${toolId}' execution failed`, 'EXEC_FAILED', toolId);
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

  // Execute: native first, nirsoft fallback
  if (tool.native) {
    try {
      const categoryMod = await getCategoryModule(tool.category);
      if (categoryMod) {
        const result = await categoryMod.run(toolId, args);
        return result as SysIntResult;
      }
    } catch {
      // Native module failed — fall through to nirsoft
    }
  }

  // Nirsoft fallback (all non-native tools, or native failures)
  return nirsoftFallback(toolId, args);
}

/** Reset category module cache for test isolation. */
export function resetDispatcher(): void {
  _categoryModules.clear();
}
