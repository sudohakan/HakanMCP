import { jest } from '@jest/globals';

// Mock child_process
const execMockImpl = (
  cmd: unknown,
  options: unknown,
  callback?: (err: unknown, stdout: string, stderr: string) => void,
) => {
  let cb = callback;
  if (typeof options === 'function') {
    cb = options as (err: unknown, stdout: string, stderr: string) => void;
  }
  const cmdStr = typeof cmd === 'string' ? cmd : '';
  const tagsResponse = { models: [{ name: 'llama2' }, { name: 'codellama' }] };
  const generateResponse = {
    response: 'Mocked AI response',
    message: { role: 'assistant', content: 'Mocked AI response' },
  };
  const body = cmdStr.includes('/api/tags')
    ? JSON.stringify(tagsResponse)
    : JSON.stringify(generateResponse);
  if (cb) cb(null, body, '');
  return { stdout: null, stderr: null, kill: () => {} };
};

jest.unstable_mockModule('child_process', async () => {
  const original = await jest.requireActual<typeof import('child_process')>('child_process');
  const mockExec = jest.fn(execMockImpl);
  // Attach custom promisify so util.promisify(exec) returns {stdout, stderr}
  const customPromisify = (...args: unknown[]) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExec(...args, (err: unknown, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  (mockExec as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] =
    customPromisify;
  return {
    ...original,
    exec: mockExec,
  };
});

// Mock fs
jest.unstable_mockModule('node:fs', async () => {
  const original = await jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...original,
    default: {
      ...original,
      writeFileSync: jest.fn(),
      unlinkSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(true),
      readFileSync: jest
        .fn()
        .mockReturnValue(
          'ollamaUrl: "http://localhost:11434"\navailableModels:\n  - llama2\n  - codellama\nollamaModel: llama2',
        ),
    },
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest
      .fn()
      .mockReturnValue(
        'ollamaUrl: "http://localhost:11434"\navailableModels:\n  - llama2\n  - codellama\nollamaModel: llama2',
      ),
  };
});

// Import tools and config setter
console.log('DEBUG: Importing ../src/tools/aiTools');
const mod = await import('../src/tools/aiTools');
const { config } = await import('../src/config');
console.log('DEBUG: Exports:', Object.keys(mod));
const { aiTools, setOllamaConfig } = mod;

describe('AI Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set test config
    setOllamaConfig({
      ollamaUrl: config.ollamaUrl,
      ollamaModel: 'llama2',
      availableModels: ['llama2', 'codellama'],
      serverName: 'test-server',
      gitbookUrl: '',
      cacheTtl: 3600,
      postmanDir: '',
      logLevel: 'info',
      ollamaTimeout: 1000, // Short timeout for tests
      retryCount: 0, // Disable retries for faster tests and immediate fallback
    });
  });

  describe('Tool Definitions', () => {
    it('should export all expected tools', () => {
      const expectedTools = [
        'ai_listModels',
        'ai_generate',
        'ai_chat',
        'ai_history',
        'ai_clear_history',
      ];

      const actualTools = aiTools.map((t: { name: string }) => t.name);
      for (const toolName of expectedTools) {
        expect(actualTools).toContain(toolName);
      }
    });

    it('all tools should have valid schemas', () => {
      for (const tool of aiTools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('ai_generate should have prompt parameter', () => {
      const tool = aiTools.find((t: { name: string }) => t.name === 'ai_generate');
      expect(tool?.inputSchema.properties).toHaveProperty('prompt');
      expect(tool?.inputSchema.properties).toHaveProperty('model');
    });

    it('ai_chat should have messages parameter', () => {
      const tool = aiTools.find((t: { name: string }) => t.name === 'ai_chat');
      expect(tool?.inputSchema.properties).toHaveProperty('messages');
      expect(tool?.inputSchema.properties).toHaveProperty('model');
    });
  });

  describe('ai_listModels', () => {
    it('should list available models', async () => {
      const tool = aiTools.find((t: { name: string }) => t.name === 'ai_listModels');
      expect(tool).toBeDefined();

      const result = await tool!.handler({});

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
    });
  });

  describe('ai_generate', () => {
    it('should generate text from prompt', async () => {
      const tool = aiTools.find((t: { name: string }) => t.name === 'ai_generate');

      const result = await tool!.handler({
        prompt: 'Say hello in one word',
        model: 'llama2',
      });

      expect(result.content[0].text).toBeDefined();
      expect(result.content[0].text.length).toBeGreaterThan(0);
    });
  });

  describe('ai_chat', () => {
    it('should handle chat messages', async () => {
      const tool = aiTools.find((t: { name: string }) => t.name === 'ai_chat');

      const result = await tool!.handler({
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        model: 'llama2',
      });

      expect(result.content[0].text).toBeDefined();
      expect(result.content[0].text).toContain('Mocked AI response');
    });
  });

  describe('ai_chat - model fallback', () => {
    it('should fallback to alternative models on failure', async () => {
      const tool = aiTools.find((t: { name: string }) => t.name === 'ai_chat');

      // Mock failure for first call, success for second
      const cp = await import('child_process');
      const execMock = cp.exec as unknown as jest.Mock;

      let callCount = 0;
      const execImpl = (
        _cmd: unknown,
        optsOrCb: unknown,
        maybeCb?: (err: unknown, stdout: string, stderr: string) => void,
      ) => {
        callCount += 1;
        const failFirst = callCount === 1;
        const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        if (cb) {
          if (failFirst) cb(new Error('Model not found'), '', 'Error');
          else {
            cb(
              null,
              JSON.stringify({ message: { role: 'assistant', content: 'Fallback success' } }),
              '',
            );
          }
        }
      };
      execMock.mockImplementation(execImpl as never);

      let result;
      try {
        console.log('DEBUG: Calling handler with non-existent-model');
        result = await tool!.handler({
          messages: [{ role: 'user', content: 'Hello' }],
          model: 'non-existent-model',
        });
        console.log('DEBUG: Handler returned result:', JSON.stringify(result));
      } catch (e) {
        console.log('DEBUG: Test failed with error:', e);
        throw e;
      }

      expect(result.content[0].text).toBeDefined();
      expect(result.content[0].text).toContain('Fallback success');
    });
  });
});
