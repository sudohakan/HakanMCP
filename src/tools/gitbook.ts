import { z } from 'zod';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const API_BASE = 'https://api.gitbook.com/v1';
const cache = new NodeCache({ stdTTL: config.cacheTtl });

logger.info('GitBook initialized', { hasToken: !!config.gitbookToken, cacheTtl: config.cacheTtl });

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.gitbookToken) h['Authorization'] = `Bearer ${config.gitbookToken}`;
  return h;
}

async function apiGet<T = unknown>(endpoint: string): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const cached = cache.get<T>(url);
  if (cached) {
    logger.debug('Cache hit', { url });
    return cached;
  }

  logger.debug('API GET', { url });
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GitBook API ${res.status}: ${res.statusText} - ${url}`);
  const data = (await res.json()) as T;
  cache.set(url, data);
  return data;
}

async function apiPost<T = unknown>(endpoint: string, body: unknown): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  logger.debug('API POST', { url });
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitBook API ${res.status}: ${res.statusText} - ${url}`);
  if (res.status === 204) return {} as T;
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// --- Types ---

interface SpaceInfo {
  id: string;
  title: string;
  visibility: string;
  revision?: string;
  urls?: { published?: string; public?: string };
}

interface PageItem {
  id: string;
  title: string;
  kind: string;
  type: string;
  slug: string;
  path: string;
  description?: string;
  pages?: PageItem[];
}

interface RevisionPage {
  id: string;
  title: string;
  slug: string;
  path: string;
  markdown?: string;
  description?: string;
  document?: unknown;
}

interface AskResponse {
  answer?: { text?: string; markdown?: string; followupQuestions?: string[] };
  sources?: Array<{ title?: string; page?: string; space?: string }>;
}

// --- Resolution helpers ---

interface OrgInfo {
  id: string;
}

// Cache org list to avoid repeated calls
let orgCache: OrgInfo[] | null = null;

async function getOrgs(): Promise<OrgInfo[]> {
  if (orgCache) return orgCache;
  const data = await apiGet<{ items: OrgInfo[] }>('/orgs');
  orgCache = data.items;
  return orgCache;
}

async function resolveSpaceId(input: string): Promise<string> {
  if (/^[a-zA-Z0-9]{20}$/.test(input)) return input;

  const urlMatch = input.match(/gitbook\.io\/([^/?#]+)/);
  const slug = urlMatch ? urlMatch[1] : input.replace(/^\//, '');

  const orgs = await getOrgs();
  for (const org of orgs) {
    const spaces = await apiGet<{ items: SpaceInfo[] }>(`/orgs/${org.id}/spaces`);
    for (const space of spaces.items) {
      const publishedUrl = space.urls?.published || space.urls?.public || '';
      const publishedMatch = publishedUrl.match(/gitbook\.io\/([^/?#]+)/);
      const publishedSlug = publishedMatch ? publishedMatch[1] : '';
      const titleSlug = space.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      if (publishedSlug === slug || titleSlug === slug || space.id === slug) {
        return space.id;
      }
    }
  }
  throw new Error(`Space not found for: ${input}`);
}

async function resolveOrgId(input?: string): Promise<string> {
  if (input && /^[a-zA-Z0-9]{20}$/.test(input)) return input;
  const orgs = await getOrgs();
  if (orgs.length === 0) throw new Error('No organizations found');
  return orgs[0].id;
}

async function getSpaceRevision(spaceId: string): Promise<string> {
  const space = await apiGet<SpaceInfo>(`/spaces/${spaceId}`);
  if (!space.revision) throw new Error(`No revision found for space ${spaceId}`);
  return space.revision;
}

function extractPagePath(input: string): string | null {
  const match = input.match(/gitbook\.io\/[^/?#]+\/(.+?)(?:\?|#|$)/);
  return match ? match[1].replace(/\/$/, '') : null;
}

function flattenPages(pages: PageItem[], prefix = ''): Array<{ id: string; title: string; path: string; slug: string; description?: string }> {
  const result: Array<{ id: string; title: string; path: string; slug: string; description?: string }> = [];
  for (const page of pages) {
    const fullPath = prefix ? `${prefix}/${page.slug}` : page.slug;
    result.push({ id: page.id, title: page.title, path: fullPath, slug: page.slug, description: page.description });
    if (page.pages?.length) {
      result.push(...flattenPages(page.pages, fullPath));
    }
  }
  return result;
}

function renderDocument(node: unknown, spaceId?: string): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;

  // GitBook text node: { object: "text", leaves: [{ text: "..." }] }
  if (n.object === 'text' || n.type === 'text') {
    if (Array.isArray(n.leaves)) {
      return n.leaves
        .map((leaf: unknown) => {
          const l = leaf as Record<string, unknown>;
          return typeof l.text === 'string' ? l.text : '';
        })
        .join('');
    }
    if (typeof n.value === 'string') return n.value;
    if (typeof n.text === 'string') return n.text;
    return '';
  }

  // Inline nodes (link, etc.)
  if (n.object === 'inline' && n.type === 'link') {
    const ref = n.data as Record<string, unknown> | undefined;
    const linkRef = ref?.ref as Record<string, unknown> | undefined;
    const url = typeof linkRef?.url === 'string' ? linkRef.url : '';
    const children = Array.isArray(n.nodes) ? n.nodes : [];
    const text = children.map((c: unknown) => renderDocument(c, spaceId)).join('');
    return url ? `[${text}](${url})` : text;
  }

  // Collect child text
  const children = Array.isArray(n.nodes) ? n.nodes : Array.isArray(n.children) ? n.children : [];
  const childText = children.map((c: unknown) => renderDocument(c, spaceId)).join('');

  switch (n.type) {
    case 'document': return childText;
    case 'heading-1': return `\n# ${childText}\n`;
    case 'heading-2': return `\n## ${childText}\n`;
    case 'heading-3': return `\n### ${childText}\n`;
    case 'paragraph': return `${childText}\n`;
    case 'list-unordered':
    case 'list-ordered': return childText;
    case 'list-item': {
      // List items contain paragraphs — join them on same line
      const lines = childText.split('\n').filter((l) => l.trim());
      return `- ${lines.join(' ')}\n`;
    }
    case 'code': {
      const data = n.data as Record<string, unknown> | undefined;
      const syntax = typeof data?.syntax === 'string' ? data.syntax : '';
      return `\`\`\`${syntax}\n${typeof n.value === 'string' ? n.value : childText}\n\`\`\`\n`;
    }
    case 'blockquote': return `> ${childText}\n`;
    case 'hint': {
      const data = n.data as Record<string, unknown> | undefined;
      const style = typeof data?.style === 'string' ? data.style : 'info';
      return `> **${style.toUpperCase()}:** ${childText}\n`;
    }
    case 'table': return childText;
    case 'table-row': return `|${childText}\n`;
    case 'table-cell': return ` ${childText} |`;
    case 'images': return childText;
    case 'image': {
      const data = n.data as Record<string, unknown> | undefined;
      const alt = typeof data?.alt === 'string' ? data.alt : '';
      const ref = data?.ref as Record<string, unknown> | undefined;
      const kind = typeof ref?.kind === 'string' ? ref.kind : '';
      const fileId = typeof ref?.file === 'string' ? ref.file : '';
      const directUrl = typeof ref?.url === 'string' ? ref.url : '';
      if (directUrl) return `![${alt}](${directUrl})\n`;
      if (kind === 'file' && fileId && spaceId) {
        const url = `https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F${spaceId}%2Fuploads%2F${fileId}%2Ffile?alt=media`;
        return `![${alt}](${url})\n`;
      }
      return fileId ? `![${alt}](gitbook-file:${fileId})\n` : '';
    }
    case 'embed': {
      const data = n.data as Record<string, unknown> | undefined;
      const url = typeof data?.url === 'string' ? data.url : '';
      return `[embed](${url})\n`;
    }
    case 'divider': return '\n---\n';
    case 'tabs':
    case 'tab': return childText;
    case 'expandable': return childText;
    case 'swagger': {
      const data = n.data as Record<string, unknown> | undefined;
      const url = typeof data?.url === 'string' ? data.url : '';
      return `[API Reference](${url})\n`;
    }
    default: return childText;
  }
}

// --- Git Sync helpers (for updatePage) ---
// Uses persistent local git repo at C:/dev/Finekra/gitbook-{spaceSlug}/
// Flow: export (first time or on sync) → edit locally → commit+push → import

const GITBOOK_SYNC_BASE = '/mnt/c/dev/Finekra';
const SYNC_REPO_NAME = 'sudohakan/finekra-gitbook-sync';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 30000 }).trim();
}

function getGitHubToken(): string {
  const token = config.github?.token || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GitHub token required for updatePage (config.github.token or GITHUB_TOKEN)');
  return token;
}

function getSyncDir(spaceSlug: string): string {
  return join(GITBOOK_SYNC_BASE, `gitbook-${spaceSlug}`);
}

async function getSpaceSlug(spaceId: string): Promise<string> {
  const orgs = await getOrgs();
  for (const org of orgs) {
    const spaces = await apiGet<{ items: SpaceInfo[] }>(`/orgs/${org.id}/spaces`);
    for (const s of spaces.items) {
      if (s.id === spaceId) {
        const url = s.urls?.published || s.urls?.public || '';
        const m = url.match(/gitbook\.io\/([^/?#]+)/);
        if (m) return m[1];
        return s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      }
    }
  }
  return spaceId;
}

async function ensureSyncRepo(spaceId: string): Promise<{ dir: string; branch: string; repoUrl: string }> {
  const ghToken = getGitHubToken();
  const slug = await getSpaceSlug(spaceId);
  const dir = getSyncDir(slug);
  const branch = slug;
  const repoUrl = `https://${ghToken}@github.com/${SYNC_REPO_NAME}.git`;

  // Ensure GitHub repo exists
  try {
    execFileSync('gh', ['repo', 'view', SYNC_REPO_NAME, '--json', 'name'], {
      encoding: 'utf-8', timeout: 15000,
      env: { ...process.env, GH_TOKEN: ghToken },
    });
  } catch {
    logger.info('updatePage: creating sync repo', { repo: SYNC_REPO_NAME });
    execFileSync('gh', ['repo', 'create', SYNC_REPO_NAME, '--private'], {
      encoding: 'utf-8', timeout: 15000,
      env: { ...process.env, GH_TOKEN: ghToken },
    });
  }

  // Ensure local dir exists with git
  if (!existsSync(join(dir, '.git'))) {
    logger.info('updatePage: initializing local sync dir', { dir, branch });
    execFileSync('mkdir', ['-p', dir], { encoding: 'utf-8' });
    git(['init'], dir);
    git(['config', 'user.email', 'gitbook-sync@finekra.com'], dir);
    git(['config', 'user.name', 'GitBook Sync'], dir);
    git(['remote', 'add', 'origin', repoUrl], dir);
    git(['checkout', '-b', branch], dir);

    // Initial export from GitBook
    logger.info('updatePage: initial export from GitBook', { spaceId });
    await apiPost(`/spaces/${spaceId}/git/export`, {
      url: repoUrl,
      ref: `refs/heads/${branch}`,
      commitMessage: 'Initial GitBook export',
    });

    // Wait and pull
    await waitForBranch(dir, branch);
  } else {
    // Pull latest
    try {
      git(['fetch', 'origin', branch], dir);
      git(['reset', '--hard', `origin/${branch}`], dir);
    } catch {
      logger.debug('updatePage: fetch failed, re-exporting');
      await apiPost(`/spaces/${spaceId}/git/export`, {
        url: repoUrl,
        ref: `refs/heads/${branch}`,
        commitMessage: 'GitBook re-export',
      });
      await waitForBranch(dir, branch);
    }
  }

  return { dir, branch, repoUrl };
}

async function waitForBranch(dir: string, branch: string): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      git(['fetch', 'origin', branch], dir);
      git(['reset', '--hard', `origin/${branch}`], dir);
      return;
    } catch {
      logger.debug(`updatePage: waiting for export... attempt ${i + 1}`);
    }
  }
  throw new Error('Timed out waiting for GitBook export');
}

function findFileBySlug(dir: string, slug: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.gitbook') continue;
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name === `${slug}.md`) return full;
    if (entry.isDirectory()) {
      const found = findFileBySlug(full, slug);
      if (found) return found;
    }
  }
  return null;
}

async function updatePageViaGitSync(
  spaceId: string,
  pagePath: string,
  markdown: string,
  commitMessage: string,
): Promise<{ success: boolean; pagePath: string; localFile: string }> {
  const { dir, branch, repoUrl } = await ensureSyncRepo(spaceId);

  // Find target file
  const mdFile = pagePath.endsWith('.md') ? pagePath : `${pagePath}.md`;
  let targetPath = join(dir, mdFile);

  if (!existsSync(targetPath)) {
    const slug = pagePath.split('/').pop() || '';
    const found = findFileBySlug(dir, slug);
    if (!found) throw new Error(`Page file not found: ${mdFile}. Available: use listPages to find correct path.`);
    targetPath = found;
  }

  // Write updated content
  writeFileSync(targetPath, markdown, 'utf-8');
  const relPath = targetPath.replace(dir + '/', '').replace(dir + '\\', '');
  logger.info('updatePage: file updated', { path: relPath });

  // Commit and push
  git(['add', '-A'], dir);
  try {
    git(['commit', '-m', commitMessage || 'Update page via GitBook sync'], dir);
  } catch {
    return { success: true, pagePath: relPath, localFile: targetPath };
  }
  git(['push', 'origin', branch], dir);

  // Import back to GitBook
  logger.info('updatePage: importing back to GitBook', { spaceId });
  await apiPost(`/spaces/${spaceId}/git/import`, {
    url: repoUrl,
    ref: `refs/heads/${branch}`,
  });

  // Invalidate cache
  cache.flushAll();

  return { success: true, pagePath: relPath, localFile: targetPath };
}

// --- Local-first read helper ---

async function tryReadFromLocal(
  spaceId: string,
  pageId: string | undefined,
  inputPath: string,
): Promise<{ content: Array<{ type: string; text: string }>; meta?: Record<string, string> } | null> {
  try {
    const slug = await getSpaceSlug(spaceId);
    const dir = getSyncDir(slug);
    if (!existsSync(join(dir, '.git'))) return null;

    // Pull latest from remote (sync with GitBook)
    const ghToken = getGitHubToken();
    const repoUrl = `https://${ghToken}@github.com/${SYNC_REPO_NAME}.git`;
    const branch = slug;

    // Export latest from GitBook first
    try {
      await apiPost(`/spaces/${spaceId}/git/export`, {
        url: repoUrl,
        ref: `refs/heads/${branch}`,
        commitMessage: 'GitBook sync export',
      });
    } catch (e) {
      logger.debug('tryReadFromLocal: export failed, using cached local', { error: String(e) });
    }

    // Pull with retry
    for (let i = 0; i < 5; i++) {
      try {
        git(['fetch', 'origin', branch], dir);
        git(['reset', '--hard', `origin/${branch}`], dir);
        break;
      } catch {
        if (i < 4) await new Promise((r) => setTimeout(r, 1500));
      }
    }

    // Resolve file path
    let filePath: string | null = null;

    if (pageId) {
      // pageId → need to find via content tree mapping (can't map pageId to file directly)
      return null; // Fall back to API for pageId lookups
    }

    const pagePath = extractPagePath(inputPath);
    if (pagePath) {
      const mdFile = pagePath.endsWith('.md') ? pagePath : `${pagePath}.md`;
      const candidate = join(dir, mdFile);
      if (existsSync(candidate)) {
        filePath = candidate;
      } else {
        const slugPart = pagePath.split('/').pop() || '';
        filePath = findFileBySlug(dir, slugPart);
      }
    }

    if (!filePath || !existsSync(filePath)) return null;

    const content = readFileSync(filePath, 'utf-8');
    const relPath = filePath.replace(dir + '/', '').replace(dir + '\\', '');
    logger.info('getPage: read from local sync', { path: relPath });

    return {
      content: [{ type: 'text', text: content }],
      meta: { spaceId, source: 'local', localFile: filePath, pagePath: relPath },
    };
  } catch (e) {
    logger.debug('tryReadFromLocal: failed, falling back to API', { error: String(e) });
    return null;
  }
}

// --- Tool definition ---

export const gitbookTools = [
  {
    name: 'gitbook',
    description:
      'GitBook API operations. Actions: listSpaces, listPages, getPage, updatePage, searchContent, ask, getMetadata.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['listSpaces', 'listPages', 'getPage', 'updatePage', 'searchContent', 'ask', 'getMetadata'],
          description: 'Operation to perform',
        },
        path: {
          type: 'string',
          description: 'GitBook URL, space slug, or space ID. Required for all actions except listSpaces.',
        },
        pageId: { type: 'string', description: 'Page ID (getPage). Alternative to page path in URL.' },
        pagePath: { type: 'string', description: 'Page file path within space (updatePage). e.g. "erp/erp-rapor-sayfalari"' },
        markdown: { type: 'string', description: 'Markdown content to write (updatePage).' },
        commitMessage: { type: 'string', description: 'Git commit message (updatePage).' },
        searchTerm: { type: 'string', description: 'Search query (searchContent, ask)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, path, pageId, pagePath: argPagePath, markdown, commitMessage, searchTerm } = z
        .object({
          action: z.enum(['listSpaces', 'listPages', 'getPage', 'updatePage', 'searchContent', 'ask', 'getMetadata']),
          path: z.string().optional(),
          pageId: z.string().optional(),
          pagePath: z.string().optional(),
          markdown: z.string().optional(),
          commitMessage: z.string().optional(),
          searchTerm: z.string().optional(),
        })
        .parse(args);

      switch (action) {
        // --- List all spaces across orgs ---
        case 'listSpaces': {
          const orgs = await getOrgs();
          const allSpaces: Array<{ id: string; title: string; visibility: string; org: string; url?: string }> = [];
          for (const org of orgs) {
            const spaces = await apiGet<{ items: SpaceInfo[] }>(`/orgs/${org.id}/spaces`);
            for (const s of spaces.items) {
              allSpaces.push({
                id: s.id,
                title: s.title,
                visibility: s.visibility,
                org: org.id,
                url: s.urls?.published || s.urls?.public,
              });
            }
          }
          return { content: [{ type: 'text', text: JSON.stringify(allSpaces, null, 2) }] };
        }

        // --- List pages in a space ---
        case 'listPages': {
          if (!path) throw new Error('path is required for listPages');
          const spaceId = await resolveSpaceId(path);
          const data = await apiGet<{ pages: PageItem[] }>(`/spaces/${spaceId}/content`);
          const pages = flattenPages(data.pages || []);
          return {
            content: [{ type: 'text', text: JSON.stringify({ spaceId, pageCount: pages.length, pages }, null, 2) }],
          };
        }

        // --- Get page content as markdown ---
        case 'getPage': {
          if (!path && !pageId) throw new Error('path or pageId required');

          const spaceId = path ? await resolveSpaceId(path) : (() => { throw new Error('path required to resolve space'); })();

          // Local-first: if sync repo exists, pull and read from local file
          const localResult = await tryReadFromLocal(spaceId, pageId, path!);
          if (localResult) return localResult;

          const revisionId = await getSpaceRevision(spaceId);

          // Strategy 1: direct pageId
          if (pageId) {
            const page = await apiGet<RevisionPage>(`/spaces/${spaceId}/revisions/${revisionId}/page/${pageId}`);
            const text = page.markdown || (page.document ? renderDocument(page.document, spaceId) : '');
            return {
              content: [{ type: 'text', text: text || `(empty page: ${page.title})` }],
              meta: { spaceId, pageId, title: page.title, revisionId },
            };
          }

          // Strategy 2: page path from URL
          const pagePath = extractPagePath(path!);
          if (pagePath) {
            try {
              const page = await apiGet<RevisionPage>(`/spaces/${spaceId}/revisions/${revisionId}/path/${pagePath}`);
              const text = page.markdown || (page.document ? renderDocument(page.document, spaceId) : '');
              return {
                content: [{ type: 'text', text: text || `(empty page: ${page.title})` }],
                meta: { spaceId, pageId: page.id, title: page.title, revisionId },
              };
            } catch {
              // Path endpoint failed, fall through to content tree lookup
              logger.debug('Path-based page lookup failed, trying content tree', { pagePath });
            }

            // Fallback: search in content tree
            const data = await apiGet<{ pages: PageItem[] }>(`/spaces/${spaceId}/content`);
            const flat = flattenPages(data.pages || []);
            const match = flat.find((p) => p.path === pagePath || p.slug === pagePath || p.path.endsWith(pagePath));
            if (match) {
              const page = await apiGet<RevisionPage>(`/spaces/${spaceId}/revisions/${revisionId}/page/${match.id}`);
              const text = page.markdown || (page.document ? renderDocument(page.document, spaceId) : '');
              return {
                content: [{ type: 'text', text: text || `(empty page: ${page.title})` }],
                meta: { spaceId, pageId: match.id, title: page.title, revisionId },
              };
            }
          }

          // Strategy 3: no specific page — return first page
          const data = await apiGet<{ pages: PageItem[] }>(`/spaces/${spaceId}/content`);
          const flat = flattenPages(data.pages || []);
          const firstDoc = flat.find((p) => p.id) || flat[0];
          if (firstDoc) {
            const page = await apiGet<RevisionPage>(`/spaces/${spaceId}/revisions/${revisionId}/page/${firstDoc.id}`);
            const text = page.markdown || (page.document ? renderDocument(page.document, spaceId) : '');
            return {
              content: [{ type: 'text', text: text || `(empty page: ${page.title})` }],
              meta: { spaceId, pageId: firstDoc.id, title: page.title, revisionId },
            };
          }
          return { content: [{ type: 'text', text: '(no pages found)' }] };
        }

        // --- Search content in a space ---
        case 'searchContent': {
          if (!searchTerm) throw new Error('searchTerm required');
          if (!path) throw new Error('path required');
          const spaceId = await resolveSpaceId(path);
          const data = await apiGet<{ items?: Array<{ id: string; title: string; path: string; body?: string }> }>(
            `/spaces/${spaceId}/search?query=${encodeURIComponent(searchTerm)}`,
          );
          const results = (data.items || []).map((item) => ({
            id: item.id,
            title: item.title,
            path: item.path,
            snippet: item.body?.slice(0, 500),
          }));
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ spaceId, searchTerm, matchCount: results.length, results }, null, 2),
            }],
          };
        }

        // --- AI-powered ask across org ---
        case 'ask': {
          if (!searchTerm) throw new Error('searchTerm (query) required');
          const orgId = await resolveOrgId();
          const data = await apiPost<AskResponse>(
            `/orgs/${orgId}/ask?format=markdown`,
            { query: searchTerm },
          );
          const answer = data.answer?.markdown || data.answer?.text || '(no answer)';
          const sources = (data.sources || []).map((s) => ({
            title: s.title,
            page: s.page,
            space: s.space,
          }));
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ query: searchTerm, answer, sources }, null, 2),
            }],
          };
        }

        // --- Update page content via git sync ---
        case 'updatePage': {
          if (!path) throw new Error('path (space) required');
          if (!markdown) throw new Error('markdown content required');
          const targetPagePath = argPagePath || extractPagePath(path!) || '';
          if (!targetPagePath) throw new Error('pagePath required (or include page path in URL)');
          const spaceId = await resolveSpaceId(path);
          const result = await updatePageViaGitSync(
            spaceId,
            targetPagePath,
            markdown,
            commitMessage || `Update ${targetPagePath}`,
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }],
          };
        }

        // --- Get space metadata ---
        case 'getMetadata': {
          if (!path) throw new Error('path required');
          const spaceId = await resolveSpaceId(path);
          const space = await apiGet<Record<string, unknown>>(`/spaces/${spaceId}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                id: space.id,
                title: space.title,
                visibility: space.visibility,
                editMode: space.editMode,
                language: space.language,
                revision: space.revision,
                createdAt: space.createdAt,
                updatedAt: space.updatedAt,
                changeRequests: space.changeRequests,
                changeRequestsOpen: space.changeRequestsOpen,
                urls: space.urls,
              }, null, 2),
            }],
          };
        }
      }
    },
  },
];
