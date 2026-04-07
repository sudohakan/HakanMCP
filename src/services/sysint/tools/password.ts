/**
 * Password category entry point shim — re-exports from ./password/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/password.ts → tools/password/index.ts
 */
export { run } from './password/index.js';
