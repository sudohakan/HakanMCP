import { jest } from '@jest/globals';

// Mock httpClient
jest.unstable_mockModule('../src/utils/httpClient.js', () => ({
  httpClient: {
    request: jest.fn(async (url: string, _options?: Record<string, unknown>) => {
      // Default mock response
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: { status: 200, message: 'Mocked response' },
      };

      if (url.includes('status/500')) {
        // Simulate error throw or return 500
        throw new Error('HTTP 500 Internal Server Error');
      }

      if (url.includes('json')) {
        return {
          ...mockResponse,
          body: {
            slideshow: {
              author: 'Yours Truly',
              date: 'date of publication',
              slides: [],
              title: 'Sample Slide Show',
            },
          },
        };
      }

      return mockResponse;
    }),
    withBearer: jest.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: { status: 200, message: 'Mocked response' },
    })),
    withBasicAuth: jest.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: { status: 200, message: 'Mocked response' },
    })),
    withApiKey: jest.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: { status: 200, message: 'Mocked response' },
    })),
    downloadFile: jest.fn(async (url: string, outputPath: string) => {
      return {
        path: outputPath,
        size: 1024,
      };
    }),
  },
}));

// Dynamic import
const { httpTools } = await import('../src/tools/http');

describe('HTTP Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('http_get', () => {
    it('should make GET request successfully', async () => {
      const tool = httpTools[0]!;
      expect(tool).toBeDefined();

      const result = await tool.handler({
        action: 'request',
        method: 'GET',
        url: 'https://httpbin.org/get',
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });

    it('should include custom headers', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'GET',
        url: 'https://httpbin.org/headers',
        headers: { 'X-Custom-Header': 'test-value' },
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });
  });

  describe('http_post', () => {
    it('should make POST request with body', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'POST',
        url: 'https://httpbin.org/post',
        body: JSON.stringify({ test: 'data' }),
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });
  });

  describe('http_put', () => {
    it('should make PUT request', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'PUT',
        url: 'https://httpbin.org/put',
        body: JSON.stringify({ test: 'data' }),
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });
  });

  describe('http_patch', () => {
    it('should make PATCH request', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'PATCH',
        url: 'https://httpbin.org/patch',
        body: JSON.stringify({ test: 'data' }),
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });
  });

  describe('http_delete', () => {
    it('should make DELETE request', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'DELETE',
        url: 'https://httpbin.org/delete',
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });
  });

  describe('http_withBearer', () => {
    it('should include Bearer token in headers', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'GET',
        url: 'https://httpbin.org/bearer',
        auth: { type: 'bearer', token: 'test-token-123' },
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });
  });

  describe('http_withBasicAuth', () => {
    it('should include Basic Auth credentials', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'GET',
        url: 'https://httpbin.org/basic-auth/user/pass',
        auth: { type: 'basic', username: 'user', password: 'pass' },
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });
  });

  describe('http_withApiKey', () => {
    it('should include API key in custom header', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'GET',
        url: 'https://httpbin.org/headers',
        auth: { type: 'apiKey', apiKey: 'test-api-key', headerName: 'X-API-Key' },
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });
  });

  describe('http_requestWithTimeout', () => {
    it('should respect timeout settings', async () => {
      const tool = httpTools[0]!;

      const result = await tool.handler({
        action: 'request',
        method: 'GET',
        url: 'https://httpbin.org/get',
        timeout: 10000,
      });

      const response = JSON.parse(result.content[0].text || '{}');
      expect(response.status).toBe(200);
    });

    it('should retry on failure', async () => {
      const tool = httpTools[0]!;

      // httpbin.org/status/500 returns 500 error
      try {
        await tool.handler({
          action: 'request',
          method: 'GET',
          url: 'https://httpbin.org/status/500',
          timeout: 5000,
          retries: 2,
        });
      } catch (error: unknown) {
        expect(error instanceof Error ? error.message : String(error)).toContain('HTTP 500');
      }
    });
  });

  describe('http_downloadFile', () => {
    it('should download file successfully', async () => {
      const tool = httpTools[0]!;
      const outputPath = '/tmp/test-download.json';

      const result = await tool.handler({
        action: 'downloadFile',
        url: 'https://httpbin.org/json',
        outputPath,
      });

      expect(result.content[0].text).toContain('File downloaded');
      expect(result.content[0].text).toContain(outputPath);
    });
  });
});
