/**
 * REG-06: registry-usb — List USB device history from Windows registry.
 * Windows/WSL only. Returns PLATFORM_UNSUPPORTED on Linux.
 */
import {
  buildSuccess,
  buildError,
  getPlatformName,
  assertWindowsOrWsl,
  execPs,
} from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface UsbRow {
  deviceClass: string;
  deviceId: string;
  friendlyName: string;
  manufacturer: string;
  service: string;
}

export function parseUsbOutput(output: string): UsbRow[] {
  const rows: UsbRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const [deviceClass, deviceId, friendlyName, manufacturer, service] = parts;
    if (!deviceId || deviceId.trim() === '') continue;
    rows.push({
      deviceClass: (deviceClass ?? '').trim(),
      deviceId: (deviceId ?? '').trim(),
      friendlyName: (friendlyName ?? '').trim(),
      manufacturer: (manufacturer ?? '').trim(),
      service: (service ?? '').trim(),
    });
  }
  return rows;
}

async function runRegistryUsb(_args: string[]): Promise<SysIntResult> {
  const platformGuard = assertWindowsOrWsl('registry-usb');
  if (platformGuard) return platformGuard;

  const script = `
$usbRoots = @(
  'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USB',
  'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USBSTOR'
)

foreach ($root in $usbRoots) {
  try {
    $class = if ($root -match 'USBSTOR') { 'USBSTOR' } else { 'USB' }
    Get-ChildItem -Path $root -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $v = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
        $devId = $_.PSChildName
        if ($devId) {
          "$class\t$devId\t$([string]$v.FriendlyName)\t$([string]$v.Mfg)\t$([string]$v.Service)"
        }
      } catch {}
    }
  } catch {}
}
`.trim();

  try {
    const { stdout } = await execPs(script);
    const rows = parseUsbOutput(stdout);
    // Deduplicate by deviceId
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      if (seen.has(r.deviceId)) return false;
      seen.add(r.deviceId);
      return true;
    });
    return buildSuccess(unique, 'registry-usb', getPlatformName());
  } catch (err) {
    return buildError(`registry-usb failed: ${String(err)}`, 'EXEC_FAILED', 'registry-usb');
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'registry-usb': runRegistryUsb,
};

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  const handler = HANDLERS[toolId];
  if (!handler) return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
