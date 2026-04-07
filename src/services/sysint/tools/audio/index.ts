/**
 * Audio category entry point — dispatches AUD-01..03.
 * AUD-01: audio-devices — audio device listing
 * AUD-02: audio-volume  — volume getter/setter
 * AUD-03: audio-codecs  — codec listing
 */
import { run as devicesRun } from './devices.js';
import { run as volumeRun } from './volume.js';
import { run as codecsRun } from './codecs.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  'audio-devices': (id, args) => devicesRun(id, args),
  'audio-volume': (id, args) => volumeRun(id, args),
  'audio-codecs': (id, args) => codecsRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for audio tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
