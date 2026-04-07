/**
 * Disk category entry point — dispatches to sub-modules.
 * DSK-01..14 implemented across smart.ts, space.ts, search.ts, ads.ts, io.ts, links.ts, hash.ts, recovery.ts
 */
import { run as smartRun } from './smart.js';
import { run as spaceRun } from './space.js';
import { run as searchRun } from './search.js';
import { run as adsRun } from './ads.js';
import { run as ioRun } from './io.js';
import { run as linksRun } from './links.js';
import { run as hashRun } from './hash.js';
import { run as recoveryRun } from './recovery.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  // DSK-01
  'disk-smart': (id, args) => smartRun(id, args),
  // DSK-02, DSK-03, DSK-09
  'disk-partitions': (id, args) => spaceRun(id, args),
  'disk-space': (id, args) => spaceRun(id, args),
  'drive-map': (id, args) => spaceRun(id, args),
  // DSK-04..07
  'file-search': (id, args) => searchRun(id, args),
  'duplicate-finder': (id, args) => searchRun(id, args),
  'large-files': (id, args) => searchRun(id, args),
  'recent-files': (id, args) => searchRun(id, args),
  // DSK-08
  'disk-ads': (id, args) => adsRun(id, args),
  // DSK-10, DSK-11
  'disk-io': (id, args) => ioRun(id, args),
  'disk-freespace-log': (id, args) => ioRun(id, args),
  // DSK-12
  'disk-links': (id, args) => linksRun(id, args),
  // DSK-13
  'file-hash': (id, args) => hashRun(id, args),
  // DSK-14
  'disk-recovery': (id, args) => recoveryRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for disk tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
