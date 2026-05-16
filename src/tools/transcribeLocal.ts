import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { safePath, jsonResultTruncated } from './_httpShared.js';

const execFileAsync = promisify(execFile);

const schema = z.object({
  audio_path: z.string(),
  model: z.enum(['tiny', 'base', 'small', 'medium', 'large']).default('base'),
  language: z.string().default('auto'),
  output_format: z.enum(['text', 'json', 'srt', 'vtt']).default('json'),
});

// Python script that runs faster-whisper and outputs JSON
const WHISPER_SCRIPT = `
import sys, json
try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "faster-whisper not installed. Run: pip install faster-whisper"}))
    sys.exit(1)

audio_path = sys.argv[1]
model_size = sys.argv[2]
language = sys.argv[3] if sys.argv[3] != "auto" else None
fmt = sys.argv[4]

model = WhisperModel(model_size, device="cpu", compute_type="int8")
segments, info = model.transcribe(audio_path, language=language, beam_size=5)

results = []
full_text = []
for seg in segments:
    results.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
    full_text.append(seg.text.strip())

output = {
    "language": info.language,
    "language_probability": round(info.language_probability, 3),
    "duration": round(info.duration, 2),
    "text": " ".join(full_text),
    "segments": results,
}

if fmt == "srt":
    lines = []
    for i, seg in enumerate(results, 1):
        def ts(t):
            h, r = divmod(int(t), 3600); m, s = divmod(r, 60); ms = int((t - int(t)) * 1000)
            return f"{h:02}:{m:02}:{s:02},{ms:03}"
        lines.append(f"{i}\\n{ts(seg['start'])} --> {ts(seg['end'])}\\n{seg['text']}\\n")
    output["srt"] = "\\n".join(lines)
elif fmt == "vtt":
    def ts(t):
        h, r = divmod(int(t), 3600); m, s = divmod(r, 60); ms = int((t - int(t)) * 1000)
        return f"{h:02}:{m:02}:{s:02}.{ms:03}"
    lines = ["WEBVTT\\n"]
    for seg in results:
        lines.append(f"{ts(seg['start'])} --> {ts(seg['end'])}\\n{seg['text']}\\n")
    output["vtt"] = "\\n".join(lines)

print(json.dumps(output))
`.trim();

export const transcribeLocalTools = [
  {
    name: 'transcribeLocal',
    description: 'Transcribe audio file locally using faster-whisper (offline, no API key required). Supports mp3/wav/m4a/ogg/flac. Outputs transcript with timestamps. Requires faster-whisper Python package (pip install faster-whisper). Models: tiny/base/small/medium/large — base is a good balance of speed and accuracy.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        audio_path: { type: 'string', description: 'Absolute path to audio file (.mp3, .wav, .m4a, .ogg, .flac)' },
        model: {
          type: 'string',
          enum: ['tiny', 'base', 'small', 'medium', 'large'],
          description: 'Whisper model size (default: base). tiny=fastest, large=most accurate',
        },
        language: { type: 'string', description: 'Language code (e.g. "tr", "en") or "auto" for auto-detect (default: auto)' },
        output_format: {
          type: 'string',
          enum: ['text', 'json', 'srt', 'vtt'],
          description: 'Output format: text (plain), json (with timestamps), srt (subtitle), vtt (webvtt). Default: json',
        },
      },
      required: ['audio_path'],
    },
    handler: async (args: unknown) => {
      const parsed = schema.parse(args);
      const audioPath = safePath(parsed.audio_path, 'read');

      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }

      const ext = path.extname(audioPath).toLowerCase();
      const supportedExts = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm', '.mp4'];
      if (!supportedExts.includes(ext)) {
        throw new Error(`Unsupported audio format: ${ext}. Supported: ${supportedExts.join(', ')}`);
      }

      // Write Python script to temp file
      const scriptPath = path.join(os.tmpdir(), `hakanmcp_whisper_${Date.now()}.py`);
      fs.writeFileSync(scriptPath, WHISPER_SCRIPT);

      try {
        const pythonBin = process.env.WHISPER_PYTHON_BIN ?? 'python3';
        const { stdout, stderr } = await execFileAsync(
          pythonBin,
          [scriptPath, audioPath, parsed.model, parsed.language, parsed.output_format],
          { timeout: 300_000 },
        );

        if (stderr && stderr.includes('"error"')) {
          throw new Error(stderr.trim());
        }

        let result: unknown;
        try {
          result = JSON.parse(stdout.trim());
        } catch {
          throw new Error(`Failed to parse whisper output: ${stdout.slice(0, 500)}`);
        }

        const r = result as { error?: string; text?: string; language?: string; segments?: unknown[] };
        if (r.error) throw new Error(r.error);

        if (parsed.output_format === 'text') {
          return jsonResultTruncated({ text: r.text, language: r.language });
        }
        return jsonResultTruncated(result);
      } finally {
        fs.unlinkSync(scriptPath);
      }
    },
  },
];
