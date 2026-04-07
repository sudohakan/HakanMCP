/**
 * Browser category entry point — dispatches to sub-modules.
 * BRW-01..10 implemented across profiles.ts, history.ts, bookmarks.ts, cookies.ts,
 * downloads.ts, extensions.ts, autofill.ts, cache.ts, search.ts, forms.ts
 */
import { run as profilesRun } from './profiles.js';
import { run as historyRun } from './history.js';
import { run as bookmarksRun } from './bookmarks.js';
import { run as cookiesRun } from './cookies.js';
import { run as downloadsRun } from './downloads.js';
import { run as extensionsRun } from './extensions.js';
import { run as autofillRun } from './autofill.js';
import { run as cacheRun } from './cache.js';
import { run as searchRun } from './search.js';
import { run as formsRun } from './forms.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  // BRW-09: profile listing
  'browser-profiles': (id, args) => profilesRun(id, args),
  // BRW-01: browsing history
  'browser-history': (id, args) => historyRun(id, args),
  // BRW-02: bookmarks
  'browser-bookmarks': (id, args) => bookmarksRun(id, args),
  // BRW-03: cookies
  'browser-cookies': (id, args) => cookiesRun(id, args),
  // BRW-04: download history
  'browser-downloads': (id, args) => downloadsRun(id, args),
  // BRW-05: extensions
  'browser-extensions': (id, args) => extensionsRun(id, args),
  // BRW-06: autofill
  'browser-autofill': (id, args) => autofillRun(id, args),
  // BRW-07: cache metadata
  'browser-cache': (id, args) => cacheRun(id, args),
  // BRW-08: search history
  'browser-search-history': (id, args) => searchRun(id, args),
  // BRW-10: form data
  'browser-forms': (id, args) => formsRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for browser tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
