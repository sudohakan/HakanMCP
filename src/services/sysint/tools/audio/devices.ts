/**
 * AUD-01: audio-devices — List audio input/output devices.
 * Windows/WSL: Win32_SoundDevice via PowerShell
 * Linux: pactl list sinks/sources, fallback aplay -l
 */
import { buildSuccess, buildError, getPlatformName, execCmd, execPs } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface AudioDeviceRow {
  name: string;
  description: string;
  type: 'output' | 'input' | 'unknown';
  isDefault: boolean;
  status: string;
  driver: string;
  channels: number;
  sampleRate: number;
}

// ── Parser: pactl list sinks/sources ─────────────────────────────────────────

export function parsePactlSinks(output: string, type: 'output' | 'input'): AudioDeviceRow[] {
  const rows: AudioDeviceRow[] = [];
  const blocks = output.split(/\n(?=Sink|Source)\s*#/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const nameMatch = block.match(/^\s*Name:\s*(.+)$/m);
    const descMatch = block.match(/^\s*Description:\s*(.+)$/m);
    const stateMatch = block.match(/^\s*State:\s*(.+)$/m);
    const defaultMatch = block.includes('* Default');
    const channelMatch = block.match(/^\s*Channels:\s*(\d+)/m);
    const rateMatch = block.match(/sample spec:.*?(\d+)Hz/i) ?? block.match(/^\s*Sample Specification:.*?(\d+)Hz/mi);

    const name = nameMatch?.[1]?.trim() ?? '';
    if (!name) continue;

    rows.push({
      name,
      description: descMatch?.[1]?.trim() ?? name,
      type,
      isDefault: defaultMatch,
      status: stateMatch?.[1]?.trim() ?? 'unknown',
      driver: 'pulseaudio',
      channels: parseInt(channelMatch?.[1] ?? '2', 10),
      sampleRate: parseInt(rateMatch?.[1] ?? '44100', 10),
    });
  }
  return rows;
}

export function parseAplayOutput(output: string): AudioDeviceRow[] {
  const rows: AudioDeviceRow[] = [];
  for (const line of output.split('\n')) {
    // Format: card N: Name [Description], device M: ...
    const cardMatch = line.match(/^card\s+(\d+):\s+(\S+)\s+\[(.+?)\]/);
    if (!cardMatch) continue;
    const [, , shortName, description] = cardMatch;
    rows.push({
      name: shortName ?? '',
      description: description ?? '',
      type: 'output',
      isDefault: false,
      status: 'present',
      driver: 'alsa',
      channels: 2,
      sampleRate: 44100,
    });
  }
  return rows;
}

// ── Parser: PowerShell Win32_SoundDevice output ───────────────────────────────

export function parsePsAudioDevices(output: string, type: 'output' | 'input'): AudioDeviceRow[] {
  const rows: AudioDeviceRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [name, description, status] = parts;
    if (!name?.trim()) continue;
    rows.push({
      name: (name ?? '').trim(),
      description: (description ?? '').trim(),
      type,
      isDefault: false,
      status: (status ?? 'unknown').trim(),
      driver: 'wdm',
      channels: 2,
      sampleRate: 44100,
    });
  }
  return rows;
}

async function runAudioDevices(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const rows: AudioDeviceRow[] = [];

  if (process.platform === 'linux' && !process.env['WSL_DISTRO_NAME']) {
    // Linux: try pactl first
    try {
      const { stdout: sinksOut } = await execCmd('pactl list sinks', 10000);
      const sinks = parsePactlSinks(sinksOut, 'output');
      rows.push(...sinks);
    } catch {
      // pactl not available
    }

    try {
      const { stdout: sourcesOut } = await execCmd('pactl list sources', 10000);
      const sources = parsePactlSinks(sourcesOut, 'input');
      // Filter out monitor sources
      rows.push(...sources.filter((s) => !s.name.includes('.monitor')));
    } catch {
      // pactl sources not available
    }

    // Fallback: aplay -l for output devices
    if (rows.length === 0) {
      try {
        const { stdout: aplayOut } = await execCmd('aplay -l', 10000);
        rows.push(...parseAplayOutput(aplayOut));
      } catch {
        // aplay not available either
      }
    }

    if (rows.length === 0) {
      return buildSuccess(
        [{ note: 'No audio system found. Install pulseaudio or pipewire-pulse.' }],
        'audio-devices',
        platform,
      );
    }
    return buildSuccess(rows, 'audio-devices', platform);
  }

  // Windows or WSL: PowerShell
  const script = `
# Output devices (render)
$render = Get-CimInstance -ClassName Win32_SoundDevice -ErrorAction SilentlyContinue
foreach ($d in $render) {
  "$($d.Name)\t$($d.Description)\t$($d.Status)\toutput"
}
`.trim();

  try {
    const { stdout } = await execPs(script, 15000);
    for (const line of stdout.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 4) continue;
      const [name, description, status, type] = parts;
      if (!name?.trim()) continue;
      rows.push({
        name: (name ?? '').trim(),
        description: (description ?? '').trim(),
        type: (type?.trim() === 'output' ? 'output' : 'input'),
        isDefault: false,
        status: (status ?? 'unknown').trim(),
        driver: 'wdm',
        channels: 2,
        sampleRate: 44100,
      });
    }
    return buildSuccess(rows, 'audio-devices', platform);
  } catch (err) {
    return buildError(`audio-devices failed: ${String(err)}`, 'EXEC_FAILED', 'audio-devices');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'audio-devices') return runAudioDevices(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
