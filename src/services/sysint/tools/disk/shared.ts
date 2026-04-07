/**
 * Shared re-exports for disk sub-modules.
 * Centralizes imports from outputFormatter and platforms to avoid repetition.
 */
export { buildSuccess, buildError } from '../../outputFormatter.js';
export { getPlatformName } from '../../platforms/index.js';
export type { SysIntResult, SysIntPlatform } from '../../outputFormatter.js';
