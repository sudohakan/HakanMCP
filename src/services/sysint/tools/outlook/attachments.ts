/**
 * OTL-01: outlook-attachments — List email attachments via Outlook COM automation.
 * Windows/WSL only. Returns graceful stub when Outlook not installed.
 */
import { buildSuccess, buildError, getPlatformName, assertWindowsOrWsl, execPs, parseArg } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface AttachmentRow {
  folder: string;
  subject: string;
  sender: string;
  date: string;
  attachmentName: string;
  attachmentSize: number;
}

export function parseAttachmentOutput(output: string): AttachmentRow[] {
  const rows: AttachmentRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 6) continue;
    const [folder, subject, sender, date, attachmentName, attachmentSize] = parts;
    if (!attachmentName?.trim()) continue;
    rows.push({
      folder: (folder ?? '').trim(),
      subject: (subject ?? '').trim(),
      sender: (sender ?? '').trim(),
      date: (date ?? '').trim(),
      attachmentName: (attachmentName ?? '').trim(),
      attachmentSize: parseInt((attachmentSize ?? '0').trim(), 10) || 0,
    });
  }
  return rows;
}

async function runOutlookAttachments(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const guard = assertWindowsOrWsl('outlook-attachments');
  if (guard) return guard;

  const folder = parseArg(args, '--folder') ?? '';
  const limit = parseInt(parseArg(args, '--limit') ?? '100', 10);

  const folderFilter = folder ? `$fold = $ns.Folders | Where-Object { $_.Name -like '*${folder.replace(/'/g, "''")}*' }` : '$fold = $ns.Folders';

  const script = `
try {
  $ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
  $ns = $ol.GetNamespace("MAPI")
  $count = 0
  $folders = $ns.Folders
  function ProcessFolder($f) {
    foreach ($item in $f.Items) {
      if ($count -ge ${limit}) { return }
      if ($item.Attachments.Count -gt 0) {
        foreach ($att in $item.Attachments) {
          $subject = try { $item.Subject } catch { '' }
          $sender = try { $item.SenderEmailAddress } catch { '' }
          $date = try { $item.ReceivedTime.ToString('yyyy-MM-ddTHH:mm:ss') } catch { '' }
          "$($f.Name)\t$subject\t$sender\t$date\t$($att.FileName)\t$($att.Size)"
          $count++
          if ($count -ge ${limit}) { return }
        }
      }
    }
    foreach ($sub in $f.Folders) { ProcessFolder $sub }
  }
  foreach ($topFolder in $folders) { ProcessFolder $topFolder }
} catch {
  Write-Output "OUTLOOK_UNAVAILABLE: $($_.Exception.Message)"
}
`.trim();

  try {
    const { stdout } = await execPs(script, 60000);
    if (stdout.startsWith('OUTLOOK_UNAVAILABLE:')) {
      return buildSuccess(
        [{ note: 'Outlook is not installed or not available on this system', detail: stdout }],
        'outlook-attachments',
        platform,
      );
    }
    const rows = parseAttachmentOutput(stdout);
    return buildSuccess(rows, 'outlook-attachments', platform);
  } catch (err) {
    return buildError(`outlook-attachments failed: ${String(err)}`, 'EXEC_FAILED', 'outlook-attachments');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'outlook-attachments') return runOutlookAttachments(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
