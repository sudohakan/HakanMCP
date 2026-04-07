/**
 * Disk category entry point shim — re-exports from ./disk/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/disk.ts → tools/disk/index.ts
 */
export { run } from './disk/index.js';
