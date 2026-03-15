import { jest } from '@jest/globals';
import path from 'node:path';
import yaml from 'js-yaml';

type SetupOptions = {
  fileConfig?: Record<string, unknown>;
};

const CONFIG_PATH = path.join(process.cwd(), 'config.yaml');

const setupConfigModule = async (options: SetupOptions = {}) => {
  jest.resetModules();

  const files = new Map<string, string>();
  if (options.fileConfig) {
    files.set(CONFIG_PATH, yaml.dump(options.fileConfig));
  }

  const fsMock = {
    existsSync: jest.fn((targetPath: string) => files.has(targetPath)),
    readFileSync: jest.fn((targetPath: string) => {
      if (!files.has(targetPath)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return files.get(targetPath);
    }),
    writeFileSync: jest.fn((targetPath: string, content: string) => {
      files.set(targetPath, content);
    }),
    copyFileSync: jest.fn((src: string, dest: string) => {
      files.set(dest, files.get(src) ?? '');
    }),
    renameSync: jest.fn((oldPath: string, newPath: string) => {
      const content = files.get(oldPath) ?? '';
      files.set(newPath, content);
      files.delete(oldPath);
    }),
  };

  await jest.unstable_mockModule('node:fs', () => ({
    default: fsMock,
    ...fsMock,
  }));

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setLevel: jest.fn(),
  };

  await jest.unstable_mockModule('../src/utils/logger.js', () => ({
    logger,
    LogLevel: {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      NONE: 4,
    },
  }));

  const mod = await import('../src/config');

  return {
    module: mod,
    mocks: {
      fs: fsMock,
      logger,
    },
    files,
  };
};

describe('config module', () => {
  it('loads defaults when config file is missing', async () => {
    const { module, mocks } = await setupConfigModule();
    const { config } = module;

    expect(config.serverName).toBe('hakan-mcp');
    expect(config.postmanDir).toBe('postman');
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('No config.yaml'));
  });

  it('merges file overrides into runtime config', async () => {
    const override = {
      serverName: 'custom-server',
      logLevel: 'debug',
      gitbookUrl: 'https://docs.example.com',
      postmanDir: 'custom-postman',
      ollamaUrl: 'https://ollama.example.com',
      availableModels: ['llama3'],
      backup: {
        enabled: false,
        localPath: './alt-backups',
        retentionHours: 12,
        compressionEnabled: false,
        includeNodeModules: true,
        intervalHours: 2,
      },
    };

    const { module, mocks } = await setupConfigModule({ fileConfig: override });
    const { config } = module;

    expect(config.serverName).toBe('custom-server');
    expect(config.ollamaUrl).toBe('https://ollama.example.com');
    expect(config.backup?.localPath).toBe('./alt-backups');
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('Loaded config'));
  });

  it('updateConfig persists merged changes and updates runtime config', async () => {
    const base = {
      serverName: 'initial',
      gitbookUrl: 'https://docs.example.com',
      postmanDir: 'postman',
      cacheTtl: 200,
      logLevel: 'info',
      ollamaUrl: 'https://ollama.example.com',
      ollamaModel: 'llama3',
      availableModels: ['llama3'],
    };

    const { module, files, mocks } = await setupConfigModule({ fileConfig: base });
    await module.updateConfig({
      serverName: 'updated',
      availableModels: ['llama3', 'codellama'],
      backup: {
        enabled: true,
        localPath: './backups',
        retentionHours: 72,
        compressionEnabled: true,
        includeNodeModules: false,
      },
    });

    expect(mocks.fs.writeFileSync).toHaveBeenCalledWith(
      CONFIG_PATH + '.tmp',
      expect.any(String),
      'utf8',
    );
    const persisted = yaml.load(files.get(CONFIG_PATH) || '') as Record<string, unknown> & {
      backup?: { retentionHours?: number };
    };
    expect(persisted.serverName).toBe('updated');
    expect(persisted.availableModels).toEqual(['llama3', 'codellama']);
    expect(persisted.backup?.retentionHours).toBe(72);
    expect(module.config.serverName).toBe('updated');
    expect(module.config.backup?.retentionHours).toBe(72);
  });

  describe('validateConfig', () => {
    const validConfig = {
      serverName: 'srv',
      gitbookUrl: 'https://docs.example.com',
      postmanDir: 'postman',
      cacheTtl: 60,
      logLevel: 'info',
      ollamaUrl: 'https://ollama.example.com',
      ollamaModel: 'llama3',
      ollamaTimeout: 1000,
      retryCount: 1,
      availableModels: [],
    };

    it.each([
      ['empty server name', { serverName: '' }, 'serverName cannot be empty'],
      ['invalid gitbook url', { gitbookUrl: 'notaurl' }, 'gitbookUrl must be a valid URL'],
      ['cache ttl negative', { cacheTtl: -5 }, 'cacheTtl must be a positive integer'],
      ['cache ttl too high', { cacheTtl: 90000 }, 'cacheTtl should not exceed 86400 seconds'],
      ['invalid log level', { logLevel: 'trace' }, 'Invalid option: expected one of'],
      ['missing ollama url', { ollamaUrl: '' }, 'ollamaUrl must be a valid URL'],
    ])('detects %s', async (_label, patch, expectedMessage) => {
      const { module } = await setupConfigModule({ fileConfig: validConfig });
      const cfg = { ...validConfig, ...patch };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test passes partial config
      const errors = module.validateConfig(cfg as any);
      expect(errors.join('\n')).toContain(expectedMessage);
    });

    it('logs suggestions for dangerous values (checkInterval < 10)', async () => {
      const { module, mocks } = await setupConfigModule({
        fileConfig: {
          ...validConfig,
          monitoring: { enabled: true, checkInterval: 5, autoHeal: false, notifyOnError: false },
        },
      });
      const cfg = {
        ...validConfig,
        monitoring: { enabled: true, checkInterval: 5, autoHeal: false, notifyOnError: false },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test passes invalid config
      module.validateConfig(cfg as any);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Config suggestions',
        expect.objectContaining({
          suggestions: expect.arrayContaining([
            expect.stringContaining('checkInterval=5'),
            expect.stringContaining('10 or higher'),
          ]),
        }),
      );
    });
  });

  it('getSafeConfig falls back to defaults on validation failure', async () => {
    const { module } = await setupConfigModule({
      fileConfig: {
        ...{
          serverName: 'srv',
          gitbookUrl: 'https://docs.example.com',
          postmanDir: 'postman',
          cacheTtl: 10,
          logLevel: 'info',
          ollamaUrl: 'https://ollama.example.com',
          ollamaModel: 'llama3',
          availableModels: [],
        },
      },
    });

    const unsafe = {
      serverName: 'bad',
      gitbookUrl: 'invalid-url',
      postmanDir: 'postman',
      cacheTtl: 10,
      logLevel: 'info',
      ollamaUrl: 'https://ollama.example.com',
      ollamaModel: 'llama3',
      availableModels: [],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test passes unsafe config
    const safe = module.getSafeConfig(unsafe as any);
    expect(safe.serverName).toBe('hakan-mcp');
    expect(safe.ollamaModel).toBe('llama3');
  });

  it('loads aiProviders extensions from file config', async () => {
    const fileConfig = {
      serverName: 'aiproviders-enabled',
      gitbookUrl: 'https://docs.example.com',
      postmanDir: 'postman',
      cacheTtl: 300,
      logLevel: 'info',
      ollamaUrl: 'https://ollama.example.com',
      ollamaModel: 'llama3',
      ollamaTimeout: 2000,
      retryCount: 1,
      availableModels: ['llama3'],
      aiProviders: {
        geminiKeyEncrypted: 'ENC_TEST',
      },
    };

    const { module } = await setupConfigModule({ fileConfig });
    const { config } = module;

    expect(config.aiProviders?.geminiKeyEncrypted).toBe('ENC_TEST');
  });
});
