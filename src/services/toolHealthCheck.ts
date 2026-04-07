/**
 * Tool Health Check Service — validates all MCP tools daily.
 *
 * Checks per tool:
 * - handler exists and is a function
 * - inputSchema is a valid object with type: 'object'
 * - name and description are non-empty strings
 *
 * Results are persisted to logs/tool-health.json.
 * Doctor and /doctor read this file for reporting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export interface ToolHealthResult {
  name: string;
  status: 'pass' | 'fail';
  error?: string;
}

export interface ToolHealthReport {
  checkedAt: string;
  totalTools: number;
  passed: number;
  failed: number;
  results: ToolHealthResult[];
}

interface ToolEntry {
  name: string;
  description?: string;
  inputSchema?: unknown;
  handler?: unknown;
}

const REPORT_PATH_REL = path.join('logs', 'tool-health.json');

export function getReportPath(projectRoot: string): string {
  return path.join(projectRoot, REPORT_PATH_REL);
}

/** Run health check on all tools and persist report */
export function runToolHealthCheck(tools: ToolEntry[], projectRoot: string): ToolHealthReport {
  const results: ToolHealthResult[] = [];

  for (const tool of tools) {
    const checks: string[] = [];

    if (!tool.name || typeof tool.name !== 'string') {
      checks.push('missing or invalid name');
    }
    if (!tool.description || typeof tool.description !== 'string') {
      checks.push('missing description');
    }
    if (typeof tool.handler !== 'function') {
      checks.push('handler is not a function');
    }
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
      checks.push('missing inputSchema');
    } else {
      const schema = tool.inputSchema as Record<string, unknown>;
      if (schema.type !== 'object') {
        checks.push('inputSchema.type is not "object"');
      }
    }

    results.push({
      name: tool.name || '(unnamed)',
      status: checks.length === 0 ? 'pass' : 'fail',
      error: checks.length > 0 ? checks.join('; ') : undefined,
    });
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const report: ToolHealthReport = {
    checkedAt: new Date().toISOString(),
    totalTools: results.length,
    passed,
    failed: results.length - passed,
    results,
  };

  try {
    const reportPath = getReportPath(projectRoot);
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    logger.info('Tool health check completed', { total: report.totalTools, passed, failed: report.failed });
  } catch (err) {
    logger.warn('Failed to persist tool health report', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  return report;
}

/** Read the last persisted report (or null if none) */
export function readToolHealthReport(projectRoot: string): ToolHealthReport | null {
  try {
    const reportPath = getReportPath(projectRoot);
    if (!fs.existsSync(reportPath)) return null;
    return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ToolHealthReport;
  } catch {
    return null;
  }
}

/** Check if we need to run a health check today */
export function shouldRunToday(projectRoot: string): boolean {
  const report = readToolHealthReport(projectRoot);
  if (!report) return true;
  const lastCheck = new Date(report.checkedAt);
  const now = new Date();
  return lastCheck.toDateString() !== now.toDateString();
}

/** Schedule daily health check. Returns cleanup function. */
export function scheduleDailyHealthCheck(
  tools: ToolEntry[],
  projectRoot: string,
): () => void {
  if (shouldRunToday(projectRoot)) {
    runToolHealthCheck(tools, projectRoot);
  }

  const interval = setInterval(() => {
    if (shouldRunToday(projectRoot)) {
      runToolHealthCheck(tools, projectRoot);
    }
  }, 60 * 60 * 1000);

  return () => clearInterval(interval);
}
