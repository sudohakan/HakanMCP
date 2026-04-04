export interface DriveInfo {
  name: string;
  label: string;
  mountpoint: string;
  filesystem: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  isRemovable: boolean;
}

export interface ScanResult {
  path: string;
  totalSize: number;
  fileCount: number;
  dirCount: number;
  depth: number;
  children: ScanEntry[];
  scannedAt: string;
}

export interface ScanEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  modified: string;
  accessed: string;
  children?: ScanEntry[];
}

export interface TopEntry {
  path: string;
  size: number;
  type: 'file' | 'dir';
  modified: string;
}

export interface TypeDistribution {
  extension: string;
  count: number;
  totalSize: number;
  percent: number;
}

export interface AgeBracket {
  label: string;
  maxDays: number;
  count: number;
  totalSize: number;
  percent: number;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: string[];
  wastedBytes: number;
}

export interface TreeNode {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export interface SnapshotMeta {
  name: string;
  path: string;
  createdAt: string;
  fileCount: number;
  totalSize: number;
}

export interface CompareResult {
  added: ScanEntry[];
  removed: ScanEntry[];
  modified: Array<{ path: string; oldSize: number; newSize: number; sizeDiff: number }>;
  summary: { addedSize: number; removedSize: number; netChange: number };
}

export interface CleanupTarget {
  type: 'temp' | 'cache' | 'logs' | 'empty_dirs' | 'node_modules' | 'recycle_bin' | 'thumbnails' | 'crash_dumps';
  description: string;
}

export interface CleanupResult {
  target: string;
  filesDeleted: number;
  bytesFreed: number;
  errors: string[];
}

export interface QuotaDefinition {
  path: string;
  limitBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaStatus {
  path: string;
  limitBytes: number;
  usedBytes: number;
  usedPercent: number;
  exceeded: boolean;
}

export interface PolicyRule {
  match: {
    path: string;
    age?: string;
    types?: string[];
    minSize?: string;
    maxSize?: string;
    name?: string[];
    empty?: boolean;
    quota?: string;
    duplicates?: boolean;
  };
  action: 'delete' | 'recycle' | 'archive' | 'move' | 'warn' | 'report';
  destination?: string;
  format?: string;
}

export interface PolicyDefinition {
  name: string;
  description: string;
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRunResult {
  policy: string;
  dryRun: boolean;
  matches: Array<{
    rule: number;
    action: string;
    files: string[];
    totalSize: number;
  }>;
  totalFilesAffected: number;
  totalBytesAffected: number;
}

export interface HistoryEntry {
  id: string;
  action: string;
  params: Record<string, unknown>;
  result: { success: boolean; summary: string };
  timestamp: string;
  durationMs: number;
}

export type FileCategory =
  | 'project_active'
  | 'project_stale'
  | 'cache_safe'
  | 'temp_safe'
  | 'log_rotatable'
  | 'media_large'
  | 'system_critical'
  | 'data'
  | 'backup'
  | 'unknown';

export interface ClassificationResult {
  path: string;
  category: FileCategory;
  confidence: number;
  explanation: string;
  riskAssessment: string;
  dependencyWarning?: string;
}

export interface PredictionResult {
  drive: string;
  currentUsedPercent: number;
  trend: 'growing' | 'stable' | 'shrinking';
  dailyChangeBytes: number;
  daysUntilFull: number | null;
  hotspots: Array<{ path: string; weeklyGrowthBytes: number }>;
}

export interface AnomalyResult {
  type: 'sudden_growth' | 'unexpected_type' | 'duplication_explosion' | 'hidden_consumption' | 'recursive_link' | 'quota_trending';
  severity: 'critical' | 'warning' | 'info';
  path: string;
  description: string;
  recommendedAction: string;
}

export interface CleanupSuggestion {
  priority: 'high' | 'medium' | 'low';
  description: string;
  estimatedSavings: number;
  risk: 'low' | 'medium' | 'high';
  action: Record<string, unknown>;
}

export interface CleanupPlan {
  goal: string;
  steps: Array<{
    order: number;
    description: string;
    estimatedSavings: number;
    risk: 'low' | 'medium' | 'high';
    reversible: boolean;
    action: Record<string, unknown>;
    dependencies: number[];
  }>;
  totalPotentialSavings: number;
}

export interface UserPreferences {
  acceptedCategories: Record<FileCategory, number>;
  rejectedCategories: Record<FileCategory, number>;
  exceptions: string[];
  largeFileThreshold: number;
  lastUpdated: string;
}

export interface DiskAiContext {
  system: { platform: string; drives: DriveInfo[] };
  user: UserPreferences | null;
  history: HistoryEntry[];
  snapshots: SnapshotMeta[];
  policies: string[];
}
