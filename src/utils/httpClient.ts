/**
 * HTTP client utilities with timeout, retry, and error handling
 */

import fetch, { RequestInit, Response } from 'node-fetch';
import { logger } from './logger.js';
import { retry } from './common.js';
import { NetworkError } from '../types/index.js';

export interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export interface HttpRequestOptions extends HttpClientOptions {
  method?: string;
  body?: string;
}

export class HttpClient {
  private defaultTimeout: number;
  private defaultHeaders: Record<string, string>;

  constructor(defaultTimeout: number = 30000, defaultHeaders: Record<string, string> = {}) {
    this.defaultTimeout = defaultTimeout;
    this.defaultHeaders = defaultHeaders;
  }

  /**
   * Fetch with timeout support
   */
  async fetch(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || this.defaultTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...this.defaultHeaders,
          ...((options.headers as Record<string, string>) || {}),
        },
      });
      return response;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError('Request timeout', {
          url,
          timeout: options.timeout || this.defaultTimeout,
        });
      }
      throw new NetworkError('Request failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch with retry support
   */
  async fetchWithRetry(
    url: string,
    options: RequestInit & HttpClientOptions = {},
  ): Promise<Response> {
    const { retries = 3, ...fetchOptions } = options;

    return retry(
      async () => {
        const response = await this.fetch(url, fetchOptions);

        if (response.status >= 400 && response.status < 500) {
          return response;
        }

        if (response.status >= 500) {
          throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`, {
            url,
            status: response.status,
          });
        }

        return response;
      },
      { maxAttempts: retries + 1 },
    );
  }

  /**
   * Generic HTTP request method
   */
  async request(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  }> {
    const { method = 'GET', body, headers, timeout, retries } = options;

    logger.debug('HTTP request', { method, url });

    const response =
      retries !== undefined && retries > 0
        ? await this.fetchWithRetry(url, { method, body, headers, timeout, retries })
        : await this.fetch(url, { method, body, headers, timeout });

    const responseText = await response.text();

    logger.debug('HTTP response', {
      method,
      url,
      status: response.status,
      bodyLength: responseText.length,
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseText,
    };
  }

  /**
   * GET request
   */
  async get(url: string, options: HttpClientOptions = {}) {
    return this.request(url, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post(url: string, body: string, options: HttpClientOptions = {}) {
    return this.request(url, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put(url: string, body: string, options: HttpClientOptions = {}) {
    return this.request(url, { ...options, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  async patch(url: string, body: string, options: HttpClientOptions = {}) {
    return this.request(url, { ...options, method: 'PATCH', body });
  }

  /**
   * DELETE request
   */
  async delete(url: string, options: HttpClientOptions = {}) {
    return this.request(url, { ...options, method: 'DELETE' });
  }

  /**
   * Request with Bearer token authentication
   */
  async withBearer(url: string, token: string, options: HttpRequestOptions = {}) {
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    return this.request(url, { ...options, headers });
  }

  /**
   * Request with Basic authentication
   */
  async withBasicAuth(
    url: string,
    username: string,
    password: string,
    options: HttpRequestOptions = {},
  ) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    const headers = {
      ...options.headers,
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    };

    return this.request(url, { ...options, headers });
  }

  /**
   * Request with API Key authentication
   */
  async withApiKey(
    url: string,
    apiKey: string,
    options: HttpRequestOptions & { headerName?: string } = {},
  ) {
    const { headerName = 'X-API-Key', ...requestOptions } = options;
    const headers = {
      ...requestOptions.headers,
      [headerName]: apiKey,
      'Content-Type': 'application/json',
    };

    return this.request(url, { ...requestOptions, headers });
  }

  /**
   * Download file
   */
  async downloadFile(
    url: string,
    outputPath: string,
    options: HttpClientOptions = {},
  ): Promise<{ path: string; size: number }> {
    const fs = await import('node:fs');

    const response = await this.fetch(url, {
      method: 'GET',
      headers: options.headers,
      timeout: options.timeout,
    });

    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`, {
        url,
        status: response.status,
      });
    }

    if (!response.body) {
      throw new NetworkError('Response body is empty', { url });
    }

    const { pipeline } = await import('node:stream/promises');
    const fileStream = fs.createWriteStream(outputPath);

    await pipeline(response.body, fileStream);

    const stats = await fs.promises.stat(outputPath);

    logger.info('File downloaded', {
      url,
      outputPath,
      size: stats.size,
    });

    return {
      path: outputPath,
      size: stats.size,
    };
  }
}

export const httpClient = new HttpClient();
