import { z } from 'zod';
import { httpClient } from '../utils/httpClient.js';
import { createJsonResponse } from '../utils/common.js';

const CfBypassInput = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  postData: z.string().optional(),
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string().optional(),
      }),
    )
    .optional(),
  maxTimeout: z.number().int().min(5000).max(120000).default(60000),
  sessionId: z.string().optional(),
  flaresolverrUrl: z.string().url().default('http://localhost:8191/v1'),
});

type FlareSolverrResponse = {
  status: 'ok' | 'error';
  message?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  solution?: {
    url: string;
    status: number;
    response: string;
    cookies: Array<{ name: string; value: string; domain?: string }>;
    userAgent: string;
    headers?: Record<string, string>;
  };
};

export const cfbypassTools = [
  {
    name: 'cfbypass',
    description:
      'Fetch a Cloudflare-protected page through a FlareSolverr Docker container. ' +
      'Returns the rendered HTML plus cookies (including cf_clearance). ' +
      'Use when WebFetch or the browser tool gets a 403/challenge on a site behind Cloudflare. ' +
      'Does not work against Cloudflare Turnstile pages. ' +
      'If the FlareSolverr container is not running: docker run -d --name flaresolverr -p 8191:8191 ' +
      '--restart unless-stopped ghcr.io/flaresolverr/flaresolverr:latest',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: {
          type: 'string',
          enum: ['GET', 'POST'],
          description: 'HTTP method (default: GET)',
        },
        postData: {
          type: 'string',
          description: 'URL-encoded POST body (when method=POST)',
        },
        cookies: {
          type: 'array',
          description: 'Previously obtained cookie set (for session reuse)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              domain: { type: 'string' },
            },
            required: ['name', 'value'],
          },
        },
        maxTimeout: {
          type: 'number',
          description: 'FlareSolverr render timeout (ms, 5000-120000, default 60000)',
        },
        sessionId: {
          type: 'string',
          description: 'Optional session id — reusing the same session preserves cf_clearance',
        },
        flaresolverrUrl: {
          type: 'string',
          description: 'FlareSolverr endpoint (default http://localhost:8191/v1)',
        },
      },
      required: ['url'],
    },
    handler: async (args: unknown) => {
      const p = CfBypassInput.parse(args);

      const body: Record<string, unknown> = {
        cmd: p.method === 'GET' ? 'request.get' : 'request.post',
        url: p.url,
        maxTimeout: p.maxTimeout,
      };
      if (p.postData) body.postData = p.postData;
      if (p.cookies) body.cookies = p.cookies;
      if (p.sessionId) body.session = p.sessionId;

      const res = await httpClient.post(p.flaresolverrUrl, JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        timeout: p.maxTimeout + 5000,
      });

      let data: FlareSolverrResponse;
      try {
        data = JSON.parse(res.body) as FlareSolverrResponse;
      } catch {
        throw new Error(
          `FlareSolverr non-JSON response (HTTP ${res.status}): ${res.body.slice(0, 200)}`,
        );
      }

      if (data.status !== 'ok' || !data.solution) {
        throw new Error(`FlareSolverr: ${data.message || 'unknown error'}`);
      }

      return createJsonResponse({
        httpStatus: data.solution.status,
        finalUrl: data.solution.url,
        html: data.solution.response,
        cookies: data.solution.cookies,
        userAgent: data.solution.userAgent,
        elapsedMs:
          data.startTimestamp && data.endTimestamp
            ? data.endTimestamp - data.startTimestamp
            : undefined,
      });
    },
  },
];
