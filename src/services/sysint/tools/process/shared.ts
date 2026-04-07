/**
 * Shared re-exports for process sub-modules.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export { buildSuccess, buildError } from '../../outputFormatter.js';
export { getPlatformName } from '../../platforms/index.js';
export type { SysIntResult } from '../../outputFormatter.js';

export const execAsync = promisify(exec);

/** Parse the first positional arg; returns undefined when absent. */
export function parseArg(args: string[], index = 0): string | undefined {
  return args[index] ?? undefined;
}
