import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getPlatform } from './platforms/index.js';
import { getDataDir } from './history.js';
import { assertNotProtected } from './cleaner.js';
import type { PolicyDefinition, PolicyRule, PolicyRunResult, ScanEntry } from '../../types/disk.js';

const VALID_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidName(name: string): void {
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(`Invalid policy name: "${name}". Only alphanumeric, underscore, and hyphen allowed (max 64 chars).`);
  }
}

async function getPoliciesDir(): Promise<string> {
  const dataDir = await getDataDir();
  const dir = path.join(dataDir, 'policies');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function createPolicy(name: string, description: string, rules: PolicyRule[]): Promise<PolicyDefinition> {
  assertValidName(name);
  const dir = await getPoliciesDir();
  const now = new Date().toISOString();
  const policy: PolicyDefinition = { name, description, rules, createdAt: now, updatedAt: now };
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(policy, null, 2));
  return policy;
}

export async function getPolicy(name: string): Promise<PolicyDefinition | null> {
  assertValidName(name);
  const dir = await getPoliciesDir();
  try {
    const content = await fs.readFile(path.join(dir, `${name}.json`), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function listPolicies(): Promise<string[]> {
  const dir = await getPoliciesDir();
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  } catch {
    return [];
  }
}

export async function updatePolicy(name: string, updates: Partial<Pick<PolicyDefinition, 'description' | 'rules'>>): Promise<PolicyDefinition | null> {
  assertValidName(name);
  const existing = await getPolicy(name);
  if (!existing) return null;
  const updated: PolicyDefinition = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  const dir = await getPoliciesDir();
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(updated, null, 2));
  return updated;
}

export async function deletePolicy(name: string): Promise<boolean> {
  assertValidName(name);
  const dir = await getPoliciesDir();
  try {
    await fs.unlink(path.join(dir, `${name}.json`));
    return true;
  } catch {
    return false;
  }
}

export async function runPolicy(name: string, dryRun: boolean = true): Promise<PolicyRunResult> {
  const policyDef = await getPolicy(name);
  if (!policyDef) throw new Error(`Policy not found: ${name}`);

  const platform = getPlatform();
  const result: PolicyRunResult = {
    policy: name,
    dryRun,
    matches: [],
    totalFilesAffected: 0,
    totalBytesAffected: 0,
  };

  for (let i = 0; i < policyDef.rules.length; i++) {
    const rule = policyDef.rules[i];
    const matchedFiles = await findMatchingFiles(rule, platform);
    const totalSize = matchedFiles.reduce((s, f) => s + f.size, 0);

    if (!dryRun && matchedFiles.length > 0) {
      await executeRuleAction(rule, matchedFiles, platform);
    }

    result.matches.push({
      rule: i,
      action: rule.action,
      files: matchedFiles.map((f) => f.path),
      totalSize,
    });
    result.totalFilesAffected += matchedFiles.length;
    result.totalBytesAffected += totalSize;
  }
  return result;
}

async function findMatchingFiles(rule: PolicyRule, platform: ReturnType<typeof getPlatform>): Promise<ScanEntry[]> {
  const expandedPath = path.resolve(rule.match.path.replace(/^~/, process.env.HOME || '/tmp'));
  assertNotProtected(expandedPath);
  const entries = await platform.getDirectoryEntries(expandedPath, 5, 0).catch(() => []);
  const flat = flattenAll(entries);
  const now = Date.now();

  return flat.filter((entry) => {
    if (rule.match.age) {
      const maxDays = parseAge(rule.match.age);
      if (maxDays !== null) {
        const ageDays = (now - new Date(entry.modified).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays <= maxDays) return false;
      }
    }
    if (rule.match.types) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!rule.match.types.some((t) => {
        const pattern = t.startsWith('*') ? t.slice(1) : t;
        return entry.name.endsWith(pattern) || ext === pattern;
      })) return false;
    }
    if (rule.match.minSize) {
      if (entry.size < parseSize(rule.match.minSize)) return false;
    }
    if (rule.match.maxSize) {
      if (entry.size > parseSize(rule.match.maxSize)) return false;
    }
    if (rule.match.name) {
      if (!rule.match.name.includes(entry.name)) return false;
    }
    return true;
  });
}

function flattenAll(entries: ScanEntry[]): ScanEntry[] {
  const result: ScanEntry[] = [];
  for (const e of entries) {
    result.push(e);
    if (e.children) result.push(...flattenAll(e.children));
  }
  return result;
}

async function executeRuleAction(rule: PolicyRule, files: ScanEntry[], platform: ReturnType<typeof getPlatform>): Promise<void> {
  for (const file of files) {
    assertNotProtected(file.path);
    switch (rule.action) {
      case 'delete':
        if (file.type === 'dir') await platform.deleteDirRecursive(file.path);
        else await platform.deleteFile(file.path);
        break;
      case 'recycle':
        await platform.sendToRecycleBin(file.path);
        break;
      case 'move':
        if (rule.destination) {
          const dest = rule.destination.replace(/^~/, process.env.HOME || '/tmp');
          await platform.moveItem(file.path, path.join(dest, file.name));
        }
        break;
      case 'archive':
        if (rule.destination) {
          const dest = rule.destination.replace(/^~/, process.env.HOME || '/tmp');
          const archivePath = await platform.compress(file.path, rule.format || 'zip', path.join(dest, file.name));
          try {
            await fs.stat(archivePath);
          } catch {
            break; // archive failed or missing — do not delete original
          }
          if (file.type === 'dir') await platform.deleteDirRecursive(file.path);
          else await platform.deleteFile(file.path);
        }
        break;
      case 'warn':
      case 'report':
        break;
    }
  }
}

function parseAge(ageStr: string): number | null {
  const match = ageStr.match(/^>?(\d+)(d|m|y)$/);
  if (!match) return null;
  const val = Number(match[1]);
  switch (match[2]) {
    case 'd': return val;
    case 'm': return val * 30;
    case 'y': return val * 365;
    default: return null;
  }
}

function parseSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)$/i);
  if (!match) return 0;
  const val = Number(match[1]);
  switch (match[2].toUpperCase()) {
    case 'KB': return val * 1024;
    case 'MB': return val * 1024 * 1024;
    case 'GB': return val * 1024 * 1024 * 1024;
    case 'TB': return val * 1024 * 1024 * 1024 * 1024;
    default: return 0;
  }
}
