import { z } from 'zod';
import {
  scanner, cleaner, archiver, quota, policy, history,
  aiEngine, setLastResult,
} from '../services/disk/index.js';
import { createJsonResponse, createErrorResponse } from '../utils/common.js';
import { callClaudeCodeModel } from './aiProviders.js';
import type { ToolDefinition } from '../types/index.js';
import type { ChatMessage } from './aiProviders.js';

const DiskArgsSchema = z.object({
  action: z.enum([
    'scan', 'drives', 'top', 'types', 'age', 'duplicates', 'tree', 'compare',
    'analyze', 'ask', 'suggest',
    'cleanup', 'delete', 'move', 'archive',
    'quota', 'policy', 'policyRun',
    'history', 'snapshot',
  ]),
  path: z.string().optional(),
  depth: z.number().optional(),
  minSize: z.union([z.number(), z.string()]).optional(),
  count: z.number().optional(),
  type: z.enum(['file', 'dir', 'all']).optional(),
  brackets: z.array(z.number()).optional(),
  algorithm: z.string().optional(),
  snapshotA: z.string().optional(),
  snapshotB: z.string().optional(),
  context: z.string().optional(),
  query: z.string().optional(),
  goalBytes: z.number().optional(),
  targets: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
  source: z.string().optional(),
  destination: z.string().optional(),
  format: z.string().optional(),
  subAction: z.enum(['set', 'get', 'check', 'checkAll', 'list', 'remove', 'create', 'update', 'delete']).optional(),
  limit: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  rules: z.array(z.any()).optional(),
  actionFilter: z.string().optional(),
  decision: z.enum(['accept', 'reject']).optional(),
  category: z.string().optional(),
  filePath: z.string().optional(),
});

async function getAiCall(): Promise<(prompt: string) => Promise<string>> {
  return async (prompt: string) => {
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    const result = await callClaudeCodeModel(messages);
    return result.text;
  };
}

function parseSizeValue(size: string | number | undefined): number {
  if (size === undefined) return 0;
  if (typeof size === 'number') return size;
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)$/i);
  if (!match) return Number(size) || 0;
  const val = Number(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return val * (multipliers[unit] || 1);
}

export const diskTools: ToolDefinition[] = [
  {
    name: 'disk',
    description: 'Disk management: scan, analyze (AI), cleanup, archive, quota, policy. Actions: scan, drives, top, types, age, duplicates, tree, compare, analyze, ask, suggest, cleanup, delete, move, archive, quota, policy, policyRun, history, snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'scan', 'drives', 'top', 'types', 'age', 'duplicates', 'tree', 'compare',
            'analyze', 'ask', 'suggest',
            'cleanup', 'delete', 'move', 'archive',
            'quota', 'policy', 'policyRun',
            'history', 'snapshot',
          ],
          description: 'Action to perform',
        },
        path: { type: 'string', description: 'Target path for scan/cleanup/analyze operations' },
        depth: { type: 'number', description: 'Scan depth (default: 3)' },
        minSize: { type: 'string', description: 'Minimum size filter (bytes or "100MB")' },
        count: { type: 'number', description: 'Number of results for top/history (default: 20)' },
        type: { type: 'string', enum: ['file', 'dir', 'all'], description: 'Filter by type for top' },
        brackets: { type: 'array', items: { type: 'number' }, description: 'Age brackets in days' },
        algorithm: { type: 'string', description: 'Hash algorithm for duplicates (default: md5)' },
        snapshotA: { type: 'string', description: 'First snapshot name for compare' },
        snapshotB: { type: 'string', description: 'Second snapshot name for compare' },
        query: { type: 'string', description: 'Natural language query for ask action' },
        goalBytes: { type: 'number', description: 'Target bytes to free for AI planner' },
        targets: { type: 'array', items: { type: 'string' }, description: 'Cleanup targets: temp, cache, logs, empty_dirs, node_modules, recycle_bin, thumbnails, crash_dumps' },
        dryRun: { type: 'boolean', description: 'Preview mode (default: true for destructive actions)' },
        confirm: { type: 'boolean', description: 'Confirmation for delete action' },
        source: { type: 'string', description: 'Source path for move' },
        destination: { type: 'string', description: 'Destination path for move/archive' },
        format: { type: 'string', description: 'Archive format: zip, 7z, tar.gz' },
        subAction: { type: 'string', description: 'Sub-action for quota/policy' },
        limit: { type: 'string', description: 'Quota limit (bytes or "50GB")' },
        name: { type: 'string', description: 'Snapshot/policy name' },
        description: { type: 'string', description: 'Policy description' },
        rules: { type: 'array', description: 'Policy rules array' },
        actionFilter: { type: 'string', description: 'Filter history by action' },
        decision: { type: 'string', enum: ['accept', 'reject'], description: 'Feedback decision for AI learning' },
        category: { type: 'string', description: 'File category for feedback' },
        filePath: { type: 'string', description: 'File path for feedback exception' },
        context: { type: 'string', description: 'Additional context for AI analyze' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const startTime = Date.now();
      try {
        const parsed = DiskArgsSchema.parse(args);
        const { action } = parsed;
        let result: unknown;

        switch (action) {
          case 'scan': {
            if (!parsed.path) throw new Error('path required for scan');
            result = await scanner.scan(parsed.path, parsed.depth ?? 3, parseSizeValue(parsed.minSize));
            break;
          }
          case 'drives': {
            result = await scanner.drives();
            break;
          }
          case 'top': {
            if (!parsed.path) throw new Error('path required for top');
            result = await scanner.top(parsed.path, parsed.count ?? 20, parsed.type ?? 'all');
            break;
          }
          case 'types': {
            if (!parsed.path) throw new Error('path required for types');
            result = await scanner.types(parsed.path, parsed.depth ?? 5);
            break;
          }
          case 'age': {
            if (!parsed.path) throw new Error('path required for age');
            result = await scanner.age(parsed.path, parsed.brackets ?? [30, 60, 90, 180, 365]);
            break;
          }
          case 'duplicates': {
            if (!parsed.path) throw new Error('path required for duplicates');
            result = await scanner.duplicates(parsed.path, parseSizeValue(parsed.minSize) || 1024 * 1024, parsed.algorithm ?? 'md5');
            break;
          }
          case 'tree': {
            if (!parsed.path) throw new Error('path required for tree');
            result = await scanner.tree(parsed.path, parsed.depth ?? 3, parseSizeValue(parsed.minSize) || 1024 * 1024);
            break;
          }
          case 'compare': {
            if (!parsed.snapshotA || !parsed.snapshotB) throw new Error('snapshotA and snapshotB required');
            result = await archiver.compare(parsed.snapshotA, parsed.snapshotB);
            break;
          }

          case 'analyze': {
            if (!parsed.path) throw new Error('path required for analyze');
            const aiCall = await getAiCall();
            result = await aiEngine.analyze(parsed.path, aiCall);
            break;
          }
          case 'ask': {
            if (!parsed.query) throw new Error('query required for ask');
            const aiCall = await getAiCall();
            const nlResult = await aiEngine.ask(parsed.query, aiCall);
            if (nlResult.action && !nlResult.conversational) {
              const resolvedAction = nlResult.action as Record<string, unknown>;
              // Guard: prevent recursive ask and strip destructive flags from AI output
              if (resolvedAction.action === 'ask' || resolvedAction.action === 'suggest') {
                result = { interpretation: nlResult.explanation, action: nlResult.action, conversational: true };
                break;
              }
              const safeArgs = { ...resolvedAction, dryRun: true, confirm: false };
              const innerResult = await diskTools[0].handler(safeArgs);
              setLastResult(innerResult);
              result = { interpretation: nlResult.explanation, action: nlResult.action, result: innerResult };
            } else {
              result = nlResult;
            }
            break;
          }
          case 'suggest': {
            if (!parsed.path) throw new Error('path required for suggest');
            const aiCall = await getAiCall();
            result = await aiEngine.suggest(parsed.path, aiCall);
            break;
          }

          case 'cleanup': {
            if (!parsed.path) throw new Error('path required for cleanup');
            if (!parsed.targets || parsed.targets.length === 0) throw new Error('targets required for cleanup');
            result = await cleaner.cleanup(parsed.path, parsed.targets, parsed.dryRun ?? true);
            break;
          }
          case 'delete': {
            if (!parsed.path) throw new Error('path required for delete');
            result = await cleaner.deleteItem(parsed.path, parsed.confirm ?? false);
            break;
          }
          case 'move': {
            if (!parsed.source || !parsed.destination) throw new Error('source and destination required for move');
            result = await cleaner.moveItem(parsed.source, parsed.destination);
            break;
          }

          case 'archive': {
            if (!parsed.path) throw new Error('path required for archive');
            result = await archiver.archive(parsed.path, parsed.format ?? 'zip', parsed.destination);
            break;
          }
          case 'snapshot': {
            if (!parsed.path) throw new Error('path required for snapshot');
            result = await archiver.saveSnapshot(parsed.path, parsed.name);
            break;
          }

          case 'quota': {
            const sub = parsed.subAction ?? 'check';
            switch (sub) {
              case 'set':
                if (!parsed.path || !parsed.limit) throw new Error('path and limit required');
                result = await quota.setQuota(parsed.path, parseSizeValue(parsed.limit));
                break;
              case 'get':
                if (!parsed.path) throw new Error('path required');
                result = await quota.getQuota(parsed.path);
                break;
              case 'check':
                if (parsed.path) {
                  result = await quota.checkQuota(parsed.path);
                } else {
                  result = await quota.checkAllQuotas();
                }
                break;
              case 'checkAll':
                result = await quota.checkAllQuotas();
                break;
              case 'list':
                result = await quota.listQuotas();
                break;
              case 'remove':
                if (!parsed.path) throw new Error('path required');
                result = await quota.removeQuota(parsed.path);
                break;
              default:
                throw new Error(`Unknown quota subAction: ${sub}`);
            }
            break;
          }

          case 'policy': {
            const sub = parsed.subAction ?? 'list';
            switch (sub) {
              case 'create':
                if (!parsed.name || !parsed.rules) throw new Error('name and rules required');
                result = await policy.createPolicy(parsed.name, parsed.description ?? '', parsed.rules);
                break;
              case 'list':
                result = await policy.listPolicies();
                break;
              case 'get':
                if (!parsed.name) throw new Error('name required');
                result = await policy.getPolicy(parsed.name);
                break;
              case 'update':
                if (!parsed.name) throw new Error('name required');
                result = await policy.updatePolicy(parsed.name, {
                  description: parsed.description,
                  rules: parsed.rules,
                });
                break;
              case 'delete':
                if (!parsed.name) throw new Error('name required');
                result = await policy.deletePolicy(parsed.name);
                break;
              default:
                throw new Error(`Unknown policy subAction: ${sub}`);
            }
            break;
          }
          case 'policyRun': {
            if (!parsed.name) throw new Error('name required for policyRun');
            result = await policy.runPolicy(parsed.name, parsed.dryRun ?? true);
            break;
          }

          case 'history': {
            result = await history.getHistory(parsed.count ?? 50, parsed.actionFilter);
            break;
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }

        const duration = Date.now() - startTime;
        const summary = `${action} completed`;
        await history.logOperation(action, parsed as unknown as Record<string, unknown>, { success: true, summary }, duration).catch(() => {});

        return createJsonResponse(result);
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);
        await history.logOperation(
          (args as Record<string, unknown>)?.action as string || 'unknown',
          args as Record<string, unknown>,
          { success: false, summary: message },
          duration,
        ).catch(() => {});
        return createErrorResponse(error instanceof Error ? error : new Error(message));
      }
    },
  },
];
