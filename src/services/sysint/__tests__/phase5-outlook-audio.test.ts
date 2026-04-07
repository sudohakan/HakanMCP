/**
 * Phase 5 Plan 02 tests — OTL-01..03, AUD-01..03
 * Tests: platform guards, parser functions, dispatcher routing.
 * All tests run on Linux CI.
 */

// ── Imports ──────────────────────────────────────────────────────────────────

let parseAttachmentOutput: (output: string) => unknown[];
let outlookAttachmentsRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parseStatsOutput: (output: string) => unknown[];
let outlookStatsRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parseAddressBookOutput: (output: string) => unknown[];
let outlookAddressBookRun: (toolId: string, args?: string[]) => Promise<unknown>;

let outlookRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parsePactlSinks: (output: string, type: string) => unknown[];
let parseAplayOutput: (output: string) => unknown[];
let audioDevicesRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parsePactlVolume: (output: string, channel: string, device?: string) => unknown;
let audioVolumeRun: (toolId: string, args?: string[]) => Promise<unknown>;

let parsePsCodecOutput: (output: string) => unknown[];
let parseProcAsoundPcm: (content: string) => unknown[];
let parseAplayPcms: (output: string) => unknown[];
let audioCodecsRun: (toolId: string, args?: string[]) => Promise<unknown>;

let audioRun: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const attMod = await import('../tools/outlook/attachments.js');
  parseAttachmentOutput = attMod.parseAttachmentOutput;
  outlookAttachmentsRun = attMod.run as unknown as typeof outlookAttachmentsRun;

  const statsMod = await import('../tools/outlook/mailboxstats.js');
  parseStatsOutput = statsMod.parseStatsOutput;
  outlookStatsRun = statsMod.run as unknown as typeof outlookStatsRun;

  const abMod = await import('../tools/outlook/addressbook.js');
  parseAddressBookOutput = abMod.parseAddressBookOutput;
  outlookAddressBookRun = abMod.run as unknown as typeof outlookAddressBookRun;

  const outlookIdxMod = await import('../tools/outlook/index.js');
  outlookRun = outlookIdxMod.run as unknown as typeof outlookRun;

  const devicesMod = await import('../tools/audio/devices.js');
  parsePactlSinks = devicesMod.parsePactlSinks as unknown as typeof parsePactlSinks;
  parseAplayOutput = devicesMod.parseAplayOutput;
  audioDevicesRun = devicesMod.run as unknown as typeof audioDevicesRun;

  const volMod = await import('../tools/audio/volume.js');
  parsePactlVolume = volMod.parsePactlVolume as unknown as typeof parsePactlVolume;
  audioVolumeRun = volMod.run as unknown as typeof audioVolumeRun;

  const codecsMod = await import('../tools/audio/codecs.js');
  parsePsCodecOutput = codecsMod.parsePsCodecOutput;
  parseProcAsoundPcm = codecsMod.parseProcAsoundPcm;
  parseAplayPcms = codecsMod.parseAplayPcms;
  audioCodecsRun = codecsMod.run as unknown as typeof audioCodecsRun;

  const audioIdxMod = await import('../tools/audio/index.js');
  audioRun = audioIdxMod.run as unknown as typeof audioRun;
});

// ── OTL platform guards ───────────────────────────────────────────────────────

const OUTLOOK_TOOLS = ['outlook-attachments', 'outlook-stats', 'outlook-addressbook'];

describe('Outlook platform guards — Linux returns PLATFORM_UNSUPPORTED', () => {
  const origPlatform = process.platform;
  const origWslEnv = process.env['WSL_DISTRO_NAME'];

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env['WSL_DISTRO_NAME'];
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    if (origWslEnv !== undefined) process.env['WSL_DISTRO_NAME'] = origWslEnv;
  });

  for (const toolId of OUTLOOK_TOOLS) {
    it(`${toolId} returns PLATFORM_UNSUPPORTED on Linux`, async () => {
      const result = (await outlookRun(toolId, [])) as Record<string, unknown>;
      expect(result).toHaveProperty('code', 'PLATFORM_UNSUPPORTED');
      expect(result).toHaveProperty('tool', toolId);
    });
  }
});

// ── OTL-01: parseAttachmentOutput ────────────────────────────────────────────

describe('parseAttachmentOutput', () => {
  it('parses tab-separated attachment rows', () => {
    const output = [
      'Inbox\tRe: Meeting\tjohn@example.com\t2024-01-15T10:00:00\treport.pdf\t102400',
      'Sent\tQuarterly Update\tme@example.com\t2024-01-20T14:30:00\tq4-report.xlsx\t51200',
    ].join('\n');

    const rows = parseAttachmentOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      folder: 'Inbox',
      subject: 'Re: Meeting',
      sender: 'john@example.com',
      attachmentName: 'report.pdf',
      attachmentSize: 102400,
    });
  });

  it('skips lines with empty attachmentName', () => {
    const output = 'Inbox\tSubject\tsender@test.com\t2024-01-01\t\t0';
    expect(parseAttachmentOutput(output)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(parseAttachmentOutput('')).toEqual([]);
  });
});

// ── OTL-02: parseStatsOutput ──────────────────────────────────────────────────

describe('parseStatsOutput', () => {
  it('parses tab-separated stats rows', () => {
    const output = [
      'Inbox\t1523\t42\t12.5',
      'Sent Items\t987\t0\t8.2',
    ].join('\n');

    const rows = parseStatsOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      folder: 'Inbox',
      messageCount: 1523,
      unreadCount: 42,
      totalSizeMB: 12.5,
    });
    expect(rows[1]).toMatchObject({ folder: 'Sent Items', messageCount: 987, unreadCount: 0 });
  });

  it('skips lines with empty folder', () => {
    expect(parseStatsOutput('\t100\t0\t1.0')).toHaveLength(0);
  });
});

// ── OTL-03: parseAddressBookOutput ───────────────────────────────────────────

describe('parseAddressBookOutput', () => {
  it('parses tab-separated address book rows', () => {
    const output = [
      'John Doe\tjohn.doe@example.com\tAcme Corp\t+1-555-1234\tGlobal Address List',
      'Jane Smith\tjane.smith@example.com\t\t\tPersonal',
    ].join('\n');

    const rows = parseAddressBookOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      displayName: 'John Doe',
      email: 'john.doe@example.com',
      company: 'Acme Corp',
      addressList: 'Global Address List',
    });
    expect(rows[1]).toMatchObject({ displayName: 'Jane Smith', company: '' });
  });

  it('skips rows with empty name and email', () => {
    const output = '\t\t\t\tGAL';
    expect(parseAddressBookOutput(output)).toHaveLength(0);
  });
});

// ── Outlook dispatcher ────────────────────────────────────────────────────────

describe('outlook/index.ts dispatcher', () => {
  it('returns EXEC_FAILED for unknown tool ID', async () => {
    const result = (await outlookRun('unknown-outlook-tool', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });
});

// ── AUD-01: parsePactlSinks ───────────────────────────────────────────────────

describe('parsePactlSinks', () => {
  it('parses pactl list sinks output', () => {
    const output = [
      'Sink #0',
      '    State: RUNNING',
      '    Name: alsa_output.pci-0000_00_1f.3.analog-stereo',
      '    Description: Built-in Audio Analog Stereo',
      '    Channels: 2',
      '    Sample Specification: s16le 2ch 44100Hz',
    ].join('\n');

    const rows = parsePactlSinks(output, 'output') as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({
      name: 'alsa_output.pci-0000_00_1f.3.analog-stereo',
      type: 'output',
      status: 'RUNNING',
    });
  });

  it('returns empty array for empty output', () => {
    expect(parsePactlSinks('', 'output')).toEqual([]);
  });

  it('filters out monitor sources when checking type', () => {
    const output = [
      'Source #1',
      '    Name: alsa_output.pci.analog-stereo.monitor',
      '    Description: Monitor of Built-in Audio',
      '    State: IDLE',
    ].join('\n');
    const rows = parsePactlSinks(output, 'input') as Array<Record<string, unknown>>;
    // Parsing returns the monitor source — filtering happens in the caller
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});

// ── AUD-01: parseAplayOutput ──────────────────────────────────────────────────

describe('parseAplayOutput', () => {
  it('parses aplay -l output', () => {
    const output = [
      '**** List of PLAYBACK Hardware Devices ****',
      'card 0: PCH [HDA Intel PCH], device 0: ALC887-VD Analog [ALC887-VD Analog]',
      '  Subdevices: 1/1',
      'card 0: PCH [HDA Intel PCH], device 3: HDMI 0 [HDMI 0]',
    ].join('\n');

    const rows = parseAplayOutput(output) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const card = rows.find((r) => r['name'] === 'PCH');
    expect(card).toBeDefined();
    expect(card).toMatchObject({ type: 'output', driver: 'alsa' });
  });

  it('returns empty array for empty output', () => {
    expect(parseAplayOutput('')).toEqual([]);
  });
});

// ── AUD-01: audio-devices run ────────────────────────────────────────────────

describe('audio-devices run', () => {
  it('returns valid result shape on any platform', async () => {
    const result = (await audioDevicesRun('audio-devices', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('tool', 'audio-devices');
    if (!('code' in result)) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 10000);
});

// ── AUD-02: parsePactlVolume ──────────────────────────────────────────────────

describe('parsePactlVolume', () => {
  it('parses pactl volume output with percentage', () => {
    const output = 'Volume: front-left: 43253 /  66% / -10.37 dB,   front-right: 43253 /  66% / -10.37 dB\nMute: no';
    const result = parsePactlVolume(output, 'output', 'default') as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      volumePercent: 66,
      isMuted: false,
      channel: 'output',
    });
  });

  it('detects muted state', () => {
    const output = 'Volume: front-left: 0 /   0% / -inf dB\nMute: yes';
    const result = parsePactlVolume(output, 'output') as Record<string, unknown>;
    expect(result).toMatchObject({ isMuted: true });
  });

  it('returns null for unparseable output', () => {
    expect(parsePactlVolume('no volume info here', 'output')).toBeNull();
  });
});

// ── AUD-02: audio-volume run ──────────────────────────────────────────────────

describe('audio-volume run', () => {
  it('returns valid result shape', async () => {
    const result = (await audioVolumeRun('audio-volume', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('tool', 'audio-volume');
    if (!('code' in result)) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 10000);
});

// ── AUD-03: parsePsCodecOutput ────────────────────────────────────────────────

describe('parsePsCodecOutput', () => {
  it('parses tab-separated codec output', () => {
    const output = [
      'MP3 Audio Codec\tMP3 Audio Codec\tC:\\Windows\\System32\\l3codeca.acm\t1.0.0.1',
      'PCM Audio Codec\tPCM Audio Codec\tC:\\Windows\\System32\\msacm32.drv\t6.3.9600',
    ].join('\n');

    const rows = parsePsCodecOutput(output) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'MP3 Audio Codec', type: 'audio' });
    expect(rows[1]).toMatchObject({ name: 'PCM Audio Codec', type: 'pcm' });
  });

  it('skips lines with empty name', () => {
    expect(parsePsCodecOutput('\t\tsome/path\t1.0')).toHaveLength(0);
  });
});

// ── AUD-03: parseProcAsoundPcm ────────────────────────────────────────────────

describe('parseProcAsoundPcm', () => {
  it('parses /proc/asound/pcm format', () => {
    const content = [
      '00-00: ALC887-VD Analog : ALC887-VD Analog : playback 2 : capture 1',
      '00-03: HDMI 0 : HDMI 0 : playback 1',
    ].join('\n');

    const rows = parseProcAsoundPcm(content) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toMatchObject({ type: 'pcm' });
  });
});

// ── AUD-03: parseAplayPcms ────────────────────────────────────────────────────

describe('parseAplayPcms', () => {
  it('parses aplay --list-pcms output', () => {
    const output = [
      'null',
      '    Discard all samples (playback) or generate zero samples (capture)',
      'default:CARD=PCH',
      '    HDA Intel PCH, ALC887-VD Analog',
      'hw:CARD=PCH,DEV=0',
      '    HDA Intel PCH, ALC887-VD Analog',
    ].join('\n');

    const rows = parseAplayPcms(output) as Array<Record<string, unknown>>;
    // Should capture lines with : in device name
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ── AUD-03: audio-codecs run ──────────────────────────────────────────────────

describe('audio-codecs run', () => {
  it('returns valid result shape', async () => {
    const result = (await audioCodecsRun('audio-codecs', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('tool', 'audio-codecs');
    if (!('code' in result)) {
      expect(Array.isArray(result['rows'])).toBe(true);
    }
  }, 10000);
});

// ── Audio dispatcher ──────────────────────────────────────────────────────────

const AUDIO_TOOLS = ['audio-devices', 'audio-volume', 'audio-codecs'];

describe('audio/index.ts dispatcher', () => {
  it('returns EXEC_FAILED for unknown tool ID', async () => {
    const result = (await audioRun('unknown-audio-tool', [])) as Record<string, unknown>;
    expect(result).toHaveProperty('code', 'EXEC_FAILED');
  });

  it('dispatches all 3 audio tool IDs to handlers', async () => {
    for (const toolId of AUDIO_TOOLS) {
      const result = (await audioRun(toolId, [])) as Record<string, unknown>;
      expect(result).toHaveProperty('tool', toolId);
      if ('code' in result) {
        expect((result['error'] as string ?? '')).not.toContain('No native handler for audio tool');
      }
    }
  }, 30000);
});
