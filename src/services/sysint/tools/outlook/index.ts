/**
 * Outlook category entry point — dispatches OTL-01..03.
 * OTL-01: outlook-attachments  — attachment listing
 * OTL-02: outlook-stats        — mailbox statistics
 * OTL-03: outlook-addressbook  — address book reader
 */
import { run as attachmentsRun } from './attachments.js';
import { run as statsRun } from './mailboxstats.js';
import { run as addressBookRun } from './addressbook.js';
import { buildError } from '../../outputFormatter.js';
import type { SysIntResult } from '../../outputFormatter.js';

const MODULE_MAP: Record<string, (toolId: string, args: string[]) => Promise<SysIntResult>> = {
  'outlook-attachments': (id, args) => attachmentsRun(id, args),
  'outlook-stats': (id, args) => statsRun(id, args),
  'outlook-addressbook': (id, args) => addressBookRun(id, args),
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = MODULE_MAP[toolId];
  if (!handler) {
    return buildError(`No native handler for outlook tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
  return handler(toolId, args);
}
