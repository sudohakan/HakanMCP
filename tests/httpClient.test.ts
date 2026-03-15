import { jest } from '@jest/globals';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Readable } from 'node:stream';

type HttpClientModule = typeof import('../src/utils/httpClient');

const loadNetworkError = async () => {
  const mod = await import('../src/types/index.js');
  return mod.NetworkError;
};

const createResponse = (
  options: {
    status?: number;
    statusText?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
) => {
  const status = options.status ?? 200;
  const body = options.body ?? '';
  const headersMap = new Map(Object.entries(options.headers ?? {}));
  const bodyBuffer = Buffer.from(body);
  const bodyStream = Readable.from([bodyBuffer]);

  return {
    ok: status >= 200 && status < 400,
    status,
    statusText: options.statusText ?? 'OK',
    headers: {
      entries: () => headersMap.entries(),
    },
    body: bodyStream,
    text: jest.fn(async () => body),
    arrayBuffer: jest.fn(async () =>
      bodyBuffer.buffer.slice(bodyBuffer.byteOffset, bodyBuffer.byteOffset + bodyBuffer.byteLength),
    ),
  } as unknown as Response;
};

const setupHttpClientModule = async () => {
  jest.resetModules();

  const fetchMock = jest.fn();
  await jest.unstable_mockModule('node-fetch', () => ({
    default: fetchMock,
    Response: class {},
  }));

  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  await jest.unstable_mockModule('../src/utils/logger.js', () => ({
    logger,
  }));

  const retryMock = jest.fn(
    async (operation: () => Promise<unknown>, options?: { maxAttempts?: number }) => {
      const maxAttempts = options?.maxAttempts ?? 1;
      let lastError: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error;
          if (attempt === maxAttempts - 1) {
            throw error;
          }
        }
      }
      throw lastError;
    },
  );
  await jest.unstable_mockModule('../src/utils/common.js', () => ({
    retry: retryMock,
  }));

  const module: HttpClientModule = await import('../src/utils/httpClient');
  return {
    module,
    fetchMock,
    logger,
    retryMock,
  };
};

describe('HttpClient', () => {
  it('merges default and request headers when calling fetch', async () => {
    const { module, fetchMock } = await setupHttpClientModule();
    const { HttpClient } = module;
    fetchMock.mockImplementation(async () => createResponse() as unknown as Response);

    const client = new HttpClient(1000, { 'X-Default': 'A' });
    await client.fetch('https://api.example.com/data', {
      method: 'POST',
      headers: { 'X-Request': 'B' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({
        headers: {
          'X-Default': 'A',
          'X-Request': 'B',
        },
      }),
    );
  });

  it('throws NetworkError on timeout', async () => {
    const { module, fetchMock } = await setupHttpClientModule();
    const { HttpClient } = module;
    const NetworkError = await loadNetworkError();
    jest.useFakeTimers();

    fetchMock.mockImplementation(
      (_url: unknown, options: Record<string, unknown> = {}) =>
        new Promise((_resolve, reject) => {
          (options.signal as AbortSignal)?.addEventListener('abort', () =>
            reject({ name: 'AbortError' }),
          );
        }),
    );

    const client = new HttpClient(50);

    const pending = client.fetch('https://slow.example.com');
    jest.advanceTimersByTime(51);
    await expect(pending).rejects.toBeInstanceOf(NetworkError);
    jest.useRealTimers();
  });

  it('retries failing requests based on retries option', async () => {
    const { module, retryMock } = await setupHttpClientModule();
    const { HttpClient } = module;

    const client = new HttpClient();
    const fetchSpy = jest.spyOn(client, 'fetch');

    fetchSpy
      .mockResolvedValueOnce(
        createResponse({ status: 503, statusText: 'Busy' }) as unknown as Response,
      )
      .mockResolvedValueOnce(createResponse({ status: 200, body: 'OK' }) as unknown as Response);

    const response = await client.fetchWithRetry('https://retry.example.com', { retries: 1 });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(retryMock).toHaveBeenCalledWith(expect.any(Function), { maxAttempts: 2 });
  });

  it('uses fetchWithRetry when retries option supplied to request', async () => {
    const { module } = await setupHttpClientModule();
    const { HttpClient } = module;

    const client = new HttpClient();

    const fetchWithRetrySpy = jest.spyOn(client, 'fetchWithRetry').mockResolvedValue(
      createResponse({
        status: 200,
        body: 'retried',
      }) as unknown as Response,
    );
    const fetchSpy = jest
      .spyOn(client, 'fetch')
      .mockResolvedValue(createResponse() as unknown as Response);

    const result = await client.request('https://retry.example.com', {
      retries: 1,
      method: 'DELETE',
    });

    expect(result.status).toBe(200);
    expect(fetchWithRetrySpy).toHaveBeenCalledWith(
      'https://retry.example.com',
      expect.objectContaining({ method: 'DELETE', retries: 1 }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to fetch when retries not provided', async () => {
    const { module } = await setupHttpClientModule();
    const { HttpClient } = module;

    const client = new HttpClient();
    const fetchSpy = jest.spyOn(client, 'fetch').mockResolvedValue(
      createResponse({
        status: 202,
        statusText: 'Accepted',
        headers: { 'X-Test': '1' },
        body: 'body',
      }) as unknown as Response,
    );

    const result = await client.request('https://simple.example.com');

    expect(fetchSpy).toHaveBeenCalledWith('https://simple.example.com', expect.any(Object));
    expect(result.statusText).toBe('Accepted');
    expect(result.headers['X-Test']).toBe('1');
  });

  it('exposes verb helpers that delegate to request', async () => {
    const { module } = await setupHttpClientModule();
    const { HttpClient } = module;

    const client = new HttpClient();
    const requestSpy = jest.spyOn(client, 'request').mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '',
    });

    await client.get('https://example.com', { timeout: 10 });
    await client.post('https://example.com', '{}');
    await client.put('https://example.com', '{}');
    await client.patch('https://example.com', '{}');
    await client.delete('https://example.com');

    expect(requestSpy).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'GET', timeout: 10 }),
    );
    expect(requestSpy).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(requestSpy).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(requestSpy).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(requestSpy).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('adds authentication headers for helper methods', async () => {
    const { module } = await setupHttpClientModule();
    const { HttpClient } = module;

    const client = new HttpClient();
    const requestSpy = jest.spyOn(client, 'request').mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '',
    });

    await client.withBearer('https://example.com', 'token-123');
    await client.withBasicAuth('https://example.com', 'user', 'pass');
    await client.withApiKey('https://example.com', 'secret', { headerName: 'X-SECRET' });

    expect(requestSpy).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
    expect(requestSpy).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('user:pass').toString('base64')}`,
        }),
      }),
    );
    expect(requestSpy).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-SECRET': 'secret' }),
      }),
    );
  });

  it('downloads files and writes them to disk', async () => {
    const { module, fetchMock, logger } = await setupHttpClientModule();
    const { HttpClient } = module;

    const tmpFile = path.join(os.tmpdir(), `http-client-${Date.now()}.txt`);
    const fileContent = 'file-contents';
    fetchMock.mockImplementation(
      async () => createResponse({ body: fileContent }) as unknown as Response,
    );

    const client = new HttpClient();
    const result = await client.downloadFile('https://files.example.com/file.txt', tmpFile);

    expect(fs.existsSync(tmpFile)).toBe(true);
    const writtenContent = fs.readFileSync(tmpFile, 'utf8');
    expect(writtenContent).toBe(fileContent);

    expect(result.path).toBe(tmpFile);
    expect(result.size).toBe(Buffer.byteLength(fileContent));
    expect(logger.info).toHaveBeenCalledWith(
      'File downloaded',
      expect.objectContaining({ url: 'https://files.example.com/file.txt', outputPath: tmpFile }),
    );

    fs.rmSync(tmpFile, { force: true });
  });
});
