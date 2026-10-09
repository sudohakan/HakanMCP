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
    statSync: jest.fn(() => ({ mode: 0o600 })),
    unlinkSync: jest.fn(),
  };

  await jest.unstable_mockModule('node:fs', () => ({
    default: fsMock,
    ...fsMock,
  }));

  // Mock PROJECT_ROOT so config.ts resolves paths relative to cwd (matching CONFIG_PATH)
  await jest.unstable_mockModule('../src/utils/projectRoot.js', () => ({
    PROJECT_ROOT: process.cwd(),
  }));

  // Mock dotenv so it doesn't try to read .env from the real filesystem
  await jest.unstable_mockModule('dotenv', () => ({
    config: jest.fn(),
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
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('No config.yaml'));
  });

  it('merges file overrides into runtime config', async () => {
    const override = {
      serverName: 'custom-server',
      logLevel: 'debug',
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
    expect(config.logLevel).toBe('debug');
    expect(config.backup?.localPath).toBe('./alt-backups');
    expect(mocks.logger.info).toHaveBeenCalledWith(expect.stringContaining('Loaded config'));
  });

  it('updateConfig persists merged changes and updates runtime config', async () => {
    const base = {
      serverName: 'initial',
      cacheTtl: 200,
      logLevel: 'info',
    };

    const { module, files, mocks } = await setupConfigModule({ fileConfig: base });
    await module.updateConfig({
      serverName: 'updated',
      cacheTtl: 450,
      backup: {
        enabled: true,
        localPath: './backups',
        retentionHours: 72,
        compressionEnabled: true,
        includeNodeModules: false,
      },
    });

    expect(mocks.fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(CONFIG_PATH + '.tmp.'),
      expect.any(String),
      'utf8',
    );
    const persisted = yaml.load(files.get(CONFIG_PATH) || '') as Record<string, unknown> & {
      backup?: { retentionHours?: number };
    };
    expect(persisted.serverName).toBe('updated');
    expect(persisted.cacheTtl).toBe(450);
    expect(persisted.backup?.retentionHours).toBe(72);
    expect(module.config.serverName).toBe('updated');
    expect(module.config.backup?.retentionHours).toBe(72);
  });

  describe('validateConfig', () => {
    const validConfig = {
      serverName: 'srv',
      cacheTtl: 60,
      logLevel: 'info',
      retryCount: 1,
    };

    it.each([
      ['empty server name', { serverName: '' }, 'serverName cannot be empty'],
      ['cache ttl negative', { cacheTtl: -5 }, 'cacheTtl must be a positive integer'],
      ['cache ttl too high', { cacheTtl: 90000 }, 'cacheTtl should not exceed 86400 seconds'],
      ['invalid log level', { logLevel: 'trace' }, 'Invalid option: expected one of'],
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
              cacheTtl: 10,
          logLevel: 'info',
                    },
      },
    });

    const unsafe = {
      serverName: 'bad',
      cacheTtl: 10,
      logLevel: 'info',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test passes unsafe config
    const safe = module.getSafeConfig(unsafe as any);
    expect(safe.serverName).toBe('hakan-mcp');
    expect(safe.serverName).toBe('hakan-mcp');
  });

  it('keeps an unknown key out of the runtime config instead of failing to load', async () => {
    const fileConfig = {
      serverName: 'with-stale-key',
      cacheTtl: 300,
      logLevel: 'info',
      retryCount: 1,
      // A key from an older schema: config.yaml files in the wild still carry
      // aiProviders/scheduler/consciousness blocks, and finding one must not
      // stop the server from starting.
      aiProviders: { geminiKeyEncrypted: 'ENC_TEST' },
    };

    const { module } = await setupConfigModule({ fileConfig });
    const { config } = module;

    expect(config.serverName).toBe('with-stale-key');
    expect((config as Record<string, unknown>).aiProviders).toBeUndefined();
  });
});
