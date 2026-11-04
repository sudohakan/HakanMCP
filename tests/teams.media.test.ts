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

describe('teams send-file args', () => {
  it('passes chat, path, optional text and one --email per recipient after the draft gate', () => {
    expect(buildArgs({ action: 'send-file', chat: '19:x', path: '/tmp/a.pem', emails: ['a@b.c', 'd@e.f'], confirm: true } as never))
      .toEqual(['send-file', '--email', 'a@b.c', '--email', 'd@e.f', '--yes', '--json', '--', '19:x', '/tmp/a.pem']);
    expect(buildArgs({ action: 'send-file', chat: '19:x', path: '/tmp/a.pem', text: 'bunu yükle' } as never))
      .toEqual(['send-file', '--json', '--', '19:x', '/tmp/a.pem', 'bunu yükle']);
  });
});
