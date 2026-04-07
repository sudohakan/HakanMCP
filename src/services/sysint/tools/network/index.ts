/**
 * Network category entry point — dispatches to sub-modules.
 * Plans 03 (core) and 04 (extended) both contribute tools here.
 */
import { run as connectionsRun } from './connections.js';
import { run as interfacesRun } from './interfaces.js';
import { run as dnsRun } from './dns.js';
import { run as wifiRun } from './wifi.js';
import { run as scannerRun } from './scanner.js';
import { buildError } from './shared.js';
import type { SysIntResult } from './shared.js';

/** Populated in Plan 03; extended by Plan 04 misc.ts */
const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  // Plan 03 — core
  'cports': (id, args) => connectionsRun(id, args),
  'network-interfaces': (id, args) => interfacesRun(id, args),
  'network-stats': (id, args) => interfacesRun(id, args),
  'dns-lookup': (id, args) => dnsRun(id, args),
  'whois-lookup': (id, args) => dnsRun(id, args),
  'traceroute': (id, args) => dnsRun(id, args),
  'wifi-scan': (id, args) => wifiRun(id, args),
  'wifi-history': (id, args) => wifiRun(id, args),
  'ping-test': (id, args) => scannerRun(id, args),
  'port-scan': (id, args) => scannerRun(id, args),
  // Plan 04 tools will be added in misc.ts (imported lazily to avoid circular deps)
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  // Check in-module map first (Plan 03 tools)
  const handler = MODULE_MAP[toolId];
  if (handler) return handler(toolId, args);

  // Lazy-load misc.ts for Plan 04 extended tools
  try {
    const misc = await import('./misc.js');
    const miscResult = await misc.run(toolId, args);
    return miscResult;
  } catch {
    return buildError(`No native handler for network tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
}
