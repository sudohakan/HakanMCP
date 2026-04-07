import type {
  ClaudeToolDefinition,
  ClaudeMessage,
  ClaudeApiResponse,
  ClaudeContentBlock,
  ClaudeToolUseBlock,
  ClaudeToolResultBlock,
} from '../types/index.js';
import type { AgenticCallFn } from './agenticLoop.js';
import { parseRetryAfter, setCooldown } from './aiProviderCooldown.js';

const CLAUDE_BASE_URL = process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com/v1/messages';

export function createClaudeCallFn(model: string, apiKey: string): AgenticCallFn {
  return async (system, messages, tools) => {
    const body: Record<string, unknown> = { model, messages, max_tokens: 8192 };
    if (system) body.system = system;
    if (tools.length > 0) body.tools = tools;

    const response = await fetch(CLAUDE_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
        const sec = parseRetryAfter(response.headers.get('retry-after'));
        let durationMs = sec ? sec * 1000 : undefined;
        try {
          const errJson = JSON.parse(errorText);
          if (errJson?.error?.type === 'rate_limit_error' || errJson?.error?.type === 'overloaded_error') {
            durationMs = durationMs ?? 60_000;
          }
        } catch { /* empty */ }
        if (response.status >= 500 && !durationMs) durationMs = 30_000;
        setCooldown('claude', durationMs, errorText.slice(0, 200));
      }
      throw new Error(`Claude API error: ${response.status} ${errorText}`);
    }

    return (await response.json()) as ClaudeApiResponse;
  };
}

const OPENAI_BASE_URL = process.env.CODEX_BASE_URL || 'https://api.openai.com/v1/chat/completions';

function toOpenAIMessages(
  system: string | undefined,
  messages: ClaudeMessage[],
): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }

    const blocks = msg.content as ClaudeContentBlock[];
    const textParts = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
    const toolUses = blocks.filter((b) => b.type === 'tool_use') as ClaudeToolUseBlock[];
    const toolResults = blocks.filter((b) => b.type === 'tool_result') as ClaudeToolResultBlock[];

    if (msg.role === 'assistant' && toolUses.length > 0) {
      out.push({
        role: 'assistant',
        content: textParts || null,
        tool_calls: toolUses.map((tu) => ({
          id: tu.id,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input) },
        })),
      });
    } else if (msg.role === 'user' && toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content });
      }
    } else {
      out.push({ role: msg.role, content: textParts });
    }
  }
  return out;
}

function toOpenAITools(tools: ClaudeToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

export function createOpenAICallFn(model: string, apiKey: string): AgenticCallFn {
  return async (system, messages, tools) => {
    const body: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(system, messages),
    };
    if (tools.length > 0) body.tools = toOpenAITools(tools);

    const response = await fetch(OPENAI_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429 || response.status >= 500) {
        const sec = parseRetryAfter(response.headers.get('retry-after'));
        setCooldown('codex', sec ? sec * 1000 : 30_000, errorText.slice(0, 200));
      }
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      id?: string;
      model?: string;
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = data.choices?.[0];
    const msg = choice?.message;
    const content: ClaudeContentBlock[] = [];

    if (msg?.content) content.push({ type: 'text', text: msg.content });
    if (msg?.tool_calls) {
      for (const tc of msg.tool_calls) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments || '{}'); } catch { /* empty */ }
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
    }

    const fr = choice?.finish_reason;
    const stop_reason = fr === 'tool_calls' ? 'tool_use' : fr === 'length' ? 'max_tokens' : 'end_turn';

    return {
      id: data.id || '',
      type: 'message',
      role: 'assistant',
      content,
      model: data.model || model,
      stop_reason: stop_reason as ClaudeApiResponse['stop_reason'],
      usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
    };
  };
}

const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models';

function toGeminiContents(messages: ClaudeMessage[]): unknown[] {
  const out: unknown[] = [];

  for (const msg of messages) {
    const geminiRole = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      out.push({ role: geminiRole, parts: [{ text: msg.content }] });
      continue;
    }

    const blocks = msg.content as ClaudeContentBlock[];
    const parts: unknown[] = [];

    for (const b of blocks) {
      if (b.type === 'text') {
        parts.push({ text: (b as { text: string }).text });
      } else if (b.type === 'tool_use') {
        const tu = b as ClaudeToolUseBlock;
        parts.push({ functionCall: { name: tu.name, args: tu.input } });
      } else if (b.type === 'tool_result') {
        const tr = b as ClaudeToolResultBlock;
        const toolName = findToolNameForId(messages, tr.tool_use_id);
        parts.push({
          functionResponse: {
            name: toolName || 'unknown',
            response: { content: tr.content },
          },
        });
      }
    }

    if (parts.length > 0) out.push({ role: geminiRole, parts });
  }

  return out;
}

function findToolNameForId(messages: ClaudeMessage[], toolUseId: string): string | undefined {
  for (const msg of messages) {
    if (typeof msg.content !== 'string') {
      for (const b of msg.content as ClaudeContentBlock[]) {
        if (b.type === 'tool_use' && (b as ClaudeToolUseBlock).id === toolUseId) {
          return (b as ClaudeToolUseBlock).name;
        }
      }
    }
  }
  return undefined;
}

function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties' || k === 'default') continue;
    out[k] = v;
  }

  if (out.type === 'array' && !out.items) {
    out.items = { type: 'string' };
  }

  if (out.items && typeof out.items === 'object') {
    out.items = sanitizeSchemaForGemini(out.items);
  }

  if (out.properties && typeof out.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [pk, pv] of Object.entries(out.properties as Record<string, unknown>)) {
      props[pk] = sanitizeSchemaForGemini(pv);
    }
    out.properties = props;
  }

  return out;
}

function toGeminiTools(tools: ClaudeToolDefinition[]): unknown[] {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeSchemaForGemini(t.input_schema),
    })),
  }];
}

let geminiCallCounter = 0;

export function createGeminiCallFn(model: string, apiKey: string): AgenticCallFn {
  return async (system, messages, tools) => {
    const body: Record<string, unknown> = {
      contents: toGeminiContents(messages),
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools.length > 0) body.tools = toGeminiTools(tools);

    const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429 || response.status >= 500) {
        const sec = parseRetryAfter(response.headers.get('retry-after'));
        let durationMs = sec ? sec * 1000 : undefined;
        if (response.status >= 500 && !durationMs) durationMs = 30_000;
        if (response.status === 429 && !durationMs) durationMs = 60_000;
        setCooldown('gemini', durationMs, errorText.slice(0, 200));
      }
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const content: ClaudeContentBlock[] = [];
    let hasToolCalls = false;

    for (const part of parts) {
      if (part.text) {
        content.push({ type: 'text', text: part.text });
      }
      if (part.functionCall) {
        hasToolCalls = true;
        content.push({
          type: 'tool_use',
          id: `gemini-${++geminiCallCounter}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        });
      }
    }

    return {
      id: '',
      type: 'message',
      role: 'assistant',
      content,
      model,
      stop_reason: hasToolCalls ? 'tool_use' : 'end_turn',
      usage: {
        input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  };
}
