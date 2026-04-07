/**
 * BRW-09: browser-profiles — Browser profile listing for Chrome, Edge, and Firefox.
 */
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import { findAllProfiles } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface ProfileRow {
  browser: string;
  name: string;
  path: string;
  isDefault: boolean;
}

async function runBrowserProfiles(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const profiles = await findAllProfiles();
    const rows: ProfileRow[] = profiles.map((p) => ({
      browser: p.browser,
      name: p.name,
      path: p.path,
      isDefault: p.isDefault,
    }));
    return buildSuccess(rows, 'browser-profiles', platform);
  } catch (err) {
    return buildError(`browser-profiles failed: ${String(err)}`, 'EXEC_FAILED', 'browser-profiles');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'browser-profiles': runBrowserProfiles,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
