import { z } from 'zod';
import { exec, execFile } from 'child_process';
import util from 'util';
import { config } from '../config.js';
import { resolveGitHubOwnerRepo } from '../utils/gitInfo.js';

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

/**
 * GitHub Integration Tools
 * Private repo backup and synchronization
 */

/**
 * Gets GitHub token from config or environment
 */
function getGitHubToken(): string | null {
  return config.github?.token || process.env.GITHUB_TOKEN || null;
}

/**
 * Validates GitHub configuration
 * @param owner Optional owner override (uses config if not provided)
 * @param repo Optional repo override (uses config if not provided)
 */
function validateGitHubConfig(
  owner?: string,
  repo?: string,
): { valid: boolean; error?: string; owner?: string; repo?: string } {
  const resolved = resolveGitHubOwnerRepo(config.github?.owner, config.github?.repo);
  const resolvedOwner = owner || resolved?.owner;
  const resolvedRepo = repo || resolved?.repo;

  if (!config.github?.enabled && !owner && !repo) {
    return { valid: false, error: 'GitHub integration is disabled' };
  }

  if (!resolvedOwner || !resolvedRepo) {
    return {
      valid: false,
      error:
        'GitHub owner and repo information is missing (must be provided from config or parameters)',
    };
  }

  const token = getGitHubToken();
  if (!token) {
    return {
      valid: false,
      error: 'GitHub token not found (config.github.token or GITHUB_TOKEN env exists)',
    };
  }

  return { valid: true, owner: resolvedOwner, repo: resolvedRepo };
}

export const githubTools = [
  {
    name: 'github_setupRemote',
    description:
      'Configures GitHub remote repository (uses token for private repo). Dynamic repository can be selected with owner and repo parameters, otherwise config is used.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub repository owner (optional, config is used if not given)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name (optional, config is used if not given)',
        },
        force: {
          type: 'boolean',
          description: 'Override existing remote (default: false)',
        },
      },
    },
    handler: async (args: unknown) => {
      const {
        owner,
        repo,
        force = false,
      } = z
        .object({
          owner: z.string().optional(),
          repo: z.string().optional(),
          force: z.boolean().optional(),
        })
        .parse(args);

      const validation = validateGitHubConfig(owner, repo);
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ ${validation.error}`,
            },
          ],
          isError: true,
        };
      }

      const token = getGitHubToken()!;
      const repoOwner = validation.owner!;
      const repoName = validation.repo!;

      // GitHub remote URL with token
      const remoteUrl = `https://${token}@github.com/${repoOwner}/${repoName}.git`;

      try {
        // Check if remote already exists
        const { stdout: existingRemote } = await execAsync('git remote get-url origin').catch(
          () => ({ stdout: '' }),
        );

        if (existingRemote && !force) {
          return {
            content: [
              {
                type: 'text',
                text: `⚠️ Remote already exists: \${existingRemote.trim()}\\n\\nTo override: \\\`{"force": true}\\\``,
              },
            ],
          };
        }

        // Remove existing remote if force
        if (existingRemote && force) {
          await execAsync('git remote remove origin');
        }

        // Add new remote
        await execFileAsync('git', ['remote', 'add', 'origin', remoteUrl]);

        return {
          content: [
            {
              type: 'text',
              text: `✓ GitHub remote configured\\n\\n**Repository:** https://github.com/\${repoOwner}/\${repoName}\\n**Private:** \${config.github?.private ? '✓' : '✗'}`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Remote configuration error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: 'github_push',
    description:
      'Pushes changes to GitHub (for backup). Dynamic repository can be selected with owner and repo parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub repository owner (optional, config is used if not given)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name (optional, config is used if not given)',
        },
        message: {
          type: 'string',
          description: 'Commit message (if there are uncommitted changes)',
        },
        force: {
          type: 'boolean',
          description: 'Force push (use with care!)',
        },
      },
    },
    handler: async (args: unknown) => {
      const {
        owner,
        repo,
        message,
        force = false,
      } = z
        .object({
          owner: z.string().optional(),
          repo: z.string().optional(),
          message: z.string().optional(),
          force: z.boolean().optional(),
        })
        .parse(args);

      const validation = validateGitHubConfig(owner, repo);
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ ${validation.error}`,
            },
          ],
          isError: true,
        };
      }

      const repoOwner = validation.owner!;
      const repoName = validation.repo!;

      const results: string[] = [];

      try {
        // Check for uncommitted changes
        const { stdout: status } = await execAsync('git status --porcelain');

        if (status.trim() && message) {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          await execAsync('git add .');
          await execFileAsync('git', ['commit', '-m', message], { shell: false });
          results.push('✓ Changes committed');
        } else if (status.trim() && !message) {
          return {
            content: [
              {
                type: 'text',
                text: `⚠️ Uncommitted changes found. Commit message required: \\\`{"message": "your commit message"}\\\``,
              },
            ],
          };
        }

        // Push to GitHub
        const pushCmd = force ? 'git push -f origin main' : 'git push origin main';
        const { stderr } = await execAsync(pushCmd);

        results.push('✓ Pushed to GitHub');

        if (stderr && !stderr.includes('up-to-date')) {
          results.push(`\nOutput: ${stderr}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: `# GitHub Push\n\n${results.join('\n')}\n\n**Repository:** https://github.com/${repoOwner}/${repoName}`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Push error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: 'github_pull',
    description:
      'Pulls the latest changes from GitHub. Dynamic repository can be selected with owner and repo parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub repository owner (optional, config is used if not given)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name (optional, config is used if not given)',
        },
        force: {
          type: 'boolean',
          description: 'Force pull (overrides local changes, be careful!)',
        },
      },
    },
    handler: async (args: unknown) => {
      const {
        owner,
        repo,
        force = false,
      } = z
        .object({
          owner: z.string().optional(),
          repo: z.string().optional(),
          force: z.boolean().optional(),
        })
        .parse(args);

      const validation = validateGitHubConfig(owner, repo);
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ ${validation.error}`,
            },
          ],
          isError: true,
        };
      }

      try {
        if (force) {
          await execAsync('git fetch origin');
          await execAsync('git reset --hard origin/main');
          return {
            content: [
              {
                type: 'text',
                text: '✓ Force pulled from GitHub (local changes overridden)',
              },
            ],
          };
        } else {
          const { stdout, stderr } = await execAsync('git pull origin main');

          return {
            content: [
              {
                type: 'text',
                text: `✓ Pulled from GitHub\n\n${stdout || stderr}`,
              },
            ],
          };
        }
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Pull error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: 'github_status',
    description:
      'Shows GitHub sync status (ahead/behind commits). Dynamic repository can be selected with owner and repo parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub repository owner (optional, config is used if not given)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name (optional, config is used if not given)',
        },
      },
    },
    handler: async (args: unknown) => {
      const { owner, repo } = z
        .object({
          owner: z.string().optional(),
          repo: z.string().optional(),
        })
        .parse(args);

      const validation = validateGitHubConfig(owner, repo);
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ ${validation.error}`,
            },
          ],
          isError: true,
        };
      }

      const repoOwner = validation.owner!;
      const repoName = validation.repo!;

      try {
        // Fetch latest
        await execAsync('git fetch origin');

        // Get status, log and remote info in parallel
        const [{ stdout: status }, { stdout: log }, { stdout: remoteUrl }] = await Promise.all([
          execAsync('git status -sb'),
          execAsync('git log --oneline -5'),
          execAsync('git remote get-url origin').catch(() => ({ stdout: 'No remote configured' })),
        ]);

        const report =
          `# GitHub Status\n\n` +
          `**Remote:** ${remoteUrl.trim()}\n` +
          `**Repository:** https://github.com/${repoOwner}/${repoName}\n\n` +
          `## Branch Status\n\n\`\`\`\n${status}\n\`\`\`\n\n` +
          `## Recent Commits\n\n\`\`\`\n${log}\n\`\`\``;

        return {
          content: [
            {
              type: 'text',
              text: report,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Status check error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: 'github_createRepo',
    description:
      'Creates a private repository on GitHub (requires GitHub CLI: gh). Dynamic repository can be selected with owner and repo parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub repository owner (optional, config is used if not given)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name (optional, config is used if not given)',
        },
        description: {
          type: 'string',
          description: 'Repository description',
        },
      },
    },
    handler: async (args: unknown) => {
      const {
        owner,
        repo,
        description = 'MCP Server - Auto-created',
      } = z
        .object({
          owner: z.string().optional(),
          repo: z.string().optional(),
          description: z.string().optional(),
        })
        .parse(args);

      const validation = validateGitHubConfig(owner, repo);
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ ${validation.error}`,
            },
          ],
          isError: true,
        };
      }

      const repoOwner = validation.owner!;
      const repoName = validation.repo!;
      const isPrivate = config.github?.private ? '--private' : '--public';

      try {
        // Check if gh CLI is available
        await execAsync('gh --version').catch(() => {
          throw new Error('GitHub CLI (gh) not found. Please install: https://cli.github.com/');
        });

        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile) as (
          cmd: string,
          args: string[],
          opts?: { timeout?: number },
        ) => Promise<{ stdout: string; stderr: string }>;
        const { stdout: ghOutput } = await execFileAsync(
          'gh',
          [
            'repo',
            'create',
            repoName,
            isPrivate,
            '--description',
            description,
            '--source=.',
            '--remote=origin',
            '--push',
          ],
          { timeout: 60000 },
        );

        return {
          content: [
            {
              type: 'text',
              text: `✓ Repository created\n\n${ghOutput}\n\n**URL:** https://github.com/${repoOwner}/${repoName}`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Repository creation error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
];
