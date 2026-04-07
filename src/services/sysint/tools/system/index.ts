/**
 * System category entry point — dispatches to sub-modules.
 * SYS-01..25 implemented across info.ts, apps.ts, hardware.ts, events.ts, forensics.ts
 */
import { run as infoRun } from './info.js';
import { run as appsRun } from './apps.js';
import { run as hardwareRun } from './hardware.js';
import { run as eventsRun } from './events.js';
import { run as forensicsRun } from './forensics.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  // info.ts — SYS-01, 02, 03, 22
  'cpu-info': (id, args) => infoRun(id, args),
  'memory-info': (id, args) => infoRun(id, args),
  'os-info': (id, args) => infoRun(id, args),
  'timezone-info': (id, args) => infoRun(id, args),
  // apps.ts — SYS-04, 05, 20
  'installed-apps': (id, args) => appsRun(id, args),
  'update-history': (id, args) => appsRun(id, args),
  'installed-packages': (id, args) => appsRun(id, args),
  // hardware.ts — SYS-06, 07, 08, 11, 12, 13, 23
  'driver-list': (id, args) => hardwareRun(id, args),
  'startup-programs': (id, args) => hardwareRun(id, args),
  'scheduled-tasks': (id, args) => hardwareRun(id, args),
  'usb-history': (id, args) => hardwareRun(id, args),
  'battery-info': (id, args) => hardwareRun(id, args),
  'monitor-info': (id, args) => hardwareRun(id, args),
  'hardware-info': (id, args) => hardwareRun(id, args),
  // events.ts — SYS-09, 10
  'event-log': (id, args) => eventsRun(id, args),
  'crash-analysis': (id, args) => eventsRun(id, args),
  // forensics.ts — SYS-14, 15, 16, 17, 18, 19, 21, 24, 25
  'login-history': (id, args) => forensicsRun(id, args),
  'boot-history': (id, args) => forensicsRun(id, args),
  'prefetch-info': (id, args) => forensicsRun(id, args),
  'shell-extensions': (id, args) => forensicsRun(id, args),
  'running-services': (id, args) => forensicsRun(id, args),
  'security-software': (id, args) => forensicsRun(id, args),
  'environment-vars': (id, args) => forensicsRun(id, args),
  'last-activity': (id, args) => forensicsRun(id, args),
  'jump-lists': (id, args) => forensicsRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for system tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
