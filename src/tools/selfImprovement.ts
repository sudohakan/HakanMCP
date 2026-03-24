import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'child_process';
import util from 'util';
import { config } from '../config.js';

const execAsync = util.promisify(exec);

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
    name: 'self',
    description:
      "Self-improvement operations. Actions: propose (create code change proposal), changelog (retrieve change history), applyChange (apply a proposed change).",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['propose', 'changelog', 'applyChange'],
          description: "Action to perform",
        },
        operation: {
          type: 'string',
          enum: ['optimize', 'refactor', 'fix', 'test', 'docs'],
          description: "Type of operation (required for propose)",
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: "List of files to replace (required for propose)",
        },
        description: {
          type: 'string',
          description: "Detailed description of the change (required for propose)",
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
          description: "File-based change details (required for propose)",
        },
        limit: {
          type: 'number',
          description: "Maximum number of records to return (changelog, default: 10)",
        },
        proposalId: {
          type: 'string',
          description: 'Proposal ID to apply (required for applyChange)',
        },
        approved: {
          type: 'boolean',
          description: 'Has the change been approved? (applyChange, default: false)',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          action: z.enum(['propose', 'changelog', 'applyChange']),
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
          proposalId: z.string().optional(),
          approved: z.boolean().optional(),
        })
        .parse(args);

      switch (parsed.action) {
        case 'changelog': {
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
            `**Today's changes:** ${getTodayChangeCount()}/10\n\n` +
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

        case 'propose': {
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

          if (!isOperationAllowed(operation)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Operation '${operation}' is not allowed. Allowed: ${config.selfImprovement?.allowedOperations.join(', ')}`,
                },
              ],
              isError: true,
            };
          }

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

          const todayCount = getTodayChangeCount();
          const maxChanges = config.selfImprovement?.maxChangesPerDay ?? 10;

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
            `⚠️ **Approval required!** Approve with \`self\`: \`{"action": "applyChange", "proposalId": "${proposalId}", "approved": true}\``;

          return {
            content: [
              {
                type: 'text',
                text: report,
              },
            ],
          };
        }

        case 'applyChange': {
          const { proposalId, approved = false } = z
            .object({
              proposalId: z.string(),
              approved: z.boolean().optional(),
            })
            .parse({ proposalId: parsed.proposalId, approved: parsed.approved });

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

          const requireApproval = config.selfImprovement?.requireApproval ?? true;
          if (requireApproval && !approved) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Approval is required for this change. To confirm: \`{"action": "applyChange", "proposalId": "${proposalId}", "approved": true}\``,
                },
              ],
              isError: true,
            };
          }

          const results: string[] = [];

          for (const change of proposal.changes) {
            try {
              const filePath = change.file;

              if (fs.existsSync(filePath)) {
                const currentContent = fs.readFileSync(filePath, 'utf8');
                if (currentContent !== change.oldContent) {
                  results.push(`⚠️ ${filePath}: Content changed since proposal, skipping`);
                  continue;
                }
              }

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

          logChange({
            operation: proposal.operation,
            files: proposal.files,
            description: proposal.description,
            approved,
          });

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

          const autoCommit = config.selfImprovement?.autoCommit ?? false;
          if (autoCommit) {
            try {
              await execAsync(`git add ${proposal.files.map((f: string) => `"${f}"`).join(' ')}`, { timeout: 30000 });
              await execAsync(`git commit -m "self-improve(${proposal.operation}): ${proposal.description}"`, { timeout: 30000 });
              results.push('✓ Auto-committed changes');
            } catch (error: unknown) {
              results.push(`⚠️ Auto-commit failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

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
        }
      }
    },
  },
];
