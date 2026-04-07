/**
 * AUD-03: audio-codecs — List audio codecs and PCM devices.
 * Windows/WSL: Win32_CodecFile via PowerShell
 * Linux: /proc/asound/pcm + aplay --list-pcms
 */
import { readFileSync } from 'node:fs';
import { buildSuccess, buildError, getPlatformName, execCmd, execPs } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface CodecRow {
  name: string;
  description: string;
  type: 'audio' | 'video' | 'pcm' | 'acm' | 'unknown';
  path: string;
  version: string;
}

// ── Parser: Win32_CodecFile output ────────────────────────────────────────────

export function parsePsCodecOutput(output: string): CodecRow[] {
  const rows: CodecRow[] = [];
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [name, description, path, version] = parts;
    if (!name?.trim()) continue;
    const lower = (description ?? '').toLowerCase();
    const type: CodecRow['type'] = lower.includes('pcm') ? 'pcm'
      : lower.includes('audio') || lower.includes('ac3') || lower.includes('mp3') ? 'audio'
      : lower.includes('video') || lower.includes('h264') || lower.includes('mpeg') ? 'video'
      : lower.includes('acm') ? 'acm'
      : 'unknown';
    rows.push({
      name: (name ?? '').trim(),
      description: (description ?? '').trim(),
      type,
      path: (path ?? '').trim(),
      version: (version ?? '').trim(),
    });
  }
  return rows;
}

// ── Parser: /proc/asound/pcm ──────────────────────────────────────────────────

export function parseProcAsoundPcm(content: string): CodecRow[] {
  const rows: CodecRow[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: 00-00: ALC887-VD Analog : ALC887-VD Analog : playback 2 : capture 1
    const match = trimmed.match(/^(\d+-\d+):\s+(.+?)(?:\s*:\s*(.+?))?(?:\s*:\s*(playback|capture))?/);
    if (!match) continue;
    const [, id, name, description] = match;
    rows.push({
      name: (name ?? id ?? '').trim(),
      description: (description ?? name ?? '').trim(),
      type: 'pcm',
      path: `/proc/asound/pcm/${id}`,
      version: '',
    });
  }
  return rows;
}

// ── Parser: aplay --list-pcms output ─────────────────────────────────────────

export function parseAplayPcms(output: string): CodecRow[] {
  const rows: CodecRow[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    // Lines like: hw:CARD=PCH,DEV=0  or  default:CARD=PCH
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    const name = parts[0];
    if (!name || !name.includes(':')) continue;
    rows.push({
      name,
      description: parts.slice(1).join(' ').trim(),
      type: 'pcm',
      path: '',
      version: '',
    });
  }
  return rows;
}

async function runAudioCodecs(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const rows: CodecRow[] = [];

  if (process.platform === 'linux' && !process.env['WSL_DISTRO_NAME']) {
    // Try /proc/asound/pcm first
    try {
      const content = readFileSync('/proc/asound/pcm', 'utf8');
      rows.push(...parseProcAsoundPcm(content));
    } catch {
      // Not available
    }

    // Try aplay --list-pcms
    if (rows.length === 0) {
      try {
        const { stdout } = await execCmd('aplay --list-pcms', 5000);
        rows.push(...parseAplayPcms(stdout));
      } catch {
        // aplay not available
      }
    }

    if (rows.length === 0) {
      return buildSuccess(
        [{ note: 'No audio PCM devices found. Install alsa-utils for aplay.' }],
        'audio-codecs',
        platform,
      );
    }
    return buildSuccess(rows, 'audio-codecs', platform);
  }

  // Windows or WSL: PowerShell Win32_CodecFile
  const script = `
$codecs = Get-CimInstance -ClassName Win32_CodecFile -ErrorAction SilentlyContinue
foreach ($c in $codecs) {
  "$($c.Description)\t$($c.Description)\t$($c.Name)\t$($c.Version)"
}
`.trim();

  try {
    const { stdout } = await execPs(script, 15000);
    rows.push(...parsePsCodecOutput(stdout));
    return buildSuccess(rows, 'audio-codecs', platform);
  } catch (err) {
    return buildError(`audio-codecs failed: ${String(err)}`, 'EXEC_FAILED', 'audio-codecs');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'audio-codecs') return runAudioCodecs(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
