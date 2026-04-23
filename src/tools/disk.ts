import { z } from 'zod';
import {
  scanner, cleaner, archiver, quota, policy, history,
} from '../services/disk/index.js';
import { parseBytes } from '../services/disk/utils.js';
import { createJsonResponse, createErrorResponse } from '../utils/common.js';
import type { ToolDefinition, ToolResponse } from '../types/index.js';

const DiskArgsSchema = z.object({
  action: z.enum([
    'scan', 'drives', 'top', 'types', 'age', 'duplicates', 'tree', 'compare',
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
});

type DiskArgs = z.infer<typeof DiskArgsSchema>;

async function handleDiskAction(parsed: DiskArgs): Promise<unknown> {
  const { action } = parsed;

  switch (action) {
    case 'scan': {
      if (!parsed.path) throw new Error('path required for scan');
      return scanner.scan(parsed.path, parsed.depth ?? 3, parseBytes(parsed.minSize));
    }
    case 'drives':
      return scanner.drives();
    case 'top': {
      if (!parsed.path) throw new Error('path required for top');
      return scanner.top(parsed.path, parsed.count ?? 20, parsed.type ?? 'all', parsed.depth ?? 10);
    }
    case 'types': {
      if (!parsed.path) throw new Error('path required for types');
      return scanner.types(parsed.path, parsed.depth ?? 5);
    }
    case 'age': {
      if (!parsed.path) throw new Error('path required for age');
      return scanner.age(parsed.path, parsed.brackets ?? [30, 60, 90, 180, 365], parsed.depth ?? 10);
    }
    case 'duplicates': {
      if (!parsed.path) throw new Error('path required for duplicates');
      return scanner.duplicates(parsed.path, parseBytes(parsed.minSize) || 1024 * 1024, parsed.algorithm ?? 'md5');
    }
    case 'tree': {
      if (!parsed.path) throw new Error('path required for tree');
      return scanner.tree(parsed.path, parsed.depth ?? 3, parseBytes(parsed.minSize) || 1024 * 1024);
    }
    case 'compare': {
      if (!parsed.snapshotA || !parsed.snapshotB) throw new Error('snapshotA and snapshotB required');
      return archiver.compare(parsed.snapshotA, parsed.snapshotB);
    }

    // Cleaner actions
    case 'cleanup': {
      if (!parsed.path) throw new Error('path required for cleanup');
      if (!parsed.targets || parsed.targets.length === 0) throw new Error('targets required for cleanup');
      return cleaner.cleanup(parsed.path, parsed.targets, parsed.dryRun ?? true);
    }
    case 'delete': {
      if (!parsed.path) throw new Error('path required for delete');
      return cleaner.deleteItem(parsed.path, parsed.confirm ?? false);
    }
    case 'move': {
      if (!parsed.source || !parsed.destination) throw new Error('source and destination required for move');
      return cleaner.moveItem(parsed.source, parsed.destination);
    }

    // Archiver actions
    case 'archive': {
      if (!parsed.path) throw new Error('path required for archive');
      return archiver.archive(parsed.path, parsed.format ?? 'zip', parsed.destination);
    }
    case 'snapshot': {
      if (!parsed.path) throw new Error('path required for snapshot');
      return archiver.saveSnapshot(parsed.path, parsed.name);
    }

    // Quota actions
    case 'quota':
      return handleQuota(parsed);

    // Policy actions
    case 'policy':
      return handlePolicy(parsed);
    case 'policyRun': {
      if (!parsed.name) throw new Error('name required for policyRun');
      return policy.runPolicy(parsed.name, parsed.dryRun ?? true);
    }

    // Utility
    case 'history':
      return history.getHistory(parsed.count ?? 50, parsed.actionFilter);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function handleQuota(parsed: DiskArgs): Promise<unknown> {
  const sub = parsed.subAction ?? 'check';
  switch (sub) {
    case 'set':
      if (!parsed.path || !parsed.limit) throw new Error('path and limit required');
      return quota.setQuota(parsed.path, parseBytes(parsed.limit));
    case 'get':
      if (!parsed.path) throw new Error('path required');
      return quota.getQuota(parsed.path);
    case 'check':
      return parsed.path ? quota.checkQuota(parsed.path) : quota.checkAllQuotas();
    case 'checkAll':
      return quota.checkAllQuotas();
    case 'list':
      return quota.listQuotas();
    case 'remove':
      if (!parsed.path) throw new Error('path required');
      return quota.removeQuota(parsed.path);
    default:
      throw new Error(`Unknown quota subAction: ${sub}`);
  }
}

async function handlePolicy(parsed: DiskArgs): Promise<unknown> {
  const sub = parsed.subAction ?? 'list';
  switch (sub) {
    case 'create':
      if (!parsed.name || !parsed.rules) throw new Error('name and rules required');
      return policy.createPolicy(parsed.name, parsed.description ?? '', parsed.rules);
    case 'list':
      return policy.listPolicies();
    case 'get':
      if (!parsed.name) throw new Error('name required');
      return policy.getPolicy(parsed.name);
    case 'update':
      if (!parsed.name) throw new Error('name required');
      return policy.updatePolicy(parsed.name, { description: parsed.description, rules: parsed.rules });
    case 'delete':
      if (!parsed.name) throw new Error('name required');
      return policy.deletePolicy(parsed.name);
    default:
      throw new Error(`Unknown policy subAction: ${sub}`);
  }
}

export const diskTools: ToolDefinition[] = [
  {
    name: 'disk',
    description: 'Disk management: scan usage, find duplicates, cleanup temp/cache/logs, archive, move, delete files, quota management, and policy-based automation.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'scan', 'drives', 'top', 'types', 'age', 'duplicates', 'tree', 'compare',
            'cleanup', 'delete', 'move', 'archive',
            'quota', 'policy', 'policyRun',
            'history', 'snapshot',
          ],
          description: 'Action to perform',
        },
        path: { type: 'string', description: 'Target path' },
        depth: { type: 'number', description: 'Scan depth (default: 3)' },
        minSize: { type: 'string', description: 'Minimum size filter (bytes or "100MB")' },
        count: { type: 'number', description: 'Number of results (default: 20)' },
        type: { type: 'string', enum: ['file', 'dir', 'all'], description: 'Filter by type' },
        brackets: { type: 'array', items: { type: 'number' }, description: 'Age brackets in days' },
        algorithm: { type: 'string', description: 'Hash algorithm (default: md5)' },
        snapshotA: { type: 'string', description: 'First snapshot for compare' },
        snapshotB: { type: 'string', description: 'Second snapshot for compare' },
        targets: { type: 'array', items: { type: 'string' }, description: 'Cleanup targets: temp, cache, logs, empty_dirs, node_modules, recycle_bin, thumbnails, crash_dumps' },
        dryRun: { type: 'boolean', description: 'Preview mode (default: true)' },
        confirm: { type: 'boolean', description: 'Confirm destructive action' },
        source: { type: 'string', description: 'Source path for move' },
        destination: { type: 'string', description: 'Destination path' },
        format: { type: 'string', description: 'Archive format: zip, 7z, tar.gz' },
        subAction: { type: 'string', description: 'Sub-action for quota/policy' },
        limit: { type: 'string', description: 'Quota limit (bytes or "50GB")' },
        name: { type: 'string', description: 'Snapshot/policy name' },
        description: { type: 'string', description: 'Policy description' },
        rules: { type: 'array', items: { type: 'object' }, description: 'Policy rules' },
        actionFilter: { type: 'string', description: 'Filter history by action' },
      },
      required: ['action'],
    },
    handler: async (args: unknown): Promise<ToolResponse> => {
      const startTime = Date.now();
      try {
        const parsed = DiskArgsSchema.parse(args);
        const result = await handleDiskAction(parsed);
        const duration = Date.now() - startTime;
        await history.logOperation(parsed.action, parsed as unknown as Record<string, unknown>, { success: true, summary: `${parsed.action} completed` }, duration).catch(() => {});
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
