/**
 * Shared re-exports for network sub-modules.
 * Centralizes outputFormatter and platform imports.
 */
export { buildSuccess, buildError, isError } from '../../outputFormatter.js';
export { getPlatformName } from '../../platforms/index.js';
export type { SysIntResult } from '../../outputFormatter.js';
