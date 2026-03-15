/**
 * Auto-detect GitHub owner/repo from git remote URL.
 * Falls back to config.github.owner/repo if git detection fails.
 */

import { execFileSync } from 'node:child_process';
import { PROJECT_ROOT } from './projectRoot.js';

interface GitHubInfo {
  owner: string;
  repo: string;
}

let cached: GitHubInfo | null = null;

/**
 * Parses owner/repo from a GitHub remote URL.
 * Supports HTTPS and SSH formats:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
function parseRemoteUrl(url: string): GitHubInfo | null {
  // HTTPS: https://github.com/owner/repo.git or https://token@github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

/**
 * Detects GitHub owner/repo from git remote origin.
 * Results are cached after first call.
 */
export function getGitHubInfo(): GitHubInfo | null {
  if (cached) return cached;

  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    const info = parseRemoteUrl(url);
    if (info) {
      cached = info;
    }
    return info;
  } catch {
    return null;
  }
}

/**
 * Returns GitHub owner/repo, preferring git remote auto-detection
 * with config values as fallback.
 */
export function resolveGitHubOwnerRepo(
  configOwner?: string,
  configRepo?: string,
): { owner: string; repo: string } | null {
  const gitInfo = getGitHubInfo();
  const owner = gitInfo?.owner || configOwner;
  const repo = gitInfo?.repo || configRepo;

  if (owner && repo) return { owner, repo };
  return null;
}
