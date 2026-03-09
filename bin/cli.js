#!/usr/bin/env node
/**
 * HakanMCP CLI - Entry point
 * Proxies to the main CLI binary.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', 'dist', 'bin', 'hakanmcp.js');
await import(pathToFileURL(cliPath).href);
