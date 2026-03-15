/**
 * Ollama kill-switch: when localModels=false or allowLocalFallback=false,
 * no HTTP request must reach Ollama endpoint (plan.md §12 C).
 */
import { jest } from '@jest/globals';

const createFetchResponse = (options: { ok: boolean; body?: unknown }) => ({
  ok: options.ok,
  status: options.ok ? 200 : 500,
  statusText: options.ok ? 'OK' : 'ERR',
  json: jest.fn(async () => options.body),
  text: jest.fn(async () =>
    typeof options.body === 'string' ? options.body : JSON.stringify(options.body ?? {}),
  ),
});

describe('aiProviders no Ollama', () => {
  let fetchMock: jest.Mock;
  let routeProviderWithFallback: (
    messages: unknown[],
    model: unknown,
    priority: unknown[],
    allowLocalFallback: boolean,
  ) => Promise<unknown>;

  beforeEach(async () => {
    jest.resetModules();
    fetchMock = jest.fn();
    (global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

    await jest.unstable_mockModule('../src/config', () => ({
      config: {
        aiProviders: {
          localModels: false,
          codexKeyEncrypted: undefined,
          claudeKeyEncrypted: undefined,
          geminiKeyEncrypted: undefined,
        },
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'llama3',
      },
    }));

    const mod = await import('../src/tools/aiProviders');
    routeProviderWithFallback = mod.routeProviderWithFallback;
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test teardown
    delete (global as any).fetch;
    delete process.env.CODEX_API_KEY;
    delete process.env.CLAUDE_CODE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DISABLE_LOCAL_MODELS;
  });

  it('localModels=false: no Ollama request when allowLocalFallback=true', async () => {
    fetchMock.mockImplementation(
      async () =>
        createFetchResponse({
          ok: false,
          body: { error: 'quota exceeded' },
        }) as unknown as Response,
    );

    await expect(
      routeProviderWithFallback(
        [{ role: 'user', content: 'hi' }],
        undefined,
        ['codex', 'claude', 'gemini'],
        true,
      ),
    ).rejects.toThrow(/Local models disabled|Configure Codex\/Claude\/Gemini/);

    const ollamaCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
      const url = typeof call[0] === 'string' ? call[0] : '';
      return url.includes('11434') || url.includes('ollama');
    });
    expect(ollamaCalls).toHaveLength(0);
  });
});

describe('aiProviders no Ollama (DISABLE_LOCAL_MODELS)', () => {
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    fetchMock = jest.fn();
    (global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;
    process.env.DISABLE_LOCAL_MODELS = '1';

    await jest.unstable_mockModule('../src/config', () => ({
      config: {
        aiProviders: {
          localModels: true,
          codexKeyEncrypted: undefined,
          claudeKeyEncrypted: undefined,
          geminiKeyEncrypted: undefined,
        },
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'llama3',
      },
    }));
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test teardown
    delete (global as any).fetch;
    delete process.env.DISABLE_LOCAL_MODELS;
  });

  it('DISABLE_LOCAL_MODELS=1: no Ollama request even with allowLocalFallback=true', async () => {
    const mod = await import('../src/tools/aiProviders');
    fetchMock.mockImplementation(
      async () =>
        createFetchResponse({
          ok: false,
          body: {},
        }) as unknown as Response,
    );

    await expect(
      mod.routeProviderWithFallback(
        [{ role: 'user', content: 'hi' }],
        undefined,
        ['codex', 'claude', 'gemini'],
        true,
      ),
    ).rejects.toThrow(/Local models disabled|Configure Codex\/Claude\/Gemini/);

    const ollamaCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
      const url = typeof call[0] === 'string' ? call[0] : '';
      return url.includes('11434') || url.includes('ollama');
    });
    expect(ollamaCalls).toHaveLength(0);
  });
});
