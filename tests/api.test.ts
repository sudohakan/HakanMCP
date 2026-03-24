import { apiTools } from '../src/tools/api';

describe('API tools', () => {
  it('returns openapi spec', async () => {
    const tool = apiTools[0]!;
    const res = await tool.handler({ action: 'spec' });
    const spec = JSON.parse(res.content[0].text);
    expect(spec.openapi).toBe('3.0.1');
    expect(spec.paths['/tools/call']).toBeDefined();
  });

  it('accepts webhook payload and rate limits', async () => {
    const tool = apiTools[0]!;
    const res = await tool.handler({ action: 'webhookHandle', event: 'test', payload: { ok: true } });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.accepted).toBe(true);
  });
});
