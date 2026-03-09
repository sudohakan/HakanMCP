import { jest } from '@jest/globals';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const createFetchResponse = (options: { ok: boolean; status?: number; body?: unknown }) => ({
  ok: options.ok,
  status: options.status ?? (options.ok ? 200 : 500),
  statusText: options.ok ? 'OK' : 'ERR',
  json: jest.fn(async () => options.body),
  text: jest.fn(async () =>
    typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  ),
});

const setupAiProviders = async (overrides?: { decrypt?: string }) => {
  jest.resetModules();

  const fetchMock = jest.fn();
  (global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

  await jest.unstable_mockModule('../src/config', () => ({
    config: {
      aiProviders: {
        codexKeyEncrypted: overrides?.decrypt ? 'encrypted' : undefined,
        claudeKeyEncrypted: overrides?.decrypt ? 'encrypted-c' : undefined,
        geminiKeyEncrypted: overrides?.decrypt ? 'encrypted-g' : undefined,
        encryptionPasswordEnv: 'AI_PASSWORD_ENV',
      },
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3',
    },
  }));

  const decryptValue = jest.fn().mockReturnValue('decrypted-key');
  await jest.unstable_mockModule('../src/tools/encryption', () => ({
    decryptValue,
  }));

  const module = await import('../src/tools/aiProviders');
  return {
    ...module,
    fetchMock,
    decryptValue,
  };
};

describe('aiProviders', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test teardown, fetch may not exist
    delete (global as any).fetch;
    delete process.env.CODEX_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CLAUDE_CODE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_PASSWORD_ENV;
  });

  it('resolves API keys from env and encrypted values', async () => {
    process.env.CODEX_API_KEY = 'env-key';
    const { resolveProviderApiKey, decryptValue } = await setupAiProviders({ decrypt: 'value' });

    const direct = resolveProviderApiKey('Codex', ['CODEX_API_KEY', 'OPENAI_API_KEY']);
    expect(direct.key).toBe('env-key');

    delete process.env.CODEX_API_KEY;
    process.env.AI_PASSWORD_ENV = 'secret';
    const encrypted = resolveProviderApiKey('Codex', ['MISSING'], 'encrypted-value');
    expect(decryptValue).toHaveBeenCalledWith('encrypted-value', 'secret');
    expect(encrypted.key).toBe('decrypted-key');
  });

  it('calls Codex model directly', async () => {
    const { callCodexModel, fetchMock } = await setupAiProviders();
    process.env.CODEX_API_KEY = 'codex-key';

    fetchMock.mockImplementation(
      async () =>
        createFetchResponse({
          ok: true,
          body: { choices: [{ message: { content: 'codex reply' } }] },
        }) as unknown as Response,
    );

    const result = await callCodexModel([{ role: 'user', content: 'Hello' }]);
    expect(result.text).toBe('codex reply');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('openai.com'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('routes providers with fallback to Ollama when remote providers fail', async () => {
    const { fetchMock } = await setupAiProviders();
    process.env.CODEX_API_KEY = 'codex-key';
    process.env.CLAUDE_CODE_API_KEY = 'claude-key';

    // codex_chat uses priority ['claude','codex','gemini'] → Claude first, then Codex, then Ollama fallback. Use URL-based mocking for robustness.
    fetchMock.mockImplementation(async (input: unknown) => {
      const u =
        typeof input === 'string'
          ? input
          : typeof input === 'object' && input !== null && 'url' in input
            ? String((input as { url: string }).url)
            : '';
      if (u.includes('11434')) {
        return createFetchResponse({
          ok: true,
          body: { message: { content: 'local response' } },
        }) as unknown as Response;
      }
      if (u.includes('anthropic.com')) {
        return createFetchResponse({ ok: false, body: 'claude error' }) as unknown as Response;
      }
      if (u.includes('openai.com')) {
        return createFetchResponse({ ok: false, body: 'codex error' }) as unknown as Response;
      }
      return createFetchResponse({ ok: false, body: 'unknown' }) as unknown as Response;
    });

    const module = await import('../src/tools/aiProviders');
    const tool = module.aiProviderTools.find((t: { name: string }) => t.name === 'codex_chat');
    const response = await tool!.handler({
      messages: [{ role: 'user', content: 'Hello' }],
      allowLocalFallback: true,
    });

    expect(response.content[0].text).toContain('Ollama');
    expect(response.content[0].text).toContain('local response');
  });

  it('handles gemini_chat with Gemini API key', async () => {
    const { fetchMock } = await setupAiProviders();
    // Isolate cooldown state so real cooldowns don't filter out Gemini
    const tempDir = path.join(os.tmpdir(), `ai-providers-gemini-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const cooldown = await import('../src/services/aiProviderCooldown.js');
    cooldown.setCooldownsBasePath(tempDir);
    process.env.GEMINI_API_KEY = 'gemini-key';

    fetchMock.mockImplementation(
      async () =>
        createFetchResponse({
          ok: true,
          body: {
            candidates: [{ content: { parts: [{ text: 'gemini reply' }] } }],
          },
        }) as unknown as Response,
    );

    const module = await import('../src/tools/aiProviders');
    const tool = module.aiProviderTools.find((t: { name: string }) => t.name === 'gemini_chat');
    const response = await tool!.handler({ messages: [{ role: 'user', content: 'Hello' }] });

    expect(response.content[0].text).toContain('Gemini');
    expect(response.content[0].text).toContain('gemini reply');
  });
});
