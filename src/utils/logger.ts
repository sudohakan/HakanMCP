/**
 * Structured logging utility with file and console output.
 * Plan §7: winston-daily-rotate-file for rotation (max 5 files, 20MB).
 */

import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { PROJECT_ROOT } from './projectRoot.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogContext {
  tool?: string;
  operation?: string;
  requestId?: string;
  taskId?: string;
  [key: string]: unknown;
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private context: LogContext = {};
  private logDir: string;
  private secretCache: string[] = [];
  private maskRegex: RegExp | null = null;
  private fileLogger!: winston.Logger;

  constructor() {
    this.logDir = process.env.LOG_DIR
      || path.join(PROJECT_ROOT, 'logs', 'general');
    this.ensureLogDir();
    this.initFileTransport();
    process.on('beforeExit', () => this.scheduleFlush());
  }

  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch {
      console.error(`Warning: Could not create log directory: ${this.logDir}`);
    }
  }

  private initFileTransport(): void {
    const transport = new DailyRotateFile({
      dirname: this.logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: 5,
      format: winston.format.printf(({ message }) => String(message)),
      auditFile: path.join(this.logDir, '.rotate-audit.json'),
    });
    transport.on('error', (err) => {
      console.error('Logger file transport error:', err);
    });
    this.fileLogger = winston.createLogger({
      transports: [transport],
      format: winston.format.printf(({ message }) => String(message)),
    });
  }

  private writeBuffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly BATCH_SIZE = 10;
  private static readonly FLUSH_MS = 100;

  /** Plan §11 H: Buffer writes to reduce syscalls; flush on batch size or timer. */
  private writeToFile(formatted: string): void {
    this.writeBuffer.push(formatted + '\n');
    if (this.writeBuffer.length >= Logger.BATCH_SIZE) {
      this.scheduleFlush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.scheduleFlush(), Logger.FLUSH_MS);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const toWrite = this.writeBuffer.splice(0, this.writeBuffer.length);
    if (toWrite.length === 0) return;
    try {
      this.fileLogger.info(toWrite.join(''));
    } catch {
      // If file write fails, continue; stderr already logged
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  clearContext(): void {
    this.context = {};
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log('DEBUG', message, meta);
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.level <= LogLevel.INFO) {
      this.log('INFO', message, meta);
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.level <= LogLevel.WARN) {
      this.log('WARN', message, meta);
    }
  }

  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    if (this.level <= LogLevel.ERROR) {
      const errorMeta = this.normalizeErrorMeta(error, meta);
      this.log('ERROR', message, errorMeta);
    }
  }

  private normalizeErrorMeta(error: Error | unknown, meta?: Record<string, unknown>) {
    if (error instanceof Error) {
      const stack = error.stack ? error.stack.replace(/\r?\n\s*/g, ' | ') : undefined;
      return {
        ...meta,
        error: {
          message: error.message,
          stack,
          name: error.name,
        },
      };
    }
    return { ...meta, error };
  }

  private log(level: string, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const normalizedMeta = meta ? JSON.parse(JSON.stringify(meta)) : undefined;
    const logData = {
      timestamp,
      level,
      message,
      ...this.context,
      ...normalizedMeta,
    };

    const sanitized = this.redactSecrets(logData);
    const formatted = JSON.stringify(sanitized);

    const isCliMode = process.env.HAKANMCP_CLI === '1';
    const isDetailed = process.argv.includes('-d') || process.argv.includes('--detailed');

    if (isCliMode) {
      if (isDetailed) {
        const rest = { ...(sanitized as Record<string, unknown>) };
        delete rest.timestamp;
        delete rest.level;
        delete rest.message;
        const metaStr = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
        console.error(`\x1b[90m\x1b[3m  › [${level}] ${message}${metaStr}\x1b[0m`);
      }
    } else {
      // CRITICAL: MCP STDIO transport uses STDOUT for JSON-RPC messages.
      // ALL logs must go to STDERR to avoid protocol corruption.
      console.error(formatted);
    }

    // Also write to log file (tool/operation in JSON for filtering)
    try {
      this.writeToFile(formatted);
    } catch {
      // Ignore errors in logging to prevent crashing
    }
  }

  /**
   * Creates a child logger with additional context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.setLevel(this.level);
    childLogger.setContext({ ...this.context, ...context });
    return childLogger;
  }

  private loadSecretCache(): void {
    if (this.secretCache.length > 0) return;

    const envSecrets = Object.entries(process.env)
      .filter(([key, value]) => {
        const lower = key.toLowerCase();
        return (
          value &&
          (lower.includes('token') ||
            lower.includes('secret') ||
            lower.includes('password') ||
            lower.includes('apikey') ||
            lower.includes('api_key'))
        );
      })
      .map(([, value]) => value as string);

    this.secretCache = envSecrets.filter(Boolean);

    if (this.secretCache.length > 0) {
      const escaped = this.secretCache
        .filter(Boolean)
        .sort((a, b) => b.length - a.length) // Longer first to avoid substring partial matches
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      this.maskRegex = new RegExp(escaped, 'g');
    } else {
      this.maskRegex = null;
    }
  }

  /** Plan §H: Pre-compiled regex to avoid per-call RegExp compilation */
  private maskString(input: string): string {
    if (input.length === 0) return input;
    this.loadSecretCache();

    if (!this.maskRegex) return input;
    return input.replace(this.maskRegex, '***');
  }

  private redactSecrets<T>(value: T, seen = new WeakSet<object>()): T {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return this.maskString(value) as unknown as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactSecrets(item, seen)) as unknown as T;
    }

    if (typeof value === 'object') {
      if (seen.has(value as object)) return '[Circular]' as unknown as T;
      seen.add(value as object);
      const output: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (this.isSecretKey(key)) {
          output[key] = val ? '***' : val;
        } else {
          output[key] = this.redactSecrets(val, seen);
        }
      }
      return output as unknown as T;
    }

    return value;
  }

  /** Plan §9: key, token, password pattern masking */
  private isSecretKey(key: string): boolean {
    const lower = key.toLowerCase();
    return (
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('apikey') ||
      lower.includes('api_key') ||
      (lower.includes('key') && (lower === 'key' || lower.endsWith('_key')))
    );
  }
}

// Export singleton instance
export const logger = new Logger();

// Set log level from environment
if (process.env.LOG_LEVEL) {
  const envLevel = process.env.LOG_LEVEL.toUpperCase();
  if (envLevel in LogLevel) {
    logger.setLevel(LogLevel[envLevel as keyof typeof LogLevel]);
  }
}
