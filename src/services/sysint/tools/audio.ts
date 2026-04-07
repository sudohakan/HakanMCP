/**
 * Audio category entry point shim — re-exports from ./audio/index.js
 * Required for dispatcher's category module resolution pattern:
 * import('./tools/${category}.js') → tools/audio.ts → tools/audio/index.ts
 */
export { run } from './audio/index.js';
