/**
 * Registry category entry point shim — re-exports from ./registry/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/registry.ts → tools/registry/index.ts
 */
export { run } from './registry/index.js';
