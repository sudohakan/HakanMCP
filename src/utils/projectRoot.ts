/**
 * Determines the HakanMCP project root directory.
 *
 * All internal storage paths (logs, .cache, backups, data) MUST use PROJECT_ROOT
 * instead of process.cwd() to avoid creating directories in the caller's working directory.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function toWslPath(p: string): string {
  const winMatch = p.match(/^([A-Za-z]):[/\\](.*)/);
  if (winMatch) {
    const drive = winMatch[1].toLowerCase();
    const rest = winMatch[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  return p;
}

function findProjectRoot(startDir: string): string {
  let dir = toWslPath(startDir);
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return dir;
}

// Resolve the directory of this module.
// The project is native ESM ("type": "module", NodeNext); tests run via
// --experimental-vm-modules. import.meta.url is therefore always available.
// Fall back to process.cwd() only if URL resolution unexpectedly fails.
const _moduleDir: string = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    // ignore — proceed to fallback
  }
  return toWslPath(process.cwd());
})();

/**
 * Resolved HakanMCP project root.
 * Priority: HAKANMCP_PROJECT_ROOT env → nearest package.json ancestor.
 */
export const PROJECT_ROOT: string =
  toWslPath(process.env.HAKANMCP_PROJECT_ROOT || '') || findProjectRoot(_moduleDir);
