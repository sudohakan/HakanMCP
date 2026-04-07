import { z } from 'zod';
import { config } from '../config.js';
import { decryptValue } from './encryption.js';
import {
  filterAvailableProviders,
  parseRetryAfter,
  setCooldown,
  getProviderAvailability,
  setProviderAvailability,
  recordApiUsage,
} from '../services/aiProviderCooldown.js';
import { conversationManager } from '../services/conversationHistory.js';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ProviderResponse = {
  text: string;
  model: string;
};

type ApiKeyResolution = {
  key?: string;
  diagnostics: string[];
};

const DEFAULT_CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-4o-mini';
const CODEX_BASE_URL = process.env.CODEX_BASE_URL || 'https://api.openai.com/v1/chat/completions';
const DEFAULT_CLAUDE_MODEL =
  process.env.CLAUDE_CODE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3.5-sonnet-20241022';
const CLAUDE_BASE_URL = process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com/v1/messages';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_PASSWORD_ENV = 'AI_KEY_PASSWORD';

export function resolveProviderApiKey(
  providerLabel: string,
  envVars: string[],
  encryptedValue?: string,
): ApiKeyResolution {
  const diagnostics: string[] = [];

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) {
      return { key: value, diagnostics };
    }
  }

  if (encryptedValue) {
    const passwordEnv = config.aiProviders?.encryptionPasswordEnv || DEFAULT_PASSWORD_ENV;
    const password = process.env[passwordEnv];

    if (!password) {
      diagnostics.push(
        `The key ${providerLabel} is encrypted (config.yaml) but the env variable ${passwordEnv} is not defined.`,
      );
    } else {
      try {
        const decrypted = decryptValue(encryptedValue, password);
        diagnostics.push(`The ${providerLabel} key was parsed from config.yaml (${passwordEnv}).`);
        return { key: decrypted, diagnostics };
      } catch (error: unknown) {
        diagnostics.push(
          `Could not resolve key ${providerLabel}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  diagnostics.push(`API key ${providerLabel} not found (env variables: ${envVars.join(', ')}).`);

  return { diagnostics };
}

function validateApiKey(apiKey: string | undefined, provider: string): string {
  if (!apiKey) {
    throw new Error(`${provider} API key is not defined`);
  }
  return apiKey;
}

function extractClaudeMessages(messages: ChatMessage[]): {
  system?: string;
  chat: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const systemMessage = messages.find((msg) => msg.role === 'system');
  const chatMessages = messages
    .filter((msg) => msg.role !== 'system')
    .map((msg) => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));

  return {
    system: systemMessage?.content,
    chat: chatMessages,
  };
}

export async function callCodexModel(
  messages: ChatMessage[],
  model?: string,
  apiKeyOverride?: string,
): Promise<ProviderResponse> {
  const apiKey = validateApiKey(
    apiKeyOverride || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY,
    'Codex',
  );

  const response = await fetch(CODEX_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_CODEX_MODEL,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
      const sec = parseRetryAfter(response.headers.get('retry-after'));
      let durationMs = sec ? sec * 1000 : undefined;
      if (response.status >= 500 && !durationMs) durationMs = 30_000;
      setCooldown('codex', durationMs, errorText.slice(0, 200));
    }
    throw new Error(`Codex API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2);

  return { text, model: model || DEFAULT_CODEX_MODEL };
}

export async function callClaudeCodeModel(
  messages: ChatMessage[],
  model?: string,
  apiKeyOverride?: string,
): Promise<ProviderResponse> {
  const apiKey = validateApiKey(
    apiKeyOverride || process.env.CLAUDE_CODE_API_KEY || process.env.ANTHROPIC_API_KEY,
    'Claude Code',
  );
  const { system, chat } = extractClaudeMessages(messages);

  const response = await fetch(CLAUDE_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_CLAUDE_MODEL,
      system,
      messages: chat,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
      const sec = parseRetryAfter(response.headers.get('retry-after'));
      let durationMs = sec ? sec * 1000 : undefined;
      try {
        const errJson = JSON.parse(errorText);
        const errType = errJson?.error?.type;
        if (errType === 'rate_limit_error' || errType === 'overloaded_error') {
          durationMs = durationMs ?? 60_000;
        }
      } catch {
        /* ignore */
      }
      if (response.status >= 500 && !durationMs) durationMs = 30_000;
      setCooldown('claude', durationMs, errorText.slice(0, 200));
    }
    throw new Error(`Claude Code API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const contentBlocks = Array.isArray(data.content)
    ? data.content.map((c: { text?: string }) => c?.text || '').filter(Boolean)
    : [];
  const text = contentBlocks.join('\n') || JSON.stringify(data, null, 2);

  return { text, model: model || DEFAULT_CLAUDE_MODEL };
}

export async function callGeminiModel(
  messages: ChatMessage[],
  model?: string,
  apiKeyOverride?: string,
): Promise<ProviderResponse> {
  const apiKey = validateApiKey(apiKeyOverride || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, 'Gemini');
  const targetModel = model || DEFAULT_GEMINI_MODEL;
  const prompt = messages.map((msg) => `[${msg.role.toUpperCase()}]\n${msg.content}`).join('\n\n');

  const response = await fetch(
    `${GEMINI_BASE_URL}/${targetModel}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
      const sec = parseRetryAfter(response.headers.get('retry-after'));
      let durationMs = sec ? sec * 1000 : undefined;
      if (response.status >= 500 && !durationMs) durationMs = 30_000;
      setCooldown('gemini', durationMs, errorText.slice(0, 200));
    }
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const textParts =
    data.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part?.text || '')
      .filter(Boolean) || [];
  const text = textParts.join('\n').trim();
  if (text) return { text, model: targetModel };
  const finishReason = data.candidates?.[0]?.finishReason;
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION')
    return {
      text: 'Gemini blocked the response (safety or recitation filter).',
      model: targetModel,
    };
  return { text: 'No response from Gemini (empty or blocked).', model: targetModel };
}

export async function callLocalOllama(
  messages: ChatMessage[],
  model?: string,
): Promise<ProviderResponse> {
  const targetModel = model || config.ollamaModel;
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: targetModel,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama fallback error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data.message?.content || data.response?.response || JSON.stringify(data, null, 2);

  return { text, model: targetModel };
}

export async function routeProviderWithFallback(
  messages: ChatMessage[],
  model: string | undefined,
  priority: Array<'codex' | 'claude' | 'gemini'>,
  allowLocalFallback = false,
): Promise<{ text: string; provider: string; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  const codexKey = resolveProviderApiKey(
    'Codex',
    ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    config.aiProviders?.codexKeyEncrypted,
  );
  const claudeKey = resolveProviderApiKey(
    'Claude Code',
    ['CLAUDE_CODE_API_KEY', 'ANTHROPIC_API_KEY'],
    config.aiProviders?.claudeKeyEncrypted,
  );
  const geminiKey = resolveProviderApiKey(
    'Gemini',
    ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    config.aiProviders?.geminiKeyEncrypted,
  );

  const available = filterAvailableProviders(priority);
  for (const provider of available) {
    if (provider === 'codex') {
      diagnostics.push(...codexKey.diagnostics);
      const codexAvail = getProviderAvailability('codex_api');
      if (codexAvail.status === 'unavailable') {
        diagnostics.push(`Codex API skipped (${codexAvail.reason || 'unavailable'})`);
      } else if (codexKey.key) {
        try {
          const result = await callCodexModel(messages, model, codexKey.key);
          setProviderAvailability('codex_api', 'available', 'API responded');
          const out = { text: result.text, provider: `Codex (${result.model})`, diagnostics };
          (await import('../services/aiRouteLogger.js')).appendRoute(out.provider, false);
          recordApiUsage('codex');
          return out;
        } catch (error: unknown) {
          const errMsg = (error as Error)?.message ?? String(error);
          if (/401|403|forbidden|unauthorized|invalid.*key/i.test(errMsg)) {
            setProviderAvailability('codex_api', 'unavailable', `auth error: ${errMsg.slice(0, 80)}`);
          }
          diagnostics.push(`Codex error: ${errMsg}`);
        }
      }
    }

    if (provider === 'claude') {
      diagnostics.push(...claudeKey.diagnostics);
      const claudeAvail = getProviderAvailability('claude_api');
      if (claudeAvail.status === 'unavailable') {
        diagnostics.push(`Claude API skipped (${claudeAvail.reason || 'unavailable'})`);
      } else if (claudeKey.key) {
        try {
          const result = await callClaudeCodeModel(messages, model, claudeKey.key);
          setProviderAvailability('claude_api', 'available', 'API responded');
          const out = { text: result.text, provider: `Claude Code (${result.model})`, diagnostics };
          (await import('../services/aiRouteLogger.js')).appendRoute(out.provider, false);
          recordApiUsage('claude');
          return out;
        } catch (error: unknown) {
          const errMsg = (error as Error)?.message ?? String(error);
          if (/401|403|forbidden|unauthorized|invalid.*key/i.test(errMsg)) {
            setProviderAvailability('claude_api', 'unavailable', `auth error: ${errMsg.slice(0, 80)}`);
          }
          diagnostics.push(`Claude Code error: ${errMsg}`);
        }
      }
    }

    if (provider === 'gemini') {
      diagnostics.push(...geminiKey.diagnostics);
      const geminiAvail = getProviderAvailability('gemini_api');
      if (geminiAvail.status === 'unavailable') {
        diagnostics.push(`Gemini API skipped (${geminiAvail.reason || 'unavailable'})`);
      } else if (geminiKey.key) {
        try {
          const result = await callGeminiModel(messages, model, geminiKey.key);
          setProviderAvailability('gemini_api', 'available', 'API responded');
          const out = { text: result.text, provider: `Gemini (${result.model})`, diagnostics };
          (await import('../services/aiRouteLogger.js')).appendRoute(out.provider, false);
          recordApiUsage('gemini');
          return out;
        } catch (error: unknown) {
          const errMsg = (error as Error)?.message ?? String(error);
          if (/401|403|forbidden|unauthorized|invalid.*key/i.test(errMsg)) {
            setProviderAvailability('gemini_api', 'unavailable', `auth error: ${errMsg.slice(0, 80)}`);
          }
          diagnostics.push(`Gemini error: ${errMsg}`);
        }
      }
    }
  }

  if (!allowLocalFallback) {
    throw new Error(
      'All providers have failed and the local model fallback is closed. Configure Codex/Claude/Gemini API keys.',
    );
  }

  if (!(config.aiProviders?.localModels) || process.env.DISABLE_LOCAL_MODELS === '1') {
    throw new Error(
      'Local models disabled (aiProviders.localModels=false or DISABLE_LOCAL_MODELS=1). Configure Codex/Claude/Gemini API keys.',
    );
  }

  const localResult = await callLocalOllama(messages, model);
  diagnostics.push(
    'No Codex/Claude/Gemini key or downgraded to Ollama due to quota error (last choice).',
  );

  const result = {
    text: localResult.text,
    provider: `Ollama (${localResult.model})`,
    diagnostics,
  };
  const { appendRoute } = await import('../services/aiRouteLogger.js');
  appendRoute(result.provider, true);
  return result;
}

export const aiProviderTools = [
  {
    name: 'ai_provider_chat',
    description:
      'Unified AI provider chat. Routes to the specified provider (codex/claude/gemini) with automatic fallback. Each provider prioritizes itself first, then falls back to the others.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['codex', 'claude', 'gemini'],
          description: 'Which AI provider to prioritize (codex=OpenAI, claude=Anthropic, gemini=Google). Default: codex.',
        },
        model: { type: 'string', description: 'Model override for the selected provider' },
        allowLocalFallback: {
          type: 'boolean',
          description:
            'Turn on Local/Ollama fallback? If false, only Codex/Claude/Gemini API is used.',
        },
        message: {
          type: 'string',
          description: 'Single message to send (uses conversation history).',
        },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['system', 'user', 'assistant'] },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
        },
      },
      required: [],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          provider: z.enum(['codex', 'claude', 'gemini']).optional().default('codex'),
          model: z.string().optional(),
          allowLocalFallback: z.boolean().optional().default(false),
          message: z.string().optional(),
          messages: z
            .array(
              z.object({
                role: z.enum(['system', 'user', 'assistant']),
                content: z.string(),
              }),
            )
            .optional(),
        })
        .parse(args);

      const { provider, model, message, allowLocalFallback } = parsed;
      let chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

      if (message) {
        conversationManager.addMessage({ role: 'user', content: message });
        chatMessages = conversationManager.getChatMessages();
      } else if (parsed.messages && parsed.messages.length > 0) {
        chatMessages = parsed.messages;
      } else {
        return {
          content: [{ type: 'text', text: 'Please provide either "message" or "messages".' }],
          isError: true,
        };
      }

      const priorityMap: Record<string, Array<'codex' | 'claude' | 'gemini'>> = {
        codex: ['codex', 'claude', 'gemini'],
        claude: ['claude', 'codex', 'gemini'],
        gemini: ['gemini', 'codex', 'claude'],
      };

      const result = await routeProviderWithFallback(
        chatMessages,
        model,
        priorityMap[provider],
        allowLocalFallback,
      );

      if (message) {
        conversationManager.addMessage({
          role: 'assistant',
          content: result.text,
          provider: result.provider,
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: `**Selected Model:** ${result.provider}\n\n${result.text}`,
          },
        ],
      };
    },
  },
];
