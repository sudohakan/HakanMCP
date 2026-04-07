/**
 * Registry category entry point — dispatches to sub-modules.
 * REG-01..08 implemented across search.ts, snapshot.ts, hive.ts, startup.ts,
 * uninstall.ts, usb.ts, associations.ts, mru.ts
 */
import { run as searchRun } from './search.js';
import { run as snapshotRun } from './snapshot.js';
import { run as hiveRun } from './hive.js';
import { run as startupRun } from './startup.js';
import { run as uninstallRun } from './uninstall.js';
import { run as usbRun } from './usb.js';
import { run as associationsRun } from './associations.js';
import { run as mruRun } from './mru.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  // REG-01: registry search
  'registry-search': (id, args) => searchRun(id, args),
  // REG-02: snapshot diff
  'registry-snapshot-diff': (id, args) => snapshotRun(id, args),
  // REG-03: offline hive reader
  'registry-hive': (id, args) => hiveRun(id, args),
  // REG-04: startup entries
  'registry-startup': (id, args) => startupRun(id, args),
  // REG-05: uninstall entries
  'registry-uninstall': (id, args) => uninstallRun(id, args),
  // REG-06: USB history
  'registry-usb': (id, args) => usbRun(id, args),
  // REG-07: shell associations
  'registry-associations': (id, args) => associationsRun(id, args),
  // REG-08: MRU lists
  'registry-mru': (id, args) => mruRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for registry tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
