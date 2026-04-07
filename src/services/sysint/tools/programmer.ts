/**
 * Programmer category entry point shim — re-exports from ./programmer/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/programmer.ts → tools/programmer/index.ts
 */
export { run } from './programmer/index.js';
