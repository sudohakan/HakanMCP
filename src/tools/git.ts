import { z } from 'zod';
import { simpleGit } from 'simple-git';

const GIT_OUTPUT_LIMIT = 50_000;

function truncateOutput(output: string): string {
  if (output.length > GIT_OUTPUT_LIMIT) {
    return output.slice(0, GIT_OUTPUT_LIMIT) + `\n... [truncated: ${output.length} total chars]`;
  }
  return output;
}

export const gitTools = [
  {
    name: 'git_info',
    description:
      "Query Git repository information. action='status' shows working tree state, 'log' shows recent commits, 'diff' shows unstaged changes, 'branch' lists branches.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'log', 'diff', 'branch'],
          description: 'Which info to retrieve',
        },
        repoPath: { type: 'string', description: 'Path to the repository (defaults to cwd)' },
        maxCount: { type: 'number', description: 'Max commits to return (log only, default 10)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, repoPath, maxCount } = z
        .object({
          action: z.enum(['status', 'log', 'diff', 'branch']),
          repoPath: z.string().optional(),
          maxCount: z.number().optional().default(10),
        })
        .parse(args);

      const git = simpleGit(repoPath || process.cwd());

      switch (action) {
        case 'status': {
          const status = await git.status();
          const raw = JSON.stringify(
            {
              current: status.current,
              tracking: status.tracking,
              files: status.files,
              ahead: status.ahead,
              behind: status.behind,
            },
            null,
            2,
          );
          return { content: [{ type: 'text', text: truncateOutput(raw) }] };
        }

        case 'log': {
          const log = await git.log({ maxCount });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    total: log.total,
                    commits: log.all.map(
                      (c: {
                        hash?: string;
                        date?: string;
                        message?: string;
                        author_name?: string;
                      }) => ({
                        hash: c.hash,
                        date: c.date,
                        message: c.message,
                        author: c.author_name,
                      }),
                    ),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case 'diff': {
          const diff = await git.diff();
          return { content: [{ type: 'text', text: truncateOutput(diff || 'No changes') }] };
        }

        case 'branch': {
          const branches = await git.branch();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    current: branches.current,
                    all: branches.all,
                    branches: branches.branches,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }
    },
  },
  {
    name: 'git_sync',
    description:
      "Sync with remote repository. action='push' sends local commits to remote, 'pull' fetches and merges remote changes.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['push', 'pull'],
          description: 'Direction of sync',
        },
        repoPath: { type: 'string', description: 'Path to the repository (defaults to cwd)' },
        remote: { type: 'string', description: "Remote name (default: 'origin')" },
        branch: { type: 'string', description: 'Branch name (defaults to current branch)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, repoPath, remote, branch } = z
        .object({
          action: z.enum(['push', 'pull']),
          repoPath: z.string().optional(),
          remote: z.string().optional().default('origin'),
          branch: z.string().optional(),
        })
        .parse(args);

      const git = simpleGit(repoPath || process.cwd());

      if (action === 'push') {
        await git.push(remote, branch);
        return {
          content: [
            { type: 'text', text: `✓ Pushed to ${remote}/${branch || 'current'}` },
          ],
        };
      } else {
        const result = await git.pull(remote, branch);
        return {
          content: [
            { type: 'text', text: JSON.stringify(result.summary, null, 2) },
          ],
        };
      }
    },
  },
  {
    name: 'git_add',
    description: 'It stages the files.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
      },
      required: ['files'],
    },
    handler: async (args: unknown) => {
      const { repoPath, files } = z
        .object({
          repoPath: z.string().optional(),
          files: z.array(z.string()),
        })
        .parse(args);
      const git = simpleGit(repoPath || process.cwd());
      await git.add(files);
      return { content: [{ type: 'text', text: `✓ Staged: ${files.join(', ')}` }] };
    },
  },
  {
    name: 'git_commit',
    description: 'Commit creates.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['message'],
    },
    handler: async (args: unknown) => {
      const { repoPath, message } = z
        .object({
          repoPath: z.string().optional(),
          message: z.string(),
        })
        .parse(args);
      const git = simpleGit(repoPath || process.cwd());
      const result = await git.commit(message);
      return {
        content: [
          {
            type: 'text',
            text: `✓ Commit created: ${result.commit} - ${result.summary.changes} changes`,
          },
        ],
      };
    },
  },
  {
    name: 'git_checkout',
    description: 'Changes branch or creates new branch.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string' },
        branch: { type: 'string' },
        create: { type: 'boolean' },
      },
      required: ['branch'],
    },
    handler: async (args: unknown) => {
      const { repoPath, branch, create } = z
        .object({
          repoPath: z.string().optional(),
          branch: z.string(),
          create: z.boolean().default(false),
        })
        .parse(args);
      const git = simpleGit(repoPath || process.cwd());
      if (create) {
        await git.checkoutLocalBranch(branch);
      } else {
        await git.checkout(branch);
      }
      return { content: [{ type: 'text', text: `✓ Checked out ${branch}` }] };
    },
  },
  {
    name: 'git_reset',
    description: 'Reset operations (soft, mixed, hard).',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string' },
        mode: { type: 'string', enum: ['soft', 'mixed', 'hard'] },
        target: { type: 'string' },
      },
      required: ['mode'],
    },
    handler: async (args: unknown) => {
      const { repoPath, mode, target } = z
        .object({
          repoPath: z.string().optional(),
          mode: z.enum(['soft', 'mixed', 'hard']),
          target: z.string().default('HEAD'),
        })
        .parse(args);
      const git = simpleGit(repoPath || process.cwd());
      // @ts-ignore
      await git.reset(mode, [target]);
      return { content: [{ type: 'text', text: `✓ Reset (${mode}) to ${target}` }] };
    },
  },
  {
    name: 'git_clone',
    description: 'Repository klonlar.',
    inputSchema: {
      type: 'object',
      properties: {
        remoteUrl: { type: 'string' },
        destination: { type: 'string' },
      },
      required: ['remoteUrl', 'destination'],
    },
    handler: async (args: unknown) => {
      const { remoteUrl, destination } = z
        .object({
          remoteUrl: z.string(),
          destination: z.string(),
        })
        .parse(args);
      const git = simpleGit();
      await git.clone(remoteUrl, destination);
      return { content: [{ type: 'text', text: `✓ Cloned ${remoteUrl} to ${destination}` }] };
    },
  },
];
