import { z } from 'zod';
import { fetchWithRetry, jsonResultTruncated } from './_httpShared.js';

const LOCAL_ENDPOINT = 'http://172.25.240.1:11434';
const CLOUD_ENDPOINT = 'https://ollama.com/api';

const schema = z.object({
  model: z.string().default('qwen2.5:14b'),
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
    description: 'Delegate a chat/completion task to a local Ollama model (default: qwen2.5:14b on Windows host 172.25.240.1:11434) or Ollama Cloud. Use to offload token-heavy tasks (log summarization, CSV extraction, formatting) from Claude MAX to a free local model.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string', description: 'Ollama model name (default: qwen2.5:14b). Use ollamaListModels to see available models.' },
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
        endpoint: { type: 'string', enum: ['local', 'cloud'], description: 'local = 172.25.240.1:11434 (RTX 4070 Ti), cloud = ollama.com (default: local)' },
      },
      required: ['messages'],
    },
    handler: async (args: unknown) => {
      const parsed = schema.parse(args);

      const baseUrl = parsed.endpoint === 'cloud' ? CLOUD_ENDPOINT : LOCAL_ENDPOINT;

      const messages = parsed.system_prompt
        ? [{ role: 'system', content: parsed.system_prompt }, ...parsed.messages]
        : parsed.messages;

      const body = {
        model: parsed.model,
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
        model: parsed.model,
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
    description: 'List all models available on the local Ollama instance (172.25.240.1:11434). Shows model name, size, and modification date.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async (_args: unknown) => {
      const res = await fetchWithRetry(`${LOCAL_ENDPOINT}/api/tags`, {
        timeoutMs: 10_000,
        maxRetries: 1,
      });
      if (!res.ok) throw new Error(`Ollama list models ${res.status}: ${await res.text()}`);
      return jsonResultTruncated(await res.json());
    },
  },
];
