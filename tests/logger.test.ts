import { jest } from '@jest/globals';

const setupLoggerModule = async () => {
  jest.resetModules();
  const existsSync = jest.fn().mockReturnValue(true);
  const mkdirSync = jest.fn();
  const infoSpy = jest.fn();

  await jest.unstable_mockModule('node:fs', () => ({
    __esModule: true,
    default: { existsSync, mkdirSync },
    existsSync,
    mkdirSync,
  }));

  await jest.unstable_mockModule('winston', () => ({
    __esModule: true,
    default: {
      createLogger: jest.fn(() => ({ info: infoSpy })),
      format: { printf: () => ({}) },
    },
    format: { printf: () => ({}) },
  }));

  await jest.unstable_mockModule('winston-daily-rotate-file', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  }));

  const module = await import('../src/utils/logger');
  return { ...module, infoSpy };
};

describe('logger utility', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.LOG_DIR = '/tmp/logs';
    process.env.LOG_LEVEL = '';
    jest.useFakeTimers();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('logs info messages with context and writes to file', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { logger, infoSpy } = await setupLoggerModule();
    jest.setSystemTime(new Date('2024-01-02T03:04:05Z'));

    logger.setContext({ tool: 'test-tool' });
    logger.info('hello', { op: 'run' });

    await jest.advanceTimersByTimeAsync(100);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"message":"hello"'));
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toContain('"message":"hello"');
  });

  it('respects log level gating for debug logs', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { logger, LogLevel } = await setupLoggerModule();

    logger.setLevel(LogLevel.INFO);
    logger.debug('should-not-log');

    await jest.advanceTimersByTimeAsync(100);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('logs error with stack information and child context', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { logger, LogLevel } = await setupLoggerModule();

    logger.setLevel(LogLevel.DEBUG);
    const child = logger.child({ tool: 'child' });
    child.error('boom', new Error('fail'), { op: 'test' });

    await jest.advanceTimersByTimeAsync(100);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"message":"boom"'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"op":"test"'));
  });

  it('writes to rotating log file with tool/operation in payload', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { logger, infoSpy } = await setupLoggerModule();
    jest.setSystemTime(new Date('2024-01-02T03:04:05Z'));

    logger.info('per-tool log', { tool: 'env_getVar', operation: 'invoke' });

    await jest.advanceTimersByTimeAsync(100);

    expect(consoleSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toContain('env_getVar');
    expect(infoSpy.mock.calls[0][0]).toContain('invoke');
  });
});
