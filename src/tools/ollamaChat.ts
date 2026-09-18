import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import { fetchWithRetry, jsonResultTruncated } from './_httpShared.js';

const CLOUD_ENDPOINT = 'https://ollama.com/api';

// The Windows-host IP is NOT stable across reboots, so it must never be pinned.
// It used to be pinned to one NAT-gateway address; when WSL moved the host, every local
// call failed silently for weeks. Resolve at runtime,
// cache the first host that answers, and re-resolve if it later stops answering.
let cachedEndpoint: string | null = null;

function hostCandidates(): string[] {
  const out: string[] = [];
  const env = process.env.OLLAMA_HOST?.trim();
  if (env) out.push(env.startsWith('http') ? env : `http://${env}:11434`);
  try {
    // WSL default route points at the Windows host.
    const route = execFileSync('ip', ['route', 'show', 'default'], { encoding: 'utf8', timeout: 2000 });
    const via = route.split(/\s+/);
    const gw = via[via.indexOf('via') + 1];
    if (gw) out.push(`http://${gw}:11434`);
  } catch { /* not on WSL, or `ip` unavailable — fall through to localhost */ }
  out.push('http://localhost:11434');
  return [...new Set(out)];
}

async function resolveLocalEndpoint(): Promise<string> {
  if (cachedEndpoint) return cachedEndpoint;
  const tried: string[] = [];
  for (const base of hostCandidates()) {
    tried.push(base);
    try {
      const res = await fetchWithRetry(`${base}/api/tags`, { timeoutMs: 3000, maxRetries: 0 });
      if (res.ok) { cachedEndpoint = base; return base; }
    } catch { /* try next candidate */ }
  }
  throw new Error(
    `Ollama unreachable on the local host. Tried: ${tried.join(', ')}. ` +
    `The WSL host IP changes across reboots — set OLLAMA_HOST or check that Ollama is running on Windows.`,
  );
}

async function installedModels(base: string): Promise<string[]> {
  try {
    const res = await fetchWithRetry(`${base}/api/tags`, { timeoutMs: 5000, maxRetries: 0 });
    if (!res.ok) return [];
    const data = await res.json() as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map(m => m.name).filter((n): n is string => !!n);
  } catch { return []; }
}

// Embedding models cannot serve /api/chat, so they are never a valid chat default.
const EMBED_HINT = /embed/i;

const schema = z.object({
  model: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })).min(1),
  system_prompt: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().min(1).max(32768).default(2048),
  endpoint: z.enum(['local', 'cloud']).default('local'),
});

export const ollamaChatTools = [
  {
    name: 'ollamaChat',
    description: 'Delegate a chat/completion task to a local Ollama model or Ollama Cloud. The local host is resolved at runtime (OLLAMA_HOST, else the WSL default gateway) because the Windows-host IP changes across reboots; omit `model` to use the first installed chat model. Use to offload token-heavy tasks (log summarization, CSV extraction, formatting) from Claude MAX to a free local model.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string', description: 'Ollama model name. Omit to auto-pick the first installed chat model. Use ollamaListModels to see what is available.' },
        messages: {
          type: 'array',
          description: 'Chat messages array (role: system|user|assistant)',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['system', 'user', 'assistant'] },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
        },
        system_prompt: { type: 'string', description: 'Optional system prompt (prepended as system message)' },
        temperature: { type: 'number', description: 'Sampling temperature 0-2 (default 0.7)' },
        max_tokens: { type: 'number', description: 'Max tokens to generate (default 2048, max 32768)' },
        endpoint: { type: 'string', enum: ['local', 'cloud'], description: 'local = Ollama on the Windows host, address resolved at runtime (RTX 4070 Ti); cloud = ollama.com (default: local)' },
      },
      required: ['messages'],
    },
    handler: async (args: unknown) => {
      const parsed = schema.parse(args);

      const baseUrl = parsed.endpoint === 'cloud' ? CLOUD_ENDPOINT : await resolveLocalEndpoint();

      // No pinned default model: a hardcoded name rots the same way the pinned host
      // did (qwen2.5:14b was the default long after it stopped being installed).
      let model = parsed.model;
      if (!model) {
        if (parsed.endpoint === 'cloud') {
          throw new Error('model is required for endpoint=cloud — cloud models cannot be enumerated locally.');
        }
        const avail = await installedModels(baseUrl);
        const chat = avail.filter(m => !EMBED_HINT.test(m));
        if (!chat.length) {
          throw new Error(
            `No chat-capable model installed on ${baseUrl}` +
            (avail.length ? ` (found only: ${avail.join(', ')})` : '') +
            `. Pull one on the Windows host, e.g. \`ollama pull qwen2.5:14b\`.`,
          );
        }
        model = chat[0];
      }

      const messages = parsed.system_prompt
        ? [{ role: 'system', content: parsed.system_prompt }, ...parsed.messages]
        : parsed.messages;

      const body = {
        model,
        messages,
        options: {
          temperature: parsed.temperature,
          num_predict: parsed.max_tokens,
        },
        stream: false,
      };

      const res = await fetchWithRetry(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 120_000,
        maxRetries: 1,
      });

      if (!res.ok) {
        const text = await res.text();
        // A 404 here means the host answered but does not have this model. That is the
        // failure that silently killed 62 of 118 skill embeddings on 2026-08-18, so name
        // it explicitly instead of surfacing a bare status code.
        if (res.status === 404) {
          const avail = await installedModels(baseUrl);
          throw new Error(
            `Ollama model '${model}' is not installed on ${baseUrl}. ` +
            (avail.length ? `Installed: ${avail.join(', ')}. ` : 'No models are installed. ') +
            `Pull it on the Windows host: \`ollama pull ${model}\`.`,
          );
        }
        throw new Error(`Ollama chat ${res.status}: ${text}`);
      }

      const data = await res.json() as {
        message?: { role: string; content: string };
        done?: boolean;
        total_duration?: number;
        eval_count?: number;
        prompt_eval_count?: number;
      };

      return jsonResultTruncated({
        content: data.message?.content ?? '',
        model,
        endpoint: parsed.endpoint,
        token_usage: {
          prompt_tokens: data.prompt_eval_count ?? null,
          completion_tokens: data.eval_count ?? null,
          total_tokens: data.eval_count != null && data.prompt_eval_count != null
            ? data.eval_count + data.prompt_eval_count
            : null,
        },
        done: data.done ?? true,
        duration_ms: data.total_duration != null ? Math.round(data.total_duration / 1_000_000) : null,
      });
    },
  },
  {
    name: 'ollamaListModels',
    description: 'List all models available on the local Ollama instance (host resolved at runtime). Shows model name, size, and modification date.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async (_args: unknown) => {
      const base = await resolveLocalEndpoint();
      const res = await fetchWithRetry(`${base}/api/tags`, {
        timeoutMs: 10_000,
        maxRetries: 1,
      });
      if (!res.ok) throw new Error(`Ollama list models ${res.status}: ${await res.text()}`);
      return jsonResultTruncated(await res.json());
    },
  },
];
