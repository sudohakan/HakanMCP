/**
 * System category entry point shim — re-exports from ./system/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/system.ts → tools/system/index.ts
 */
export { run } from './system/index.js';
