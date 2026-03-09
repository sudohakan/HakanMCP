/**
 * Determines the HakanMCP project root directory.
 *
 * All internal storage paths (logs, .cache, backups, data) MUST use PROJECT_ROOT
 * instead of process.cwd() to avoid creating directories in the caller's working directory.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolved HakanMCP project root.
 * Priority: HAKANMCP_PROJECT_ROOT env → nearest package.json ancestor.
 */
export const PROJECT_ROOT: string =
  process.env.HAKANMCP_PROJECT_ROOT || findProjectRoot(__dirname);
