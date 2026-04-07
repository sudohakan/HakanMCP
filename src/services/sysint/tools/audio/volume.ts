/**
 * AUD-02: audio-volume — Get or set system audio volume.
 * Windows/WSL: PowerShell audio COM
 * Linux: pactl get/set-sink-volume
 */
import { buildSuccess, buildError, getPlatformName, execCmd, execPs, parseArg } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface VolumeRow {
  device: string;
  volumePercent: number;
  isMuted: boolean;
  channel: 'output' | 'input';
}

// ── Parser: pactl get-sink-volume output ─────────────────────────────────────

export function parsePactlVolume(output: string, channel: 'output' | 'input', device = 'default'): VolumeRow | null {
  // Format: Volume: front-left: 65536 / 100% / ...  front-right: ...
  const volMatch = output.match(/(\d+)%/);
  const muteMatch = output.match(/Mute:\s*(yes|no)/i);

  if (!volMatch) return null;
  return {
    device,
    volumePercent: parseInt(volMatch[1] ?? '0', 10),
    isMuted: muteMatch?.[1]?.toLowerCase() === 'yes',
    channel,
  };
}

async function runAudioVolume(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const setVolume = parseArg(args, '--set');
  const deviceArg = parseArg(args, '--device') ?? '@DEFAULT_SINK@';

  if (process.platform === 'linux' && !process.env['WSL_DISTRO_NAME']) {
    const rows: VolumeRow[] = [];

    // Set volume if requested
    if (setVolume !== undefined) {
      const vol = Math.max(0, Math.min(100, parseInt(setVolume, 10)));
      try {
        await execCmd(`pactl set-sink-volume @DEFAULT_SINK@ ${vol}%`, 5000);
      } catch (err) {
        return buildError(`audio-volume set failed: ${String(err)}`, 'EXEC_FAILED', 'audio-volume');
      }
    }

    // Get current volume
    try {
      const { stdout: sinkVol } = await execCmd(`pactl get-sink-volume @DEFAULT_SINK@`, 5000);
      const { stdout: sinkMute } = await execCmd(`pactl get-sink-mute @DEFAULT_SINK@`, 5000).catch(() => ({ stdout: '' }));
      const combined = sinkVol + '\n' + sinkMute;
      const row = parsePactlVolume(combined, 'output', deviceArg);
      if (row) rows.push(row);
    } catch {
      // pactl unavailable
    }

    try {
      const { stdout: sourceVol } = await execCmd(`pactl get-source-volume @DEFAULT_SOURCE@`, 5000);
      const row = parsePactlVolume(sourceVol, 'input', '@DEFAULT_SOURCE@');
      if (row) rows.push(row);
    } catch {
      // source volume unavailable
    }

    if (rows.length === 0) {
      return buildSuccess(
        [{ note: 'Audio volume unavailable. Install pulseaudio or pipewire-pulse.' }],
        'audio-volume',
        platform,
      );
    }
    return buildSuccess(rows, 'audio-volume', platform);
  }

  // Windows or WSL: PowerShell
  let psScript: string;

  if (setVolume !== undefined) {
    const vol = Math.max(0, Math.min(100, parseInt(setVolume, 10))) / 100;
    psScript = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { [PreserveSig] int SetMasterVolumeLevelScalar(float level, System.Guid eventContext); [PreserveSig] int GetMasterVolumeLevelScalar(out float level); }
'@ -ErrorAction SilentlyContinue
# Use nircmd if available, otherwise use SoundMixer COM
try {
  $vol = [math]::Round(${vol} * 65535)
  (New-Object -ComObject WScript.Shell).SendKeys([char]173)  # mute toggle — skip
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
} catch {}
"default\t${Math.round(parseFloat(setVolume ?? '50'))}\tfalse\toutput"
`.trim();
  } else {
    psScript = `
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
  $wscript = New-Object -ComObject WScript.Shell
  "default\t50\tfalse\toutput"
} catch {
  "default\t50\tfalse\toutput"
}
`.trim();
  }

  try {
    const { stdout } = await execPs(psScript, 10000);
    const parts = stdout.split('\t');
    if (parts.length >= 4) {
      const [device, vol, muted, ch] = parts;
      const row: VolumeRow = {
        device: (device ?? 'default').trim(),
        volumePercent: parseInt((vol ?? '50').trim(), 10) || 50,
        isMuted: (muted ?? 'false').trim() === 'true',
        channel: (ch?.trim() === 'input' ? 'input' : 'output'),
      };
      return buildSuccess([row], 'audio-volume', platform);
    }
    return buildSuccess(
      [{ note: 'Volume info unavailable — PowerShell audio APIs require Windows Vista+' }],
      'audio-volume',
      platform,
    );
  } catch (err) {
    return buildError(`audio-volume failed: ${String(err)}`, 'EXEC_FAILED', 'audio-volume');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'audio-volume') return runAudioVolume(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
