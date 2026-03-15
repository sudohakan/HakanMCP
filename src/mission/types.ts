/**
 * Mission system type definitions — shared contract for all mission modules.
 * (loader, runner, state, report)
 */
import { z } from 'zod';
import { MissionFrontmatterSchema } from './schemas/stateSchemas.js';

// --- Re-export MissionFrontmatter from Zod schema ---

export type MissionFrontmatter = z.infer<typeof MissionFrontmatterSchema>;

// --- Step Status ---

export type StepStatus =
  | 'pending'
  | 'running'
  | 'evaluating'
  | 'completed'
  | 'failed'
  | 'skipped';

// --- Mission Parsing Types ---

export interface MissionTask {
  id: string;
  description: string;
  completed: boolean;
  section: string;
}

export interface MissionSection {
  heading: string;
  content: string;
}

export interface ParsedMission {
  filePath: string;
  frontmatter: MissionFrontmatter;
  description: string;
  tasks: MissionTask[];
  sections: MissionSection[];
  raw: string;
}

// --- Mission State Types ---

export interface MissionStepState {
  id: string;
  description: string;
  status: StepStatus;
  result?: string;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  error?: string;
}

export interface MissionState {
  missionId: string;
  filePath: string;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  currentStepIndex: number;
  steps: MissionStepState[];
  startedAt: number;
  updatedAt: number;
  provider?: string;
}

// --- History & Learning Types ---

export interface HistoryEntry {
  missionId: string;
  title: string;
  status: string;
  startedAt: number;
  completedAt: number;
  stepsTotal: number;
  stepsCompleted: number;
  stepsFailed: number;
  provider: string;
}

export interface LearnedPattern {
  id: string;
  pattern: string;
  context: string;
  usageCount: number;
  lastUsed: number;
  createdAt: number;
}

// --- Report Types ---

export interface ReportData {
  missionId: string;
  title: string;
  status: string;
  duration: number;
  startedAt: number;
  completedAt: number;
  tasks: MissionStepState[];
  provider: string;
  learnedPatterns: LearnedPattern[];
}

// --- Runner Config ---

export interface MissionRunnerConfig {
  maxIterationsPerStep: number;
  stepTimeoutMs: number;
  maxTotalTimeMs: number;
  maxRetriesPerStep: number;
  continueOnFailure: boolean;
  toolSubset?: string[];
}

// --- Runner Events ---

export interface MissionEvent {
  type:
    | 'step:start'
    | 'step:complete'
    | 'step:failed'
    | 'mission:complete'
    | 'mission:failed'
    | 'waiting';
  stepId?: string;
  index?: number;
  total?: number;
  error?: string;
}

// --- Runner Result ---

export interface MissionRunResult {
  status: 'completed' | 'failed' | 'timeout' | 'aborted';
  steps: MissionStepState[];
  duration: number;
  provider: string;
}

// --- Target Analysis Types (Phase 6: Assistant Mode) ---

export interface AnalyzedFile {
  path: string;
  relativePath: string;
  size: number;
  content: string;
  truncated: boolean;
  type: string;
}

export interface TargetAnalysis {
  files: AnalyzedFile[];
  summary: string;
  totalSize: number;
  truncated: boolean;
  errors: string[];
}
