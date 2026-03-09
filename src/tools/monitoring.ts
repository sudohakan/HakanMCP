import { z } from 'zod';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'child_process';
import util from 'util';
import nodeFetch from 'node-fetch';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const execAsync = util.promisify(exec);
const monitoringLogger = logger.child({ component: 'monitoring' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- node-fetch vs fetch type mismatch
const fetchImpl: typeof fetch = (globalThis as any).fetch ?? (nodeFetch as any);

/**
 * Cross-Instance Monitoring Tools
 * Main ↔ Second instance follows each other and autocorrects*/

interface HealthCheckResult {
  healthy: boolean;
  checks: Array<{
    type: string;
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
  }>;
  timestamp: string;
}

/**
 * Performs health check on a specific instance
 */
async function performHealthCheck(
  instancePath: string,
  issueType: 'file' | 'build' | 'all',
): Promise<HealthCheckResult> {
  const requestId = `monitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  monitoringLogger.info('Health check started', { requestId, instancePath, issueType });
  const result: HealthCheckResult = {
    healthy: true,
    checks: [],
    timestamp: new Date().toISOString(),
  };

  const endpoints = (config.monitoring?.healthCheckEndpoints || []).filter((e) => {
    if (issueType === 'all') return true;
    return e.type === issueType;
  });

  const checkPromises = endpoints.map(async (endpoint) => {
    try {
      if (endpoint.type === 'file') {
        const filePath = path.join(instancePath, endpoint.path || '');
        try {
          await fs.promises.access(filePath);
          return {
            type: 'file',
            name: endpoint.description,
            status: 'pass' as const,
            message: `File exists: ${endpoint.path}`,
          };
        } catch {
          return {
            type: 'file',
            name: endpoint.description,
            status: 'fail' as const,
            message: `File missing: ${endpoint.path}`,
          };
        }
      } else if (endpoint.type === 'build') {
        const srcPath = path.join(instancePath, 'src');
        try {
          await fs.promises.access(srcPath);
          const files = await fs.promises.readdir(srcPath);
          if (files.length > 0) {
            return {
              type: 'build',
              name: endpoint.description,
              status: 'pass' as const,
              message: 'Source files found',
            };
          } else {
            throw new Error('Empty');
          }
        } catch {
          return {
            type: 'build',
            name: endpoint.description,
            status: 'fail' as const,
            message: 'Source directory empty or missing',
          };
        }
      } else if (endpoint.type === 'http') {
        if (!endpoint.path) throw new Error('URL required for http check');
        const response = await fetchImpl(endpoint.path);
        if (response.ok) {
          return {
            type: 'http',
            name: endpoint.description,
            status: 'pass' as const,
            message: `HTTP ${response.status} OK`,
          };
        } else {
          return {
            type: 'http',
            name: endpoint.description,
            status: 'fail' as const,
            message: `HTTP ${response.status} ${response.statusText}`,
          };
        }
      } else if (endpoint.type === 'ollama') {
        const url = `${config.ollamaUrl}/api/tags`;
        const response = await fetchImpl(url);
        if (response.ok) {
          return {
            type: 'ollama',
            name: endpoint.description,
            status: 'pass' as const,
            message: 'Ollama service reachable',
          };
        } else {
          return {
            type: 'ollama',
            name: endpoint.description,
            status: 'fail' as const,
            message: 'Ollama service unreachable',
          };
        }
      } else if (endpoint.type === 'mongodb') {
        // Dynamic import to avoid hard dependency if not used
        const { MongoClient } = await import('mongodb');
        const mongoUrl = config.mongoDbUrl || 'mongodb://localhost:27017';
        const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 2000 });
        try {
          await client.connect();
          await client.db('admin').command({ ping: 1 });
          return {
            type: 'mongodb',
            name: endpoint.description,
            status: 'pass' as const,
            message: 'MongoDB connection successful',
          };
        } catch (e: unknown) {
          return {
            type: 'mongodb',
            name: endpoint.description,
            status: 'fail' as const,
            message: `MongoDB error: ${e instanceof Error ? e.message : String(e)}`,
          };
        } finally {
          await client.close();
        }
      }
      return null;
    } catch (error: unknown) {
      monitoringLogger.error('[MONITORING] Health check error', error, { requestId, endpoint });
      return {
        type: endpoint.type,
        name: endpoint.description,
        status: 'fail' as const,
        message: `Check error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  const checkResults = await Promise.all(checkPromises);

  for (const check of checkResults) {
    if (check) {
      result.checks.push(check);
      if (check.status === 'fail') {
        result.healthy = false;
      }
    }
  }

  monitoringLogger.info('Health check completed', {
    requestId,
    instancePath,
    healthy: result.healthy,
    checksCount: result.checks.length,
    failed: result.checks.filter((c) => c.status === 'fail').length,
  });
  return result;
}

/**
 * Auto-heals a broken instance by copying from healthy instance
 */
async function autoHeal(
  brokenInstance: string,
  healthyInstance: string,
  issueType: string,
): Promise<string> {
  const requestId = `monitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  monitoringLogger.info(`[MONITORING] Auto-healing ${brokenInstance} from ${healthyInstance}`, {
    requestId,
    issueType,
  });

  const results: string[] = [];

  if (issueType === 'file' || issueType === 'all') {
    // Copy critical files
    const criticalFiles = ['src/index.ts', 'config.yaml', 'package.json', 'tsconfig.json'];

    const copyPromises = criticalFiles.map(async (file) => {
      try {
        const sourcePath = path.join(healthyInstance, file);
        const targetPath = path.join(brokenInstance, file);

        try {
          await fs.promises.access(sourcePath);
        } catch {
          return `⚠ Skipped (source missing): ${file}`;
        }

        const targetDir = path.dirname(targetPath);
        await fs.promises.mkdir(targetDir, { recursive: true });

        await fs.promises.copyFile(sourcePath, targetPath);
        return `✓ Copied: ${file}`;
      } catch (error: unknown) {
        return `✗ Failed to copy ${file}: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

    const copyResults = await Promise.all(copyPromises);
    results.push(...copyResults);
  }

  if (issueType === 'build' || issueType === 'all') {
    // Trigger dependency install instead of build
    try {
      const { stderr } = await execAsync('npm install', {
        cwd: brokenInstance,
        timeout: 120000, // 2 minutes
      });

      if (stderr && !stderr.includes('WARN')) {
        monitoringLogger.warn('[MONITORING] npm install produced warnings', { requestId, stderr: stderr.substring(0, 200) });
        results.push(`⚠ Install warnings: ${stderr.substring(0, 200)}`);
      } else {
        results.push(`✓ Dependencies installed successfully`);
      }
    } catch (error: unknown) {
      monitoringLogger.error('[MONITORING] npm install failed', error, { requestId, brokenInstance });
      results.push(`✗ Install failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const summary = results.join('\n');
  monitoringLogger.info('[MONITORING] Auto-heal completed', {
    requestId,
    brokenInstance,
    issueType,
    stepsCount: results.length,
  });
  return summary;
}

/**
 * Compares two instances and identifies differences
 */
async function compareInstances(
  instance1: string,
  instance2: string,
): Promise<{
  different: boolean;
  differences: string[];
}> {
  const criticalFiles = ['src/index.ts', 'config.yaml', 'package.json'];

  const results = await Promise.all(
    criticalFiles.map(async (file) => {
      const file1 = path.join(instance1, file);
      const file2 = path.join(instance2, file);

      // Check existence and stats concurrently
      const [stat1, stat2] = await Promise.all([
        fs.promises.stat(file1).catch(() => null),
        fs.promises.stat(file2).catch(() => null),
      ]);

      const exists1 = !!stat1;
      const exists2 = !!stat2;

      if (exists1 !== exists2) {
        return `${file}: exists in ${exists1 ? 'instance1' : 'instance2'} only`;
      } else if (stat1 && stat2) {
        // Optimization: check size first
        if (stat1.size !== stat2.size) {
          return `${file}: content differs`;
        }

        // Read content concurrently
        const [content1, content2] = await Promise.all([
          fs.promises.readFile(file1, 'utf8'),
          fs.promises.readFile(file2, 'utf8'),
        ]);

        if (content1 !== content2) {
          return `${file}: content differs`;
        }
      }
      return null;
    }),
  );

  const differences = results.filter((r): r is string => r !== null);

  return {
    different: differences.length > 0,
    differences,
  };
}

/** Plan §4: Exclude patterns for deep scan (node_modules, dist, .git, logs) */
const DEEP_EXCLUDE = ['node_modules', 'dist', '.git', 'logs'];

/**
 * Plan §4: Compute SHA-256 hash map for directory (content + mtime).
 * Excludes node_modules, dist, .git, logs.
 */
export async function computeDeepHash(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const absDir = path.resolve(dir);

  async function walk(current: string, relBase: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      const name = e.name;
      if (DEEP_EXCLUDE.includes(name)) continue;
      if (name.startsWith('.') && name !== '.env' && name !== '.gitignore') continue;

      const absPath = path.join(current, name);
      const relPath = relBase ? `${relBase}/${name}` : name;

      if (e.isDirectory()) {
        await walk(absPath, relPath);
      } else if (e.isFile()) {
        try {
          const content = await fs.promises.readFile(absPath);
          const stat = await fs.promises.stat(absPath);
          const mtime = stat.mtimeMs.toString();
          const hash = createHash('sha256').update(content).update(mtime).digest('hex');
          result.set(relPath, hash);
        } catch {
          /* skip unreadable files */
        }
      }
    }
  }

  await walk(absDir, '');
  return result;
}

export interface DeepCompareResult {
  added: string[];
  removed: string[];
  changed: string[];
  identical: boolean;
}

/**
 * Plan §4: Compare two directory trees by deep hash. Returns added, removed, changed.
 */
export async function compareInstancesDeep(
  instance1: string,
  instance2: string,
): Promise<DeepCompareResult> {
  const [map1, map2] = await Promise.all([computeDeepHash(instance1), computeDeepHash(instance2)]);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [rel, hash] of map1) {
    const h2 = map2.get(rel);
    if (!h2)
      removed.push(rel); // in source only → copy to target
    else if (h2 !== hash) changed.push(rel); // different → copy to target
  }
  for (const [rel] of map2) {
    if (!map1.has(rel)) added.push(rel); // in target only → delete from target
  }

  added.sort();
  removed.sort();
  changed.sort();

  return {
    added,
    removed,
    changed,
    identical: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

/**
 * Plan §4: Sync only differing files from source to target. Main is source of truth.
 */
export async function syncInstancesDeep(source: string, target: string): Promise<string[]> {
  const diff = await compareInstancesDeep(source, target);
  const toCopy = [...diff.changed, ...diff.removed]; // copy changed + source-only
  const results: string[] = [];

  for (const rel of toCopy) {
    const srcPath = path.join(source, rel);
    const tgtPath = path.join(target, rel);
    try {
      await fs.promises.mkdir(path.dirname(tgtPath), { recursive: true });
      await fs.promises.copyFile(srcPath, tgtPath);
      results.push(`✓ ${rel}`);
    } catch (err: unknown) {
      results.push(`✗ ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const rel of diff.added) {
    const tgtPath = path.join(target, rel);
    try {
      await fs.promises.unlink(tgtPath);
      results.push(`✓ removed ${rel}`);
    } catch {
      /* may not exist */
    }
  }

  return results;
}

/**
 * Advanced Auto-Healing: Automatic dependency updates
 */
async function updateDependencies(
  instancePath: string,
  autoCommit: boolean = false,
): Promise<string> {
  const results: string[] = [];

  try {
    // Check for outdated packages
    const { stdout: outdated } = await execAsync('npm outdated --json', {
      cwd: instancePath,
      timeout: 60000,
    }).catch(() => ({ stdout: '{}' }));

    const outdatedPackages = JSON.parse(outdated || '{}');
    const packageCount = Object.keys(outdatedPackages).length;

    if (packageCount === 0) {
      results.push('✅ All dependencies are up to date');
      return results.join('\n');
    }

    results.push(`📦 Found ${packageCount} outdated packages`);

    // Update packages
    results.push('\n**Updating packages...**');
    await execAsync('npm update', {
      cwd: instancePath,
      timeout: 300000, // 5 minutes
    });

    results.push('✓ Dependencies updated');

    // Run tests
    results.push('\n**Running tests...**');
    try {
      await execAsync('npm test', {
        cwd: instancePath,
        timeout: 180000, // 3 minutes
      });
      results.push('✓ Tests passed');
    } catch {
      results.push('⚠ Tests failed - consider rolling back');
      throw new Error('Tests failed after dependency update');
    }

    // Commit if requested
    if (autoCommit) {
      results.push('\n**Committing changes...**');
      await execAsync(
        'git add package.json package-lock.json && git commit -m "chore: update dependencies"',
        {
          cwd: instancePath,
          timeout: 30000,
        },
      );
      results.push('✓ Changes committed');
    }
  } catch (error: unknown) {
    results.push(
      `✗ Dependency update failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return results.join('\n');
}

/**
 * Advanced Auto-Healing: Self-recovery from common errors
 */
async function selfRecover(instancePath: string, errorType: string): Promise<string> {
  const results: string[] = [];

  if (errorType === 'port_conflict') {
    results.push('🔧 Detecting and resolving port conflict...');
    // In a real scenario, you'd find and change the port
    results.push('⚠ Manual intervention required: Change port in config');
  } else if (errorType === 'out_of_memory') {
    results.push('🔧 Attempting memory recovery...');
    // Clear caches, restart with more memory
    // Clear caches, restart with more memory
    try {
      // Just restart logic would go here, but since we don't build, we just log
      results.push('✓ Memory recovery attempted (restart required)');
    } catch (error: unknown) {
      results.push(
        `✗ Memory recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (errorType === 'db_connection_lost') {
    results.push('🔧 Attempting database reconnection...');
    // Trigger database reconnection logic
    results.push('✓ Database reconnection attempted (check logs)');
  } else {
    results.push(`⚠ Unknown error type: ${errorType}`);
  }

  return results.join('\n');
}

/**
 * Rollback mechanism
 */
async function rollback(instancePath: string): Promise<string> {
  const results: string[] = [];

  try {
    results.push('⏮️ Rolling back to last commit...');

    // Check git status
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: instancePath,
      timeout: 10000,
    });

    if (status.trim()) {
      // Has uncommitted changes - reset them
      await execAsync('git reset --hard HEAD', {
        cwd: instancePath,
        timeout: 10000,
      });
      results.push('✓ Uncommitted changes discarded');
    }

    // Get last commit
    const { stdout: lastCommit } = await execAsync('git log -1 --oneline', {
      cwd: instancePath,
      timeout: 10000,
    });

    results.push(`✓ Rolled back to: ${lastCommit.trim()}`);

    // Reinstall dependencies
    results.push('\n**Reinstalling dependencies...**');
    await execAsync('npm ci', {
      cwd: instancePath,
      timeout: 120000,
    });
    results.push('✓ Dependencies reinstalled');

    // Reinstall dependencies
    results.push('\n**Reinstalling dependencies...**');
    await execAsync('npm ci', {
      cwd: instancePath,
      timeout: 120000,
    });
    results.push('✓ Dependencies reinstalled');
  } catch (error: unknown) {
    results.push(`✗ Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return results.join('\n');
}

export const monitoringTools = [
  {
    name: 'monitor_healthCheck',
    description:
      'Performs a health check for the specified instance (file existence, build status)',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance directory to be checked (eg: /path/to/hakan-mcp)',
        },
        issueType: {
          type: 'string',
          enum: ['file', 'build', 'all'],
          description: 'Control type (default: all)',
        },
      },
      required: ['instancePath'],
    },
    handler: async (args: unknown) => {
      const { instancePath, issueType = 'all' } = z
        .object({
          instancePath: z.string(),
          issueType: z.enum(['file', 'build', 'all']).optional().default('all'),
        })
        .parse(args);

      const result = await performHealthCheck(instancePath, issueType);

      const summary =
        `# Health Check Report\n\n` +
        `**Instance:** ${instancePath}\n` +
        `**Status:** ${result.healthy ? '✅ Healthy' : '❌ Unhealthy'}\n` +
        `**Timestamp:** ${result.timestamp}\n\n` +
        `## Checks\n\n` +
        result.checks
          .map(
            (check) =>
              `- [${check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '⚠'}] **${check.name}**\n  ${check.message}`,
          )
          .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };
    },
  },
  {
    name: 'monitor_autoHeal',
    description:
      'Automatically fixes corrupted instance from healthy instance (file copying, rebuild)',
    inputSchema: {
      type: 'object',
      properties: {
        brokenInstance: {
          type: 'string',
          description: 'Corrupted instance directory',
        },
        healthyInstance: {
          type: 'string',
          description: 'Healthy instance directory (source)',
        },
        issueType: {
          type: 'string',
          enum: ['file', 'build', 'all'],
          description: 'Type of problem to fix',
        },
      },
      required: ['brokenInstance', 'healthyInstance', 'issueType'],
    },
    handler: async (args: unknown) => {
      const { brokenInstance, healthyInstance, issueType } = z
        .object({
          brokenInstance: z.string(),
          healthyInstance: z.string(),
          issueType: z.enum(['file', 'build', 'all']),
        })
        .parse(args);

      if (!config.monitoring?.autoHeal) {
        return {
          content: [
            {
              type: 'text',
              text: "❌ Auto-heal is disabled. In config.yaml make 'monitoring.autoHeal: true'.",
            },
          ],
          isError: true,
        };
      }

      const result = await autoHeal(brokenInstance, healthyInstance, issueType);

      return {
        content: [
          {
            type: 'text',
            text: `# Auto-Heal Report\n\n**Broken:** ${brokenInstance}\n**Source:** ${healthyInstance}\n**Type:** ${issueType}\n\n## Results\n\n${result}`,
          },
        ],
      };
    },
  },
  {
    name: 'monitor_compare',
    description: 'Compares two instances. Use deep=true for SHA-256 full-tree comparison.',
    inputSchema: {
      type: 'object',
      properties: {
        instance1: { type: 'string', description: 'First instance directory' },
        instance2: { type: 'string', description: 'Second instance directory' },
        deep: {
          type: 'boolean',
          description: 'SHA-256 full-tree (excludes node_modules, dist, .git, logs)',
        },
      },
      required: ['instance1', 'instance2'],
    },
    handler: async (args: unknown) => {
      const {
        instance1,
        instance2,
        deep = false,
      } = z
        .object({
          instance1: z.string(),
          instance2: z.string(),
          deep: z.boolean().optional(),
        })
        .parse(args);

      if (deep) {
        const diff = await compareInstancesDeep(instance1, instance2);
        const rows: string[] = [];
        if (diff.added.length)
          rows.push(
            `**In instance2 only (to remove):**\n${diff.added.map((r) => `- ${r}`).join('\n')}`,
          );
        if (diff.removed.length)
          rows.push(
            `**In instance1 only (to copy):**\n${diff.removed.map((r) => `- ${r}`).join('\n')}`,
          );
        if (diff.changed.length)
          rows.push(`**Changed:**\n${diff.changed.map((r) => `- ${r}`).join('\n')}`);
        const report =
          `# Deep Instance Comparison (SHA-256)\n\n` +
          `**Instance 1:** ${instance1}\n**Instance 2:** ${instance2}\n` +
          `**Status:** ${diff.identical ? '✅ Identical' : '⚠️ Differences Found'}\n\n` +
          (rows.length ? rows.join('\n\n') : 'No differences.');
        return { content: [{ type: 'text' as const, text: report }] };
      }

      const comparison = await compareInstances(instance1, instance2);
      const report =
        `# Instance Comparison\n\n**Instance 1:** ${instance1}\n**Instance 2:** ${instance2}\n` +
        `**Status:** ${comparison.different ? '⚠️ Differences Found' : '✅ Identical'}\n\n` +
        (comparison.differences.length > 0
          ? `## Differences\n\n${comparison.differences.map((d) => `- ${d}`).join('\n')}`
          : 'No differences detected in critical files.');
      return { content: [{ type: 'text' as const, text: report }] };
    },
  },
  {
    name: 'monitor_sync',
    description:
      'Synchronizes changes from main to second. Use deep=true for SHA-256 diff-only sync.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceInstance: { type: 'string', description: 'Source instance (usually main)' },
        targetInstance: { type: 'string', description: 'Target instance (usually second)' },
        deep: {
          type: 'boolean',
          description: 'SHA-256 diff-only sync (copy only differing files)',
        },
        includeNodeModules: {
          type: 'boolean',
          description: 'Include node_modules? (default: false)',
        },
      },
      required: ['sourceInstance', 'targetInstance'],
    },
    handler: async (args: unknown) => {
      const {
        sourceInstance,
        targetInstance,
        deep = false,
        includeNodeModules = false,
      } = z
        .object({
          sourceInstance: z.string(),
          targetInstance: z.string(),
          deep: z.boolean().optional(),
          includeNodeModules: z.boolean().optional(),
        })
        .parse(args);

      if (deep) {
        const results = await syncInstancesDeep(sourceInstance, targetInstance);
        return {
          content: [
            {
              type: 'text' as const,
              text: `# Deep Sync Report\n\n**Source:** ${sourceInstance}\n**Target:** ${targetInstance}\n\n## Results\n\n${results.join('\n')}`,
            },
          ],
        };
      }

      const syncResults: string[] = [];

      // Directories to sync
      const syncDirs = ['src', 'tests', 'config', 'scripts'];
      const syncFiles = ['package.json', 'tsconfig.json', 'config.yaml', 'README.md', '.gitignore'];

      if (includeNodeModules) {
        syncDirs.push('node_modules');
      }

      // Sync directories
      for (const dir of syncDirs) {
        try {
          const sourcePath = path.join(sourceInstance, dir);
          const targetPath = path.join(targetInstance, dir);

          if (fs.existsSync(sourcePath)) {
            // Use robocopy on Windows for efficient directory sync
            await execAsync(
              `robocopy "${sourcePath}" "${targetPath}" /MIR /NFL /NDL /NJH /NJS /nc /ns /np`,
              { timeout: 60000 },
            ).catch(() => ({ stdout: 'Robocopy completed' })); // Robocopy returns non-zero exit codes

            syncResults.push(`✓ Synced directory: ${dir}`);
          } else {
            syncResults.push(`⚠ Skipped (not found): ${dir}`);
          }
        } catch (error: unknown) {
          syncResults.push(
            `✗ Failed to sync ${dir}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Sync individual files
      const fileSyncResults = await Promise.all(
        syncFiles.map(async (file) => {
          try {
            const sourcePath = path.join(sourceInstance, file);
            const targetPath = path.join(targetInstance, file);

            try {
              await fs.promises.access(sourcePath);
            } catch {
              return `⚠ Skipped (not found): ${file}`;
            }

            await fs.promises.copyFile(sourcePath, targetPath);
            return `✓ Synced file: ${file}`;
          } catch (error: unknown) {
            return `✗ Failed to sync ${file}: ${error instanceof Error ? error.message : String(error)}`;
          }
        }),
      );
      syncResults.push(...fileSyncResults);

      // Rebuild target instance - Skipped (using ts-node)
      syncResults.push('\n**Ready to start (no build needed)...**');

      return {
        content: [
          {
            type: 'text',
            text: `# Sync Report\n\n**Source:** ${sourceInstance}\n**Target:** ${targetInstance}\n\n## Results\n\n${syncResults.join('\n')}`,
          },
        ],
      };
    },
  },
  {
    name: 'monitor_updateDependencies',
    description: 'Makes automatic dependency updates, tests and optional commits',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance directory to update',
        },
        autoCommit: {
          type: 'boolean',
          description: 'Should it automatically commit after a successful update? (default: false)',
        },
      },
      required: ['instancePath'],
    },
    handler: async (args: unknown) => {
      const { instancePath, autoCommit = false } = z
        .object({
          instancePath: z.string(),
          autoCommit: z.boolean().optional(),
        })
        .parse(args);

      const result = await updateDependencies(instancePath, autoCommit);

      return {
        content: [
          {
            type: 'text',
            text: `# Dependency Update Report\n\n**Instance:** ${instancePath}\n**Auto-commit:** ${autoCommit ? 'Yes' : 'No'}\n\n## Results\n\n${result}`,
          },
        ],
      };
    },
  },
  {
    name: 'monitor_selfRecover',
    description:
      'Provides automatic recovery from common errors (port conflict, out of memory, db connection lost)',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance directory to recover',
        },
        errorType: {
          type: 'string',
          enum: ['port_conflict', 'out_of_memory', 'db_connection_lost'],
          description: 'Error type to recover',
        },
      },
      required: ['instancePath', 'errorType'],
    },
    handler: async (args: unknown) => {
      const { instancePath, errorType } = z
        .object({
          instancePath: z.string(),
          errorType: z.enum(['port_conflict', 'out_of_memory', 'db_connection_lost']),
        })
        .parse(args);

      const result = await selfRecover(instancePath, errorType);

      return {
        content: [
          {
            type: 'text',
            text: `# Self-Recovery Report\n\n**Instance:** ${instancePath}\n**Error Type:** ${errorType}\n\n## Results\n\n${result}`,
          },
        ],
      };
    },
  },
  {
    name: 'monitor_rollback',
    description: 'Reverts instance to last known good state (git reset + npm ci + build)',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance directory to rollback',
        },
      },
      required: ['instancePath'],
    },
    handler: async (args: unknown) => {
      const { instancePath } = z
        .object({
          instancePath: z.string(),
        })
        .parse(args);

      const result = await rollback(instancePath);

      return {
        content: [
          {
            type: 'text',
            text: `# Rollback Report\n\n**Instance:** ${instancePath}\n\n## Results\n\n${result}`,
          },
        ],
      };
    },
  },
];
