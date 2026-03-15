/**
 * Plan E: Config atomic write - verifies original preserved on write failure.
 */
import { jest } from '@jest/globals';
import path from 'node:path';
import yaml from 'js-yaml';

const CONFIG_PATH = path.join(process.cwd(), 'config.yaml');

const setupConfigModuleWithFailingWrite = async () => {
  jest.resetModules();
  const originalContent = yaml.dump({
    serverName: 'original',
    gitbookUrl: 'https://docs.example.com',
    postmanDir: 'postman',
    cacheTtl: 300,
    logLevel: 'info',
    ollamaUrl: 'https://ollama.example.com',
    ollamaModel: 'llama3',
    availableModels: ['llama3'],
  });

  const files = new Map<string, string>();
  files.set(CONFIG_PATH, originalContent);

  const fsMock = {
    existsSync: jest.fn((p: string) => files.has(p)),
    readFileSync: jest.fn((p: string) => {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(p);
    }),
    writeFileSync: jest.fn((p: string, content: string) => {
      if (p.endsWith('.tmp')) {
        throw new Error('ENOSPC: no space left on device');
      }
      files.set(p, content);
    }),
    copyFileSync: jest.fn((src: string, dest: string) => {
      files.set(dest, files.get(src) ?? '');
    }),
    renameSync: jest.fn((oldPath: string, newPath: string) => {
      const c = files.get(oldPath) ?? '';
      files.set(newPath, c);
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
    LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
  }));

  const mod = await import('../src/config.js');
  return { module: mod, mocks: { fs: fsMock, logger }, files };
};

describe('config atomic write (plan E)', () => {
  it('preserves original config when write fails (disk full mock)', async () => {
    const { module, files } = await setupConfigModuleWithFailingWrite();

    expect(() =>
      module.updateConfig({ serverName: 'should-fail', availableModels: ['llama3'] }),
    ).toThrow(/Configuration update failed/);

    const current = yaml.load(files.get(CONFIG_PATH) || '') as Record<string, unknown>;
    expect(current.serverName).toBe('original');

    const backup = yaml.load(files.get(CONFIG_PATH + '.bak') || '') as Record<string, unknown>;
    expect(backup.serverName).toBe('original');
  });
});
