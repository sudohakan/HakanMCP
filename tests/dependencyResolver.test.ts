import { jest } from '@jest/globals';

const execFileSyncMock = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

const { installPackages } = await import('../src/dependencyResolver');

describe('installPackages', () => {
  beforeEach(() => execFileSyncMock.mockReset());

  it('runs npm with an argument array and no shell', () => {
    installPackages(['pg', '@scope/pkg'], '/tmp/project');

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileSyncMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(file).toBe('npm');
    expect(args).toEqual(['install', '--no-fund', '--no-audit', 'pg', '@scope/pkg']);
    expect(options.cwd).toBe('/tmp/project');
    expect(options.shell).toBeUndefined();
  });

  it.each([
    'pg; rm -rf /',
    '$(touch pwned)',
    'a && b',
    '`id`',
    'pkg --registry=http://evil',
    '../local',
    '',
  ])('rejects %j before spawning anything', (name) => {
    expect(() => installPackages(['pg', name], '/tmp/project')).toThrow(/invalid package name/);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});
