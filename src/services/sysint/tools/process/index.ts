/**
 * Process category entry point — dispatches to sub-modules.
 * PRC-01: process-list     PRC-02: process-connections
 * PRC-03: process-modules  PRC-04: process-threads
 * PRC-05: process-handles  PRC-06: process-io
 * PRC-07: process-tree     PRC-08: service-list
 */
import { runProcessList, runProcessTree } from './list.js';
import { runProcessConnections } from './connections.js';
import { runProcessModules } from './modules.js';
import { runProcessThreads } from './threads.js';
import { runProcessHandles } from './handles.js';
import { runProcessIO } from './io.js';
import { runServiceList } from './services.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'process-list': runProcessList,
  'process-connections': runProcessConnections,
  'process-modules': runProcessModules,
  'process-threads': runProcessThreads,
  'process-handles': runProcessHandles,
  'process-io': runProcessIO,
  'process-tree': runProcessTree,
  'service-list': runServiceList,
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) return buildError(`No native handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
