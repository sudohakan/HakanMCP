import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getPlatform } from './platforms/index.js';
import { getDataDir } from './history.js';
import type { QuotaDefinition, QuotaStatus } from '../../types/disk.js';

async function getQuotasFile(): Promise<string> {
  const dataDir = await getDataDir();
  return path.join(dataDir, 'quotas.json');
}

async function loadQuotas(): Promise<Record<string, QuotaDefinition>> {
  const file = await getQuotasFile();
  try {
    const content = await fs.readFile(file, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveQuotas(quotas: Record<string, QuotaDefinition>): Promise<void> {
  const file = await getQuotasFile();
  await fs.writeFile(file, JSON.stringify(quotas, null, 2));
}

export async function setQuota(dirPath: string, limitBytes: number): Promise<QuotaDefinition> {
  const quotas = await loadQuotas();
  const now = new Date().toISOString();
  const existing = quotas[dirPath];
  const quota: QuotaDefinition = {
    path: dirPath,
    limitBytes,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  quotas[dirPath] = quota;
  await saveQuotas(quotas);
  return quota;
}

export async function getQuota(dirPath: string): Promise<QuotaDefinition | null> {
  const quotas = await loadQuotas();
  return quotas[dirPath] || null;
}

export async function listQuotas(): Promise<QuotaDefinition[]> {
  const quotas = await loadQuotas();
  return Object.values(quotas);
}

export async function removeQuota(dirPath: string): Promise<boolean> {
  const quotas = await loadQuotas();
  if (!quotas[dirPath]) return false;
  delete quotas[dirPath];
  await saveQuotas(quotas);
  return true;
}

export async function checkQuota(dirPath: string): Promise<QuotaStatus | null> {
  const quota = await getQuota(dirPath);
  if (!quota) return null;
  const platform = getPlatform();
  const usedBytes = await platform.getDirectorySize(dirPath);
  return {
    path: dirPath,
    limitBytes: quota.limitBytes,
    usedBytes,
    usedPercent: (usedBytes / quota.limitBytes) * 100,
    exceeded: usedBytes > quota.limitBytes,
  };
}

export async function checkAllQuotas(): Promise<QuotaStatus[]> {
  const quotas = await listQuotas();
  const results: QuotaStatus[] = [];
  for (const q of quotas) {
    const status = await checkQuota(q.path);
    if (status) results.push(status);
  }
  return results;
}
