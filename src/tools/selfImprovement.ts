import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'child_process';
import util from 'util';
import { config } from '../config.js';

const execAsync = util.promisify(exec);

/**
 * Self-Improvement Tools
 * Allows AI agents to improve their own code
 */

interface ChangeLog {
  timestamp: string;
  operation: string;
  files: string[];
  description: string;
  approved: boolean;
  commitHash?: string;
}

const changeLogPath = './self-improvement-log.json';

/**
 * Logs a change to the self-improvement log
 */
function logChange(change: Omit<ChangeLog, 'timestamp'>): void {
  let log: ChangeLog[];
  try {
    log = JSON.parse(fs.readFileSync(changeLogPath, 'utf8'));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      log = [];
    } else {
      throw err;
    }
  }

  log.push({
    ...change,
    timestamp: new Date().toISOString(),
  });

  fs.writeFileSync(changeLogPath, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Gets today's change count
 */
function getTodayChangeCount(): number {
  let log: ChangeLog[];
  try {
    log = JSON.parse(fs.readFileSync(changeLogPath, 'utf8'));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  const today = new Date().toISOString().split('T')[0];

  return log.filter((entry) => entry.timestamp.startsWith(today)).length;
}

/**
 * Checks if a path is restricted
 */
function isPathRestricted(filePath: string): boolean {
  const restricted = config.selfImprovement?.restrictedPaths || [];
  return restricted.some((pattern) => filePath.includes(pattern));
}

/**
 * Validates operation is allowed
 */
function isOperationAllowed(operation: string): boolean {
  const allowed = config.selfImprovement?.allowedOperations || [];
  return allowed.includes(operation);
}

export const selfImprovementTools = [
  {
    name: 'self_proposeChange',
    description:
      "Self-improvement proposals. action='propose' creates a code change proposal for review. action='changelog' retrieves the history of all self-improvement changes.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['propose', 'changelog'],
          description: "Action to perform: 'propose' to create a change proposal, 'changelog' to retrieve change history",
        },
        operation: {
          type: 'string',
          enum: ['optimize', 'refactor', 'fix', 'test', 'docs'],
          description: "Type of operation to be performed (required when action='propose')",
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: "List of files to replace (required when action='propose')",
        },
        description: {
          type: 'string',
          description: "Detailed description of the change (required when action='propose')",
        },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              oldContent: { type: 'string' },
              newContent: { type: 'string' },
            },
          },
          description: "File-based change details (required when action='propose')",
        },
        limit: {
          type: 'number',
          description: "Maximum number of records to return (optional, default: 10, used when action='changelog')",
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          action: z.enum(['propose', 'changelog']),
          operation: z.enum(['optimize', 'refactor', 'fix', 'test', 'docs']).optional(),
          files: z.array(z.string()).optional(),
          description: z.string().optional(),
          changes: z
            .array(
              z.object({
                file: z.string(),
                oldContent: z.string(),
                newContent: z.string(),
              }),
            )
            .optional(),
          limit: z.number().optional(),
        })
        .parse(args);

      // --- action='changelog' ---
      if (parsed.action === 'changelog') {
        const limit = parsed.limit ?? 10;

        let log: ChangeLog[];
        try {
          log = JSON.parse(fs.readFileSync(changeLogPath, 'utf8'));
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No self-improvement changes logged yet.',
                },
              ],
            };
          }
          throw err;
        }
        const recent = log.slice(-limit).reverse();

        const report =
          `# Self-Improvement Change Log\n\n` +
          `**Total changes:** ${log.length}\n` +
          `**Today's changes:** ${getTodayChangeCount()}/${config.selfImprovement?.maxChangesPerDay || 10}\n\n` +
          `## Recent Changes\n\n` +
          recent
            .map(
              (entry, i) =>
                `### ${i + 1}. ${entry.operation} (${new Date(entry.timestamp).toLocaleString()})\n\n` +
                `**Files:** ${entry.files.join(', ')}\n` +
                `**Description:** ${entry.description}\n` +
                `**Approved:** ${entry.approved ? '✓' : '✗'}\n` +
                (entry.commitHash ? `**Commit:** ${entry.commitHash}\n` : '') +
                `\n`,
            )
            .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: report,
            },
          ],
        };
      }

      // --- action='propose' ---
      const { operation, files, description, changes } = z
        .object({
          operation: z.enum(['optimize', 'refactor', 'fix', 'test', 'docs']),
          files: z.array(z.string()),
          description: z.string(),
          changes: z.array(
            z.object({
              file: z.string(),
              oldContent: z.string(),
              newContent: z.string(),
            }),
          ),
        })
        .parse({
          operation: parsed.operation,
          files: parsed.files,
          description: parsed.description,
          changes: parsed.changes,
        });

      // Check if self-improvement is enabled
      if (!config.selfImprovement?.enabled) {
        return {
          content: [
            {
              type: 'text',
              text: "❌ Self-improvement is disabled. Make 'selfImprovement.enabled: true' in config.yaml.",
            },
          ],
          isError: true,
        };
      }

      // Check operation is allowed
      if (!isOperationAllowed(operation)) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Operasyon '${operation}' is not allowed. Allowed:${config.selfImprovement?.allowedOperations.join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      // Check restricted paths
      const restrictedFiles = files.filter(isPathRestricted);
      if (restrictedFiles.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Restricted files:${restrictedFiles.join(', ')}These files cannot be changed.`,
            },
          ],
          isError: true,
        };
      }

      // Check daily limit
      const todayCount = getTodayChangeCount();
      const maxChanges = config.selfImprovement?.maxChangesPerDay || 10;

      if (todayCount >= maxChanges) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Daily change limit exceeded (${todayCount}/${maxChanges})`,
            },
          ],
          isError: true,
        };
      }

      // Save proposal to temporary directory
      const proposalDir = './proposals';
      fs.mkdirSync(proposalDir, { recursive: true });

      const proposalId = `${Date.now()}-${operation}`;
      const proposalPath = path.join(proposalDir, `${proposalId}.json`);

      const proposal = {
        id: proposalId,
        operation,
        files,
        description,
        changes,
        timestamp: new Date().toISOString(),
        status: 'pending',
      };

      fs.writeFileSync(proposalPath, JSON.stringify(proposal, null, 2), 'utf8');

      const report =
        `# Change Proposal\n\n` +
        `**ID:** ${proposalId}\n` +
        `**Operation:** ${operation}\n` +
        `**Files:** ${files.length}\n` +
        `**Description:** ${description}\n\n` +
        `## Files to Change\n\n${files.map((f) => `- ${f}`).join('\n')}\n\n` +
        `## Details\n\n${changes
          .map(
            (c) =>
              `### ${c.file}\n\n` +
              `**Old:**\n\`\`\`\n${c.oldContent.substring(0, 200)}${c.oldContent.length > 200 ? '...' : ''}\n\`\`\`\n\n` +
              `**New:**\n\`\`\`\n${c.newContent.substring(0, 200)}${c.newContent.length > 200 ? '...' : ''}\n\`\`\`\n\n`,
          )
          .join('\n')}\n` +
        `---\n\n` +
        `**Proposal saved to:** ${proposalPath}\n\n` +
        (config.selfImprovement?.requireApproval
          ? `⚠️ **Approval required!** Approve with \`self_applyChange\`: \`{"proposalId": "${proposalId}"}\``
          : `✓ Automatic application is active. Apply with \`self_applyChange\`.`);

      return {
        content: [
          {
            type: 'text',
            text: report,
          },
        ],
      };
    },
  },
  {
    name: 'self_applyChange',
    description: 'Apply the suggested change and commit if necessary',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: {
          type: 'string',
          description: 'Uygulanacak proposal ID',
        },
        approved: {
          type: 'boolean',
          description: 'Has the change been approved? (default: false)',
        },
      },
      required: ['proposalId'],
    },
    handler: async (args: unknown) => {
      const { proposalId, approved = false } = z
        .object({
          proposalId: z.string(),
          approved: z.boolean().optional(),
        })
        .parse(args);

      const proposalPath = path.join('./proposals', `${proposalId}.json`);

      if (!fs.existsSync(proposalPath)) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Proposal not found:${proposalId}`,
            },
          ],
          isError: true,
        };
      }

      const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));

      // Check approval if required
      if (config.selfImprovement?.requireApproval && !approved) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Approval is required for this change. To confirm: \`{"proposalId": "${proposalId}", "approved": true}\``,
            },
          ],
          isError: true,
        };
      }

      const results: string[] = [];

      // Apply changes
      for (const change of proposal.changes) {
        try {
          const filePath = change.file;

          // Verify old content matches
          if (fs.existsSync(filePath)) {
            const currentContent = fs.readFileSync(filePath, 'utf8');
            if (currentContent !== change.oldContent) {
              results.push(`⚠️ ${filePath}: Content changed since proposal, skipping`);
              continue;
            }
          }

          // Write new content
          const dir = path.dirname(filePath);
          fs.mkdirSync(dir, { recursive: true });

          fs.writeFileSync(filePath, change.newContent, 'utf8');
          results.push(`✓ Applied: ${filePath}`);
        } catch (error: unknown) {
          results.push(
            `✗ Failed: ${change.file} - ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Log the change
      logChange({
        operation: proposal.operation,
        files: proposal.files,
        description: proposal.description,
        approved,
      });

      // Rebuild
      results.push('\n**Rebuilding...**');
      try {
        const { stderr } = await execAsync('npm run build', {
          timeout: 120000,
        });

        if (stderr && !stderr.includes('WARN')) {
          results.push(`⚠️ Build warnings: ${stderr.substring(0, 200)}`);
        } else {
          results.push('✓ Build successful');
        }
      } catch (error: unknown) {
        results.push(`✗ Build failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Auto-commit if enabled
      if (config.selfImprovement?.autoCommit) {
        try {
          await execAsync(`git add ${proposal.files.join(' ')}`, { timeout: 30000 });
          const commitMsg = `[self-improve] ${proposal.operation}: ${proposal.description}`;
          const { stdout: commitOut } = await execAsync(`git commit -m "${commitMsg}"`, {
            timeout: 30000,
          });

          const commitHash = commitOut.match(/\[.+?\s([a-f0-9]+)\]/)?.[1];
          results.push(`\n✓ Auto-committed: ${commitHash}`);

          // Update log with commit hash
          logChange({
            operation: proposal.operation,
            files: proposal.files,
            description: proposal.description,
            approved,
            commitHash,
          });
        } catch (error: unknown) {
          results.push(
            `⚠️ Auto-commit failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Mark proposal as applied
      proposal.status = 'applied';
      fs.writeFileSync(proposalPath, JSON.stringify(proposal, null, 2), 'utf8');

      return {
        content: [
          {
            type: 'text',
            text: `# Change Applied\n\n**Proposal:** ${proposalId}\n**Operation:** ${proposal.operation}\n\n## Results\n\n${results.join('\n')}`,
          },
        ],
      };
    },
  },
];
