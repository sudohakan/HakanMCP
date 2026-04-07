/**
 * Common utility functions shared across tools
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Rejects strings containing shell metacharacters to prevent command injection. \\ allowed (Windows path separator). */
const SHELL_UNSAFE = /[;|&$`'"\n\r<>]/;

/** Rejects path strings with dangerous chars (Jules: command injection) */
export function assertPathSafe(p: string, label: string): void {
  if (SHELL_UNSAFE.test(p)) {
    throw new Error(`${label} contains unsafe characters (shell metacharacters not allowed)`);
  }
}

/** Validates pid is numeric to prevent command injection (Jules: sys_killProcess) */
export function assertPidNumeric(pid: string): void {
  if (!/^\d+$/.test(pid)) {
    throw new Error('PID must be a numeric string');
  }
}

/** Escapes a string for safe use inside double-quoted bash/cmd context. Backslash-escapes ", $, `, \ */
export function escapeForDoubleQuotedShell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

/** Escapes for PowerShell -LiteralPath / single-quoted context: double single quotes */
export function escapeForPowerShellSingleQuoted(s: string): string {
  return s.replace(/'/g, "''");
}

/** When allowedPaths is set, path must resolve under one of them. Returns true if no allowlist. */
export function isPathAllowed(resolvedPath: string, allowedPaths?: string[]): boolean {
  if (!allowedPaths?.length) return true;
  const normalized = path.resolve(resolvedPath);
  for (const allowed of allowedPaths) {
    const base = path.resolve(allowed);
    if (normalized === base || normalized.startsWith(base + path.sep)) return true;
  }
  return false;
}
import { ToolResponse, ToolError } from '../types/index.js';
import { logger } from './logger.js';

/**
 * Atomically writes content to a file (plan.md E).
 * Writes to <path>.tmp then renames to path. On write error, original file is untouched,
 * error is logged, and any partial .tmp is cleaned up.
 */
export function atomicWriteFileSync(
  filePath: string,
  content: string,
  options?: { createBackup?: boolean },
): void {
  const tmpPath = filePath + '.tmp.' + randomBytes(6).toString('hex');
  const backupPath = filePath + '.bak';

  if (options?.createBackup && fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
  }

  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : 'Error';
    logger.error('atomicWriteFileSync failed (write)', {
      filePath,
      operation: 'write',
      error: name,
      message: msg,
    });
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup failure */
    }
    throw err;
  }

  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : 'Error';
    logger.error('atomicWriteFileSync failed (rename)', {
      filePath,
      tmpPath,
      operation: 'rename',
      error: name,
      message: msg,
    });
    throw err;
  }
}

/**
 * Creates a successful tool response with text content
 */
export function createTextResponse(text: string, meta?: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: 'text', text }],
    meta,
  };
}

/**
 * Creates a successful tool response with JSON content
 */
export function createJsonResponse(data: unknown, meta?: Record<string, unknown>): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    meta,
  };
}

/**
 * Creates an error response
 */
export function createErrorResponse(error: Error | string): ToolResponse {
  const message = error instanceof Error ? error.message : error;
  return {
    content: [
      {
        type: 'text',
        text: `❌ Error: ${message}`,
      },
    ],
    isError: true,
  };
}

/**
 * Wraps a handler with error handling
 */
export function withErrorHandling<T>(
  handler: (args: T) => Promise<ToolResponse>,
): (args: T) => Promise<ToolResponse> {
  return async (args: T): Promise<ToolResponse> => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof ToolError) {
        return createErrorResponse(error);
      }

      const err = error as Error;
      logger.error('Tool execution failed', err instanceof Error ? err : new Error(String(err)));
      return createErrorResponse(err.message || 'Unknown error occurred');
    }
  };
}

/**
 * Validates required fields in an object
 */
export function validateRequired<T extends Record<string, unknown>>(
  obj: T,
  fields: (keyof T)[],
): void {
  const missing = fields.filter((field) => obj[field] === undefined || obj[field] === null);

  if (missing.length > 0) {
    throw new ToolError(`Missing required fields: ${missing.join(', ')}`, 'VALIDATION_ERROR', {
      missing,
    });
  }
}

/**
 * Safely parses JSON with error handling
 */
export function safeJsonParse<T = unknown>(json: string, fallback?: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new ToolError('Invalid JSON format', 'PARSE_ERROR', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Validates file path (basic check, no security validation)
 */
export function validatePath(filePath: string): void {
  if (!filePath || typeof filePath !== 'string') {
    throw new ToolError('Invalid file path', 'VALIDATION_ERROR');
  }

  if (filePath.trim().length === 0) {
    throw new ToolError('File path cannot be empty', 'VALIDATION_ERROR');
  }
}

/**
 * Validates URL format
 */
export function validateUrl(url: string): void {
  if (!url || typeof url !== 'string') {
    throw new ToolError('Invalid URL', 'VALIDATION_ERROR');
  }

  try {
    new URL(url);
  } catch {
    throw new ToolError(`Invalid URL format: ${url}`, 'VALIDATION_ERROR');
  }
}

/**
 * Validates port number
 */
export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ToolError(
      `Invalid port number: ${port}. Must be between 1 and 65535`,
      'VALIDATION_ERROR',
    );
  }
}

/**
 * Validates hostname
 */
export function validateHostname(hostname: string): void {
  if (!hostname || typeof hostname !== 'string') {
    throw new ToolError('Invalid hostname', 'VALIDATION_ERROR');
  }

  const hostnamePattern =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!hostnamePattern.test(hostname) && hostname !== 'localhost') {
    throw new ToolError(`Invalid hostname format: ${hostname}`, 'VALIDATION_ERROR');
  }
}

/**
 * Validates email format
 */
export function validateEmail(email: string): void {
  if (!email || typeof email !== 'string') {
    throw new ToolError('Invalid email', 'VALIDATION_ERROR');
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    throw new ToolError(`Invalid email format: ${email}`, 'VALIDATION_ERROR');
  }
}

/**
 * Debounces a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>): void => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Retries an async operation with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
  } = {},
): Promise<T> {
  const { maxAttempts = 3, initialDelay = 1000, maxDelay = 10000, factor = 2 } = options;

  let lastError: Error | null = null;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        logger.warn('Retry attempt failed', { attempt, delay });
        await sleep(delay);
        delay = Math.min(delay * factor, maxDelay);
      }
    }
  }

  throw new ToolError(
    `Operation failed after ${maxAttempts} attempts: ${lastError?.message}`,
    'RETRY_EXHAUSTED',
    { attempts: maxAttempts, lastError: lastError?.message },
  );
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Formats bytes to human readable format
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Truncates string to specified length
 */
export function truncate(str: string, maxLength: number, suffix: string = '...'): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Validates if string is valid JSON
 */
export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep clones an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Merges objects deeply
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  if (!sources.length) return target;

  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return deepMerge(target, ...sources);
}

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Sanitizes filename by removing invalid characters
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Generates a random ID
 */
export function generateId(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
