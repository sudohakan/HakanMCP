/**
 * Programmer category entry point — dispatches PRG-01..06.
 * PRG-01: dll-exports   — DLL/SO export listing
 * PRG-02: pe-headers    — PE/ELF header reader
 * PRG-03: hash-batch    — File hash batch calculator
 * PRG-04: dotnet-info   — .NET assembly info reader
 * PRG-05: resource-extract — PE resource extractor
 * PRG-06: gac-viewer    — GAC viewer
 */
import { run as exportsRun } from './exports.js';
import { run as headersRun } from './headers.js';
import { run as hashBatchRun } from './hashbatch.js';
import { run as dotnetRun } from './dotnet.js';
import { run as resourcesRun } from './resources.js';
import { run as gacRun } from './gac.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  'dll-exports': (id, args) => exportsRun(id, args),
  'pe-headers': (id, args) => headersRun(id, args),
  'hash-batch': (id, args) => hashBatchRun(id, args),
  'dotnet-info': (id, args) => dotnetRun(id, args),
  'resource-extract': (id, args) => resourcesRun(id, args),
  'gac-viewer': (id, args) => gacRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for programmer tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
