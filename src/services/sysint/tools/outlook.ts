/**
 * Outlook category entry point shim — re-exports from ./outlook/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/outlook.ts → tools/outlook/index.ts
 */
export { run } from './outlook/index.js';
