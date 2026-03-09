import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from './logger.js';
import { PROJECT_ROOT } from './projectRoot.js';
import { processRegistry } from './processRegistry.js';
import { config } from '../config.js';

function copyRepo(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  const inDocker = process.env.DOCKER_CONTAINER === 'true';
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(sourceDir, src);
      if (!rel) return true;
      const skipPrefixes = [
        'node_modules',
        'logs',
        'coverage',
        'dist',
        '.git',
        'scheduler-state.json',
        'backups',
        '.husky',
        '.instance-role',
      ];
      const dynamicSkip = inDocker
        ? skipPrefixes.filter((p) => !['node_modules', 'dist'].includes(p))
        : skipPrefixes;
      return !dynamicSkip.some((p) => rel === p || rel.startsWith(`${p}${path.sep}`));
    },
  });
}

function isRepoBusy(repoPath: string): boolean {
  const lockFile = path.join(repoPath, '.git', 'index.lock');
  const agentLock = path.join(repoPath, '.ai-agent.lock');
  return fs.existsSync(lockFile) || fs.existsSync(agentLock);
}

export async function syncPeerRepo(
  peerPath: string | undefined,
): Promise<{ status: string; detail: string }> {
  if (!peerPath) {
    return { status: 'skipped', detail: 'peerPath missing' };
  }
  if (!fs.existsSync(peerPath)) {
    return { status: 'missing', detail: `peerPath not found: ${peerPath}` };
  }
  if (path.resolve(peerPath) === path.resolve(PROJECT_ROOT)) {
    return { status: 'skipped', detail: 'peerPath equals current repository; sync refused' };
  }

  const git = (
    args: string[],
  ): Promise<{ status: number | null; stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      const child = processRegistry.track(
        spawn('git', args, {
          cwd: peerPath,
          env: { ...process.env, HUSKY: '0' },
        }),
        `git-${args[0]}`,
      );
      let stdout = '';
      let stderr = '';
      if (child.stdout) {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (d) => (stdout += d));
      }
      if (child.stderr) {
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (d) => (stderr += d));
      }
      child.on('close', (code) => resolve({ status: code, stdout, stderr }));
      child.on('error', (err) => reject(err));
    });

  const isBusy = isRepoBusy(peerPath);
  if (isBusy) {
    return { status: 'skipped', detail: 'repo busy (possible AI agent activity), skipping sync' };
  }

  const owner = config.github?.owner;
  const repo = config.github?.repo;
  const branch = config.github?.branch || 'main';
  const token = (config.github?.token || process.env.GITHUB_TOKEN || '').trim();
  const originUrl =
    owner && repo
      ? token
        ? `https://${token}@github.com/${owner}/${repo}.git`
        : `https://github.com/${owner}/${repo}.git`
      : null;

  if (!originUrl) {
    return { status: 'skipped', detail: 'GitHub repo not configured; cannot sync peer' };
  }

  try {
    if (!fs.existsSync(path.join(peerPath, '.git'))) {
      await git(['init']);
    }

    await git(['remote', 'remove', 'origin']);
    await git(['remote', 'add', 'origin', originUrl]);

    const fetch = await git(['fetch', 'origin', branch]);
    if (fetch.status !== 0) {
      throw new Error(fetch.stderr || 'git fetch failed');
    }

    const statusOut = (await git(['status', '--porcelain'])).stdout || '';
    if (statusOut.trim().length > 0) {
      await git(['pull', '--rebase', 'origin', branch]);

      const commit = await git([
        'commit',
        '-am',
        'chore: auto-commit agent changes',
        '--no-verify',
      ]);
      if (commit.status !== 0 && !`${commit.stderr}`.includes('nothing to commit')) {
        throw new Error(commit.stderr || 'git commit failed');
      }
      const push = await git(['push', 'origin', branch, '--no-verify']);
      if (push.status !== 0) {
        throw new Error(push.stderr || 'git push failed');
      }
      return { status: 'pushed', detail: 'Committed and pushed local changes' };
    }

    await git(['checkout', '-B', branch, `origin/${branch}`]);
    const reset = await git(['reset', '--hard', `origin/${branch}`]);
    if (reset.status !== 0) {
      throw new Error(reset.stderr || 'git reset failed');
    }

    await git(['clean', '-fdx']);

    return { status: 'synced', detail: `Synced to origin/${branch}` };
  } catch (error: unknown) {
    logger.warn('Peer git sync failed', {
      peerPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'unknown git sync error',
    };
  }
}

export { copyRepo, isRepoBusy };
