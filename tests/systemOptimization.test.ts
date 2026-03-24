import { jest } from '@jest/globals';
const setupSystemOptimizationModule = async (options?: { fsMock?: Record<string, unknown> }) => {
  jest.resetModules();

  const execAsyncMock = jest.fn(async () => ({ stdout: 'OK', stderr: '' }));
  await jest.unstable_mockModule('util', () => ({
    promisify: () => execAsyncMock,
  }));
  await jest.unstable_mockModule('child_process', () => ({
    exec: jest.fn(),
  }));

  if (options?.fsMock) {
    await jest.unstable_mockModule('fs', () => ({
      __esModule: true,
      default: options.fsMock,
      ...options.fsMock,
    }));
  }

  const module = await import('../src/tools/systemOptimization');
  return {
    systemOptimizationTools: module.systemOptimizationTools,
    execAsyncMock,
  };
};

describe('systemOptimization tools', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs main panel batch as admin', async () => {
    const { systemOptimizationTools, execAsyncMock } = await setupSystemOptimizationModule();
    execAsyncMock.mockImplementationOnce(async () => ({ stdout: 'Batch OK', stderr: '' }));

    const tool = systemOptimizationTools[0]!;
    const result = await tool.handler({ action: 'runAdmin', task: 'main_panel' });

    expect(execAsyncMock).toHaveBeenCalledWith(expect.stringContaining('MAIN_PANEL.bat'));
    expect(result.content[0].text).toContain('Main panel started');
  });

  it('invokes PowerShell analysis with JSON output', async () => {
    const { systemOptimizationTools, execAsyncMock } = await setupSystemOptimizationModule();
    execAsyncMock.mockImplementation(async () => ({ stdout: '{"status":"ok"}', stderr: '' }));

    const tool = systemOptimizationTools[0]!;
    const result = await tool.handler({ action: 'analyzeSystem', jsonOutput: true });

    expect(execAsyncMock).toHaveBeenCalledWith(
      expect.stringContaining('system_status.ps1'),
      expect.objectContaining({ maxBuffer: expect.any(Number) }),
    );
    expect(result.content[0].text).toBe('{"status":"ok"}');
  });

  it('skips docker cleanup when requested in full optimization', async () => {
    const { systemOptimizationTools, execAsyncMock } = await setupSystemOptimizationModule();
    execAsyncMock.mockImplementation(async () => ({ stdout: 'done', stderr: '' }));
    const tool = systemOptimizationTools[0]!;

    const result = await tool.handler({ action: 'fullOptimize', skipDocker: true });

    expect(execAsyncMock).toHaveBeenCalledWith(
      expect.stringContaining('system_status.ps1'),
      expect.any(Object),
    );
    expect(result.content[0].text).toContain('ALL OPTIMIZATIONS');
  });

  it('reads log files when available', async () => {
    const fsMock = {
      existsSync: jest.fn().mockReturnValue(true),
      readFileSync: jest.fn().mockReturnValue('line1\nline2\nline3'),
    };
    const { systemOptimizationTools } = await setupSystemOptimizationModule({ fsMock });

    const tool = systemOptimizationTools[0]!;
    const result = await tool.handler({ action: 'viewLogs', lines: 2 });

    expect(fsMock.existsSync).toHaveBeenCalled();
    expect(result.content[0].text).toContain('Log Record');
  });
});
