/**
 * Determines the HakanMCP project root directory.
 *
 * All internal storage paths (logs, .cache, backups, data) MUST use PROJECT_ROOT
 * instead of process.cwd() to avoid creating directories in the caller's working directory.
 */

import path from 'node:path';
import fs from 'node:fs';

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
// __filename is available in CJS and injected by ts-jest (useESM).
// In native ESM builds, __filename is declared at the top of the compiled output.
// Fall back to process.cwd() so the project root search still works.
const _moduleDir: string = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — __filename available in CJS/ts-jest; may be undefined in some ESM contexts
    if (typeof __filename === 'string') return path.dirname(__filename as string);
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
