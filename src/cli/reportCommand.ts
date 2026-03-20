/**
 * `hakanmcp report` command handler.
 * Lists recent mission reports from data/reports/ directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

const SUCCESS = '#00D68F';
const INFO = '#6C5CE7';
const MUTED = '#8395A7';

const REPORTS_DIR = 'data/reports';
const DEFAULT_COUNT = 5;

/**
 * List recent mission reports.
 */
export async function runReport(options: { n?: string }): Promise<void> {
  const cwd = process.cwd();
  const reportsDir = path.join(cwd, REPORTS_DIR);

  if (!fs.existsSync(reportsDir)) {
    console.log(chalk.hex(MUTED)('No reports found. Complete a mission to generate reports.'));
    return;
  }

  let files: string[];
  try {
    files = fs.readdirSync(reportsDir).filter((f) => f.endsWith('.md'));
  } catch {
    console.log(chalk.hex(MUTED)('No reports found.'));
    return;
  }

  if (files.length === 0) {
    console.log(chalk.hex(MUTED)('No reports found. Complete a mission to generate reports.'));
    return;
  }

  const fileStats = files
    .map((f) => {
      const fullPath = path.join(reportsDir, f);
      try {
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, mtime: stat.mtime };
      } catch {
        return null;
      }
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const count = options.n ? parseInt(options.n, 10) : DEFAULT_COUNT;
  const limit = Number.isFinite(count) && count > 0 ? count : DEFAULT_COUNT;
  const selected = fileStats.slice(0, limit);

  console.log();
  console.log(chalk.bold(`Recent Reports (${selected.length}/${fileStats.length}):`));
  console.log();

  for (const file of selected) {
    let title = '';
    try {
      const content = fs.readFileSync(file.path, 'utf8');
      const firstLine = content.split('\n').find((line) => line.trim().length > 0);
      title = firstLine ? firstLine.replace(/^#+\s*/, '').trim() : file.name;
    } catch {
      title = file.name;
    }

    const date = file.mtime.toISOString().replace('T', ' ').slice(0, 19);
    console.log(`  ${chalk.hex(SUCCESS)(file.name)}`);
    console.log(`    ${chalk.hex(INFO)(title)}`);
    console.log(`    ${chalk.hex(MUTED)(date)}`);
    console.log();
  }
}
