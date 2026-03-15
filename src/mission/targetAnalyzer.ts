/**
 * Target file resolver and analyzer for assistant mode.
 * Resolves glob patterns, literal files, and directories into
 * size-capped file summaries suitable for system prompt injection.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AnalyzedFile, TargetAnalysis } from './types.js';

// Re-export types for convenience
export type { AnalyzedFile, TargetAnalysis } from './types.js';

// --- Constants ---

const MAX_TARGET_FILES = 10;
const MAX_SINGLE_FILE_BYTES = 4096;
const MAX_TOTAL_BYTES = 8192;

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.txt',
  '.css',
  '.html',
  '.py',
  '.sh',
  '.sql',
  '.env',
  '.toml',
  '.ini',
  '.xml',
  '.csv',
]);

// --- Helpers ---

/**
 * Check if a target string contains glob characters.
 */
function isGlob(target: string): boolean {
  return /[*?{}\[\]]/.test(target);
}

/**
 * Check if a file path has a known text extension.
 */
function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

// --- Resolution ---

/**
 * Resolve target strings (globs, literal files, directories) into
 * deduplicated absolute file paths, capped at MAX_TARGET_FILES.
 */
export function resolveTargets(targets: string[], cwd: string): string[] {
  const resolved = new Set<string>();

  for (const target of targets) {
    if (resolved.size >= MAX_TARGET_FILES) break;

    try {
      if (isGlob(target)) {
        // Glob pattern -- use Node 22+ native fs.globSync
        const matches = fs.globSync(target, { cwd });
        for (const match of matches) {
          if (resolved.size >= MAX_TARGET_FILES) break;
          resolved.add(path.resolve(cwd, match));
        }
      } else {
        const abs = path.resolve(cwd, target);
        if (!fs.existsSync(abs)) continue;

        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          // Directory -- list top-level contents (up to 5)
          const entries = fs.readdirSync(abs).slice(0, 5);
          for (const entry of entries) {
            if (resolved.size >= MAX_TARGET_FILES) break;
            const entryPath = path.join(abs, entry);
            try {
              if (fs.statSync(entryPath).isFile()) {
                resolved.add(entryPath);
              }
            } catch {
              // Skip inaccessible entries
            }
          }
        } else if (stat.isFile()) {
          resolved.add(abs);
        }
      }
    } catch {
      // Skip any target that fails to resolve
    }
  }

  return Array.from(resolved);
}

// --- Analysis ---

/**
 * Analyze resolved target files with size caps.
 * Reads file contents partially (up to MAX_SINGLE_FILE_BYTES per file,
 * MAX_TOTAL_BYTES overall). Binary and oversized files are skipped gracefully.
 */
export function analyzeTargets(targets: string[], cwd: string): TargetAnalysis {
  const filePaths = resolveTargets(targets, cwd);
  const files: AnalyzedFile[] = [];
  const errors: string[] = [];
  let totalSize = 0;
  let anyTruncated = false;

  for (const filePath of filePaths) {
    if (totalSize >= MAX_TOTAL_BYTES) {
      anyTruncated = true;
      break;
    }

    // Skip non-text files
    if (!isTextFile(filePath)) continue;

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const remaining = MAX_TOTAL_BYTES - totalSize;
      const readSize = Math.min(stat.size, MAX_SINGLE_FILE_BYTES, remaining);
      const truncated = readSize < stat.size;

      // Partial read using low-level API
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, 0);
      fs.closeSync(fd);

      let content = buffer.toString('utf-8');
      if (truncated) {
        content += '\n... [truncated]';
        anyTruncated = true;
      }

      const relativePath = path.relative(cwd, filePath);
      const ext = path.extname(filePath).replace('.', '');

      files.push({
        path: filePath,
        relativePath,
        size: stat.size,
        content,
        truncated,
        type: ext,
      });

      totalSize += readSize;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${path.relative(cwd, filePath)}: ${msg}`);
    }
  }

  // Build summary
  const summaryLines = files.map((f) => {
    const trunc = f.truncated ? ', truncated' : '';
    return `- ${f.relativePath} (${f.size}B${trunc})`;
  });
  const summary = summaryLines.join('\n');

  return { files, summary, totalSize, truncated: anyTruncated, errors };
}

// --- Block Builder ---

/**
 * Build a formatted text block of target file contents for system prompt injection.
 * Returns empty string if no files are found or all targets fail.
 */
export function buildTargetFilesBlock(targets: string[], cwd: string): string {
  const analysis = analyzeTargets(targets, cwd);

  if (analysis.files.length === 0) {
    return '';
  }

  const blocks = analysis.files.map((f) => {
    return `### ${f.relativePath}\n\`\`\`${f.type}\n${f.content}\n\`\`\``;
  });

  return blocks.join('\n\n');
}
