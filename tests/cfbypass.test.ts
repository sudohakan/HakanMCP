import { jest } from '@jest/globals';

const postMock = jest.fn<
  (url: string, body: string, options?: Record<string, unknown>) => Promise<unknown>
>();

jest.unstable_mockModule('../src/utils/httpClient.js', () => ({
  httpClient: {
    post: postMock,
  },
}));

const { cfbypassTools } = await import('../src/tools/cfbypass');

const tool = cfbypassTools[0]!;

const OK_RESPONSE = {
  status: 'ok',
  message: '',
  startTimestamp: 1000,
  endTimestamp: 3500,
  solution: {
    url: 'https://www.akakce.com/arama/?q=test',
    status: 200,
    response: '<html><body>Trident Z5 Neo</body></html>',
    cookies: [
      { name: 'cf_clearance', value: 'abc123', domain: '.akakce.com' },
    ],
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    headers: {},
  },
};

describe('cfbypass tool', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('happy path: returns rendered HTML + cookies on status=ok', async () => {
    postMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify(OK_RESPONSE),
    });

    const result = (await tool.handler({
      url: 'https://www.akakce.com/arama/?q=test',
    })) as { content: Array<{ type: string; text?: string }> };

    const parsed = JSON.parse(result.content[0]!.text!) as {
      httpStatus: number;
      html: string;
      cookies: Array<{ name: string; value: string }>;
      elapsedMs: number;
    };

    expect(parsed.httpStatus).toBe(200);
    expect(parsed.html).toContain('Trident Z5 Neo');
    expect(parsed.cookies[0]!.name).toBe('cf_clearance');
    expect(parsed.elapsedMs).toBe(2500);
  });

  it('sends cmd=request.get by default', async () => {
    postMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify(OK_RESPONSE),
    });

    await tool.handler({ url: 'https://example.com/' });

    const [, bodyStr] = postMock.mock.calls[0]!;
    expect(JSON.parse(bodyStr).cmd).toBe('request.get');
  });

  it('sends cmd=request.post + postData when method=POST', async () => {
    postMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify(OK_RESPONSE),
    });

    await tool.handler({
      url: 'https://example.com/login',
      method: 'POST',
      postData: 'user=a&pass=b',
    });

    const [, bodyStr] = postMock.mock.calls[0]!;
    const body = JSON.parse(bodyStr);
    expect(body.cmd).toBe('request.post');
    expect(body.postData).toBe('user=a&pass=b');
  });

  it('passes sessionId as session field to FlareSolverr', async () => {
    postMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify(OK_RESPONSE),
    });

    await tool.handler({
      url: 'https://example.com/',
      sessionId: 'my-session-1',
    });

    const [, bodyStr] = postMock.mock.calls[0]!;
    const body = JSON.parse(bodyStr);
    expect(body.session).toBe('my-session-1');
  });

  it('throws on FlareSolverr status=error', async () => {
    postMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ status: 'error', message: 'Challenge not solved' }),
    });

    await expect(tool.handler({ url: 'https://turnstile-site.com/' })).rejects.toThrow(
      /Challenge not solved/,
    );
  });

  it('throws on non-JSON response body', async () => {
    postMock.mockResolvedValue({
      status: 502,
      statusText: 'Bad Gateway',
      headers: {},
      body: '<html>Gateway Error</html>',
    });

    await expect(tool.handler({ url: 'https://example.com/' })).rejects.toThrow(
      /non-JSON response/,
    );
  });

  it('rejects invalid URL via zod', async () => {
    await expect(tool.handler({ url: 'not-a-url' })).rejects.toThrow();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('forwards maxTimeout + 5000ms to httpClient timeout', async () => {
    postMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify(OK_RESPONSE),
    });

    await tool.handler({ url: 'https://example.com/', maxTimeout: 30000 });

    const [, , options] = postMock.mock.calls[0]!;
    expect((options as { timeout: number }).timeout).toBe(35000);
  });
});
