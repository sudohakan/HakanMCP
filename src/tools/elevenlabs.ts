import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fetchWithRetry, jsonResultTruncated, safePath } from './_httpShared.js';

const EL_BASE = 'https://api.elevenlabs.io/v1';

function requireKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error('ELEVENLABS_API_KEY not set — configure via Bitwarden "API Key — ElevenLabs"');
  return k;
}

const ttsSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string(),
  modelId: z.string().default('eleven_multilingual_v2'),
  outputPath: z.string(),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
});

const transcribeSchema = z.object({
  filePath: z.string(),
  model: z.enum(['whisper-1', 'scribe_v1']).default('scribe_v1'),
});

const voiceCloneSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  filePaths: z.array(z.string()).min(1).max(25),
});

export const elevenlabsTools = [
  {
    name: 'ttsGenerate',
    description: 'Generate TTS MP3 from text via ElevenLabs. Requires ELEVENLABS_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to synthesize (1-5000 chars)' },
        voiceId: { type: 'string', description: 'ElevenLabs voice ID (use listVoices)' },
        modelId: { type: 'string', description: 'Model ID (default eleven_multilingual_v2)' },
        outputPath: { type: 'string', description: 'Absolute path for .mp3 output' },
        stability: { type: 'number', description: 'Voice stability 0-1 (default 0.5)' },
        similarityBoost: { type: 'number', description: 'Similarity boost 0-1 (default 0.75)' },
      },
      required: ['text', 'voiceId', 'outputPath'],
    },
    handler: async (args: unknown) => {
      const parsed = ttsSchema.parse(args);
      const apiKey = requireKey();
      const res = await fetchWithRetry(`${EL_BASE}/text-to-speech/${encodeURIComponent(parsed.voiceId)}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: parsed.text,
          model_id: parsed.modelId,
          voice_settings: { stability: parsed.stability, similarity_boost: parsed.similarityBoost },
        }),
      });
      if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const outPath = safePath(parsed.outputPath, 'write');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buffer);
      return jsonResultTruncated({ ok: true, path: outPath, bytes: buffer.length });
    },
  },
  {
    name: 'listVoices',
    description: 'List available ElevenLabs voices. Requires ELEVENLABS_API_KEY.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
    handler: async (_args: unknown) => {
      const apiKey = requireKey();
      const res = await fetchWithRetry(`${EL_BASE}/voices`, { headers: { 'xi-api-key': apiKey } });
      if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
      return jsonResultTruncated(await res.json());
    },
  },
  {
    name: 'transcribe',
    description: 'Transcribe audio file via ElevenLabs STT. Requires ELEVENLABS_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: { type: 'string', description: 'Absolute path of audio file (.mp3/.wav/.m4a)' },
        model: { type: 'string', enum: ['whisper-1', 'scribe_v1'], description: 'STT model (default scribe_v1)' },
      },
      required: ['filePath'],
    },
    handler: async (args: unknown) => {
      const parsed = transcribeSchema.parse(args);
      const apiKey = requireKey();
      const audioPath = safePath(parsed.filePath, 'read');
      if (!fs.existsSync(audioPath)) throw new Error(`Audio file not found: ${audioPath}`);
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', fs.createReadStream(audioPath));
      form.append('model_id', parsed.model);
      const res = await fetchWithRetry(`${EL_BASE}/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
        body: form as unknown as NodeJS.ReadableStream,
      });
      if (!res.ok) throw new Error(`ElevenLabs transcribe ${res.status}: ${await res.text()}`);
      return jsonResultTruncated(await res.json());
    },
  },
  {
    name: 'voiceClone',
    description: 'Clone a voice from audio samples. Requires ELEVENLABS_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Voice name' },
        description: { type: 'string', description: 'Voice description (optional)' },
        filePaths: { type: 'array', items: { type: 'string' }, description: 'Audio sample paths (1-25)' },
      },
      required: ['name', 'filePaths'],
    },
    handler: async (args: unknown) => {
      const parsed = voiceCloneSchema.parse(args);
      const apiKey = requireKey();
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('name', parsed.name);
      if (parsed.description) form.append('description', parsed.description);
      for (const raw of parsed.filePaths) {
        const sp = safePath(raw, 'read');
        if (!fs.existsSync(sp)) throw new Error(`File not found: ${sp}`);
        form.append('files', fs.createReadStream(sp));
      }
      const res = await fetchWithRetry(`${EL_BASE}/voices/add`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
        body: form as unknown as NodeJS.ReadableStream,
      });
      if (!res.ok) throw new Error(`ElevenLabs clone ${res.status}: ${await res.text()}`);
      return jsonResultTruncated(await res.json());
    },
  },
];
