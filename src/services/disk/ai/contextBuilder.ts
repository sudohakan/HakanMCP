import { drives } from '../scanner.js';
import { getHistory } from '../history.js';
import { listSnapshots } from '../archiver.js';
import { listPolicies } from '../policy.js';
import { loadPreferences } from './learner.js';
import type { DiskAiContext } from '../../../types/disk.js';

export async function buildContext(options?: {
  includeHistory?: boolean;
  includeSnapshots?: boolean;
  includePolicies?: boolean;
  includeUser?: boolean;
  historyLimit?: number;
}): Promise<DiskAiContext> {
  const opts = {
    includeHistory: true,
    includeSnapshots: true,
    includePolicies: true,
    includeUser: true,
    historyLimit: 20,
    ...options,
  };

  const [driveInfo, historyData, snapshots, policies, user] = await Promise.all([
    drives().catch(() => []),
    opts.includeHistory ? getHistory(opts.historyLimit).catch(() => []) : Promise.resolve([]),
    opts.includeSnapshots ? listSnapshots().catch(() => []) : Promise.resolve([]),
    opts.includePolicies ? listPolicies().catch(() => []) : Promise.resolve([]),
    opts.includeUser ? loadPreferences().catch(() => null) : Promise.resolve(null),
  ]);
  const history = historyData;

  return {
    system: { platform: process.platform, drives: driveInfo },
    user,
    history,
    snapshots,
    policies,
  };
}

export function contextToPrompt(ctx: DiskAiContext): string {
  const lines: string[] = ['## Disk Management Context\n'];

  lines.push('### System');
  lines.push(`Platform: ${ctx.system.platform}`);
  for (const d of ctx.system.drives) {
    const usedGB = (d.usedBytes / (1024 ** 3)).toFixed(1);
    const totalGB = (d.totalBytes / (1024 ** 3)).toFixed(1);
    lines.push(`Drive ${d.name}: ${usedGB}/${totalGB} GB (${d.usedPercent.toFixed(0)}%)`);
  }

  if (ctx.user) {
    lines.push('\n### User Preferences');
    if (ctx.user.exceptions.length > 0) {
      lines.push(`Protected paths: ${ctx.user.exceptions.join(', ')}`);
    }
    lines.push(`Large file threshold: ${(ctx.user.largeFileThreshold / (1024 * 1024)).toFixed(0)} MB`);
  }

  if (ctx.history.length > 0) {
    lines.push('\n### Recent Operations');
    for (const h of ctx.history.slice(0, 10)) {
      lines.push(`- ${h.action}: ${h.result.summary} (${h.timestamp.slice(0, 10)})`);
    }
  }

  if (ctx.snapshots.length > 0) {
    lines.push('\n### Available Snapshots');
    for (const s of ctx.snapshots.slice(0, 5)) {
      const sizeGB = (s.totalSize / (1024 ** 3)).toFixed(2);
      lines.push(`- ${s.name}: ${sizeGB} GB, ${s.fileCount} files (${s.createdAt.slice(0, 10)})`);
    }
  }

  if (ctx.policies.length > 0) {
    lines.push(`\n### Active Policies: ${ctx.policies.join(', ')}`);
  }

  return lines.join('\n');
}
