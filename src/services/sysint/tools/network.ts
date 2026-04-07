/**
 * Network category entry point shim — re-exports from ./network/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/network.ts → tools/network/index.ts
 */
export { run } from './network/index.js';
