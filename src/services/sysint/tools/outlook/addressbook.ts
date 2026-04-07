/**
 * OTL-03: outlook-addressbook — List Outlook address book contacts via COM automation.
 * Windows/WSL only. Returns graceful stub when Outlook not installed.
 */
import { buildSuccess, buildError, getPlatformName, assertWindowsOrWsl, execPs, parseArg } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface AddressBookRow {
  displayName: string;
  email: string;
  company: string;
  phone: string;
  addressList: string;
}

export function parseAddressBookOutput(output: string): AddressBookRow[] {
  const rows: AddressBookRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const [displayName, email, company, phone, addressList] = parts;
    if (!displayName?.trim() && !email?.trim()) continue;
    rows.push({
      displayName: (displayName ?? '').trim(),
      email: (email ?? '').trim(),
      company: (company ?? '').trim(),
      phone: (phone ?? '').trim(),
      addressList: (addressList ?? '').trim(),
    });
  }
  return rows;
}

async function runOutlookAddressBook(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const guard = assertWindowsOrWsl('outlook-addressbook');
  if (guard) return guard;

  const limit = parseInt(parseArg(args, '--limit') ?? '500', 10);

  const script = `
try {
  $ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
  $ns = $ol.GetNamespace("MAPI")
  $count = 0
  foreach ($abList in $ns.AddressLists) {
    foreach ($entry in $abList.AddressEntries) {
      if ($count -ge ${limit}) { break }
      $name = try { $entry.Name } catch { '' }
      $email = try { $entry.Address } catch { '' }
      $company = ''
      $phone = ''
      try {
        $contact = $entry.GetContact()
        if ($contact) {
          $company = $contact.CompanyName
          $phone = $contact.BusinessTelephoneNumber
        }
      } catch {}
      "$name\t$email\t$company\t$phone\t$($abList.Name)"
      $count++
    }
    if ($count -ge ${limit}) { break }
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
        'outlook-addressbook',
        platform,
      );
    }
    const rows = parseAddressBookOutput(stdout);
    return buildSuccess(rows, 'outlook-addressbook', platform);
  } catch (err) {
    return buildError(`outlook-addressbook failed: ${String(err)}`, 'EXEC_FAILED', 'outlook-addressbook');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'outlook-addressbook') return runOutlookAddressBook(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
