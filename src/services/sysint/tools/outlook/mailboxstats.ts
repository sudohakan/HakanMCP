/**
 * OTL-02: outlook-stats — Outlook mailbox folder statistics via COM automation.
 * Windows/WSL only. Returns graceful stub when Outlook not installed.
 */
import { buildSuccess, buildError, getPlatformName, assertWindowsOrWsl, execPs } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface MailboxStatsRow {
  folder: string;
  messageCount: number;
  unreadCount: number;
  totalSizeMB: number;
}

export function parseStatsOutput(output: string): MailboxStatsRow[] {
  const rows: MailboxStatsRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [folder, messageCount, unreadCount, totalSizeMB] = parts;
    if (!folder?.trim()) continue;
    rows.push({
      folder: (folder ?? '').trim(),
      messageCount: parseInt((messageCount ?? '0').trim(), 10) || 0,
      unreadCount: parseInt((unreadCount ?? '0').trim(), 10) || 0,
      totalSizeMB: parseFloat((totalSizeMB ?? '0').trim()) || 0,
    });
  }
  return rows;
}

async function runOutlookStats(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const guard = assertWindowsOrWsl('outlook-stats');
  if (guard) return guard;

  const script = `
try {
  $ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
  $ns = $ol.GetNamespace("MAPI")
  function GetFolderStats($folder, $depth = 0) {
    if ($depth -gt 5) { return }
    $count = $folder.Items.Count
    $unread = try { $folder.UnReadItemCount } catch { 0 }
    $size = try { ($folder.Items | Measure-Object -Property Size -Sum).Sum / 1MB } catch { 0 }
    "$($folder.Name)\t$count\t$unread\t$([math]::Round($size, 2))"
    foreach ($sub in $folder.Folders) { GetFolderStats $sub ($depth + 1) }
  }
  foreach ($store in $ns.Stores) {
    foreach ($folder in $store.GetRootFolder().Folders) {
      GetFolderStats $folder
    }
  }
} catch {
  Write-Output "OUTLOOK_UNAVAILABLE: $($_.Exception.Message)"
}
`.trim();

  try {
    const { stdout } = await execPs(script, 60000);
    if (stdout.startsWith('OUTLOOK_UNAVAILABLE:')) {
      return buildSuccess(
        [{ note: 'Outlook is not installed or not available on this system', detail: stdout }],
        'outlook-stats',
        platform,
      );
    }
    const rows = parseStatsOutput(stdout);
    return buildSuccess(rows, 'outlook-stats', platform);
  } catch (err) {
    return buildError(`outlook-stats failed: ${String(err)}`, 'EXEC_FAILED', 'outlook-stats');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'outlook-stats') return runOutlookStats(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
