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
      ['chat', '-n', '5', '--from', '2026-10-01', '--to', '2026-10-05', '--json', '--', 'Finekra']);
    expect(buildArgs({ action: 'recent', since: '3d' })).toEqual(['recent', '--since', '3d', '--json']);
    expect(buildArgs({ action: 'unread', after: 'c~1' })).toEqual(['unread', '--after', 'c~1', '--json']);
    expect(buildArgs({ action: 'files', sender: 'Koray', type: 'pdf', since: '7d' })).toEqual(
      ['files', '--since', '7d', '--type', 'pdf', '--sender', 'Koray', '--json']);
    expect(buildArgs({ action: 'files', download: 'rapor' })).toEqual(['files', '--download', 'rapor', '--json']);
    expect(buildArgs({ action: 'doctor' })).toEqual(['doctor', '--json']);
  });

  it('manage actions stay drafts without confirm and add --yes only with confirm: true', () => {
    expect(buildArgs({ action: 'send', chat: 'notlar', text: 'merhaba' })).toEqual(['send', '--json', '--', 'notlar', 'merhaba']);
    expect(buildArgs({ action: 'send', chat: 'notlar', text: 'merhaba', confirm: false })).not.toContain('--yes');
    expect(buildArgs({ action: 'send', chat: 'notlar', text: 'merhaba', confirm: true })).toEqual(
      ['send', '--yes', '--json', '--', 'notlar', 'merhaba']);
    expect(buildArgs({ action: 'chat', name: 'x', confirm: true })).not.toContain('--yes');
  });

  it('free text can never become a flag', () => {
    const args = buildArgs({ action: 'send', chat: 'notlar', text: '--yes' });
    expect(args.indexOf('--yes')).toBeGreaterThan(args.indexOf('--'));
    expect(args.slice(args.indexOf('--'))).toEqual(['--', 'notlar', '--yes']);
  });

  it('maps lists, repeats and booleans', () => {
    expect(buildArgs({ action: 'send', chat: 'Koray', text: 'selam Ali ve Veli', mention: ['Ali', 'Veli'] })).toEqual(
      ['send', '--mention', 'Ali', '--mention', 'Veli', '--json', '--', 'Koray', 'selam Ali ve Veli']);
    expect(buildArgs({ action: 'event-new', subject: 'Plan', start: '2026-10-28 14:30', minutes: 45, attendees: ['Koray', 'Ali'], online: true })).toEqual(
      ['event-new', '--start', '2026-10-28 14:30', '--minutes', '45', '--attendees', 'Koray', 'Ali', '--online', '--json', '--', 'Plan']);
    expect(buildArgs({ action: 'react', chat: 'notlar', message_id: '12', key: 'like', remove: true })).toEqual(
      ['react', '--remove', '--json', '--', 'notlar', '12', 'like']);
    expect(buildArgs({ action: 'upload', path: '/tmp/a.txt', send_to: 'notlar' })).toEqual(['upload', '--to', 'notlar', '--json', '--', '/tmp/a.txt']);
  });

  it('optional positionals may be omitted, required ones may not', () => {
    expect(buildArgs({ action: 'presence' })).toEqual(['presence', '--json']);
    expect(buildArgs({ action: 'presence-set', note: 'toplantıdayım' })).toEqual(['presence-set', '--note', 'toplantıdayım', '--json']);
    expect(() => buildArgs({ action: 'send', chat: 'notlar' })).toThrow(/text/);
    expect(() => buildArgs({ action: 'event-respond', event: 'x' })).toThrow(/answer/);
  });

  it('rejects chat without a name', () => {
    expect(() => buildArgs({ action: 'chat' })).toThrow(/name/);
  });

  it('rejects an unknown action before running anything', async () => {
    await expect(tool.handler({ action: 'nope' })).rejects.toThrow();
  });
});
