import { buildArgs } from '../src/tools/teams.js';

describe('teams media action', () => {
  it('passes chat and message id after `--` and the output directory as a flag', () => {
    expect(buildArgs({ action: 'media', chat: '19:abc', message_id: '1793006139520', out: '/tmp/x' } as never))
      .toEqual(['media', '--out', '/tmp/x', '--json', '--', '19:abc', '1793006139520']);
  });

  it('requires the message id', () => {
    expect(() => buildArgs({ action: 'media', chat: '19:abc' } as never)).toThrow('media needs message_id');
  });
});
