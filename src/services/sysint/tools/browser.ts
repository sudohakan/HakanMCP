/**
 * Browser category entry point shim — re-exports from ./browser/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/browser.ts → tools/browser/index.ts
 */
export { run } from './browser/index.js';
