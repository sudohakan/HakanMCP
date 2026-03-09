/**
 * Report generator for completed missions.
 * Creates markdown summary reports persisted to data/reports/.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ReportData, MissionStepState } from './types.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'reportGenerator' });

/**
 * Convert milliseconds to human-readable duration string.
 * Examples: "2m 30s", "1h 15m", "45s", "0s"
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Convert epoch milliseconds to ISO string for display.
 */
export function formatTimestamp(epoch: number): string {
  return new Date(epoch).toISOString();
}

/**
 * Map step status to a plain-text indicator.
 */
function statusIndicator(status: string): string {
  switch (status) {
    case 'completed':
      return 'OK';
    case 'failed':
      return 'FAIL';
    case 'skipped':
      return 'SKIP';
    case 'pending':
      return 'PENDING';
    case 'running':
      return 'RUNNING';
    case 'evaluating':
      return 'EVALUATING';
    default:
      return status.toUpperCase();
  }
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/**
 * Build the step detail section for a single step.
 */
function buildStepSection(step: MissionStepState, index: number): string {
  const lines: string[] = [];
  lines.push(`### ${index + 1}. ${step.description}`);
  lines.push(`- **Status:** ${statusIndicator(step.status)}`);

  if (step.startedAt && step.completedAt) {
    lines.push(`- **Duration:** ${formatDuration(step.completedAt - step.startedAt)}`);
  } else {
    lines.push(`- **Duration:** N/A`);
  }

  lines.push(`- **Retries:** ${step.retryCount}`);

  if (step.result) {
    lines.push(`- **Result:** ${truncate(step.result, 500)}`);
  }

  if (step.error) {
    lines.push(`- **Error:** ${step.error}`);
  }

  return lines.join('\n');
}

/**
 * Generate a markdown report for a completed mission and write it to disk.
 *
 * @param data - Mission report data
 * @param outputDir - Directory to write the report file (e.g. "data/reports/")
 * @returns Full file path of the generated report
 */
export async function generateReport(data: ReportData, outputDir: string): Promise<string> {
  // 1. Ensure output directory exists
  await fs.promises.mkdir(outputDir, { recursive: true });

  // 2. Generate Windows-safe filename (no colons or dots from ISO string)
  const timestamp = new Date(data.completedAt).toISOString().replace(/[:.]/g, '-');
  const filename = `mission-${timestamp}.md`;
  const filePath = path.join(outputDir, filename);

  // 3. Compute summary metrics
  const totalSteps = data.tasks.length;
  const completedCount = data.tasks.filter((t) => t.status === 'completed').length;
  const failedCount = data.tasks.filter((t) => t.status === 'failed').length;
  const skippedCount = data.tasks.filter((t) => t.status === 'skipped').length;
  const totalRetries = data.tasks.reduce((sum, t) => sum + t.retryCount, 0);

  // 4. Build step sections
  const stepSections = data.tasks.map((step, i) => buildStepSection(step, i)).join('\n\n');

  // 5. Build learned patterns section
  let patternsSection: string;
  if (data.learnedPatterns.length > 0) {
    const patternRows = data.learnedPatterns
      .map((p) => `| ${p.pattern} | ${p.context} | ${p.usageCount} |`)
      .join('\n');
    patternsSection = `| Pattern | Context | Usage Count |
|---------|---------|-------------|
${patternRows}`;
  } else {
    patternsSection = 'No patterns learned during this mission.';
  }

  // 6. Build full report
  const report = `# Mission Report: ${data.title}

**Mission ID:** ${data.missionId}
**Status:** ${data.status}
**Provider:** ${data.provider}
**Started:** ${formatTimestamp(data.startedAt)}
**Completed:** ${formatTimestamp(data.completedAt)}
**Duration:** ${formatDuration(data.duration)}

## Summary

| Metric | Value |
|--------|-------|
| Total Steps | ${totalSteps} |
| Completed | ${completedCount} |
| Failed | ${failedCount} |
| Skipped | ${skippedCount} |
| Retries | ${totalRetries} |

## Steps

${stepSections}

## Learned Patterns

${patternsSection}

---
*Generated: ${new Date().toISOString()}*
*Report by HakanMCP Mission System*
`;

  // 7. Write report to file
  await fs.promises.writeFile(filePath, report, 'utf8');

  log.info('Mission report generated', { filePath, missionId: data.missionId });

  return filePath;
}
