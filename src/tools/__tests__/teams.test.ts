import { teamsTools, buildArgs } from '../teams.js';

describe('teams tool', () => {
  const tool = teamsTools[0];

  it('registers one tool named teams with a neutral description', () => {
    expect(teamsTools).toHaveLength(1);
    expect(tool.name).toBe('teams');
    expect(tool.description).not.toMatch(/token|credential|secret|session|password/i);
    expect(typeof tool.handler).toBe('function');
  });

  it('builds CLI arguments per action', () => {
    expect(buildArgs({ action: 'chat', name: 'Finekra', limit: 5, from: '2026-10-01', to: '2026-10-05' })).toEqual(
      ['chat', 'Finekra', '-n', '5', '--from', '2026-10-01', '--to', '2026-10-05', '--json']);
    expect(buildArgs({ action: 'recent', since: '3d' })).toEqual(['recent', '--since', '3d', '--json']);
    expect(buildArgs({ action: 'unread', after: 'c~1' })).toEqual(['unread', '--after', 'c~1', '--json']);
    expect(buildArgs({ action: 'files', sender: 'Koray', type: 'pdf', since: '7d' })).toEqual(
      ['files', '--since', '7d', '--sender', 'Koray', '--type', 'pdf', '--json']);
    expect(buildArgs({ action: 'files', download: 'rapor' })).toEqual(['files', '--download', 'rapor', '--json']);
    expect(buildArgs({ action: 'doctor' })).toEqual(['doctor', '--json']);
  });

  it('rejects chat without a name', () => {
    expect(() => buildArgs({ action: 'chat' })).toThrow(/name/);
  });

  it('rejects an unknown action before running anything', async () => {
    await expect(tool.handler({ action: 'send' })).rejects.toThrow();
  });
});
